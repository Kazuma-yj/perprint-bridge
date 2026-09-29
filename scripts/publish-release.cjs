// Publish only verified artifacts. Published assets are never replaced.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function loadPlan() {
  execFileSync('python3', ['scripts/verify_package.py'], { cwd: root, stdio: 'inherit' });
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const name = `preprint-bridge-${version}.xpi`;
  const bytes = fs.readFileSync(path.join(root, 'dist', name));
  const checksum = Buffer.from(`${hash(bytes)}  ${name}\n`);
  return {
    version, tag: `v${version}`, name: `Preprint Bridge ${version}`,
    body: fs.readFileSync(path.join(root, 'releases', `${version}.md`), 'utf8'),
    repository: process.env.GITHUB_REPOSITORY || 'Kazuma-yj/preprint-bridge',
    sha: process.env.GITHUB_SHA,
    assets: [
      { name, bytes, type: 'application/x-xpinstall' },
      { name: 'SHA256SUMS.txt', bytes: checksum, type: 'text/plain' }
    ].map(asset => ({ ...asset, digest: `sha256:${hash(asset.bytes)}` }))
  };
}

function githubAPI(token) {
  return async (method, resource, { data, bytes, type, binary = false, allow404 = false } = {}) => {
    const url = new URL(resource.startsWith('https:') ? resource : `https://api.github.com${resource}`);
    if (!['api.github.com', 'uploads.github.com'].includes(url.hostname) || url.protocol !== 'https:') {
      throw Error('Unexpected GitHub API host');
    }
    const response = await fetch(url, {
      method, signal: AbortSignal.timeout(120_000),
      headers: {
        Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28',
        Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
        ...(bytes ? { 'Content-Type': type } : data ? { 'Content-Type': 'application/json' } : {})
      }, body: bytes || (data ? JSON.stringify(data) : undefined)
    });
    if (response.status === 404 && allow404) return null;
    if (!response.ok) throw Error(`GitHub ${method} ${url.pathname}: HTTP ${response.status}`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
}

async function verifyAsset(asset, expected, api) {
  if (asset.state !== 'uploaded' || asset.size !== expected.bytes.length) {
    throw Error(`Incomplete or different asset: ${expected.name}`);
  }
  const digest = asset.digest || `sha256:${hash(await api('GET', asset.url, { binary: true }))}`;
  if (digest !== expected.digest) throw Error(`Checksum mismatch: ${expected.name}; refusing to replace it`);
}

async function publish(plan, api) {
  if (plan.repository !== 'Kazuma-yj/preprint-bridge' || !/^[a-f0-9]{40}$/.test(plan.sha || '')) {
    throw Error('Publishing requires the canonical repository and an exact commit SHA');
  }
  const base = `/repos/${plan.repository}`;
  let release = await api('GET', `${base}/releases/tags/${plan.tag}`, { allow404: true });
  if (!release) {
    const tag = await api('GET', `${base}/git/ref/tags/${plan.tag}`, { allow404: true });
    if (tag && tag.object?.sha !== plan.sha) throw Error('Existing tag points to a different commit');
    release = await api('POST', `${base}/releases`, { data: {
      tag_name: plan.tag, target_commitish: plan.sha, name: plan.name,
      body: plan.body, draft: true, prerelease: false
    } });
  }
  if (release.draft && release.target_commitish !== plan.sha) {
    throw Error('Existing draft targets a different commit; inspect it before publishing');
  }
  for (const expected of plan.assets) {
    const existing = (release.assets || []).find(asset => asset.name === expected.name);
    if (existing) {
      await verifyAsset(existing, expected, api);
      continue;
    }
    if (!release.draft) throw Error(`Published release is missing ${expected.name}; refusing to change it`);
    const upload = new URL(release.upload_url.replace(/\{.*$/, ''));
    upload.searchParams.set('name', expected.name);
    const created = await api('POST', upload.href, { bytes: expected.bytes, type: expected.type });
    await verifyAsset(created, expected, api);
  }
  if (release.draft) {
    release = await api('PATCH', `${base}/releases/${release.id}`, {
      data: { draft: false, prerelease: false, make_latest: 'true' }
    });
  }
  if (release.draft || release.prerelease) throw Error('Release is not publicly published as a stable version');
  return release.html_url;
}

if (require.main === module) {
  (async () => {
    const plan = loadPlan();
    if (process.argv.includes('--dry-run')) {
      console.log(JSON.stringify({ tag: plan.tag, repository: plan.repository,
        assets: plan.assets.map(({ name, bytes, digest }) => ({ name, size: bytes.length, digest })) }, null, 2));
      return;
    }
    if (!process.env.GH_TOKEN) throw Error('GH_TOKEN is required for publishing');
    console.log('Published and verified: ' + await publish(plan, githubAPI(process.env.GH_TOKEN)));
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { publish, hash };
