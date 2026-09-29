const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publish, hash } = require('../scripts/publish-release.cjs');
const bytes = Buffer.from('example package');
const plan = { repository: 'Kazuma-yj/preprint-bridge', sha: 'a'.repeat(40), tag: 'v1.0.0',
  name: 'Preprint Bridge 1.0.0', body: 'Release notes',
  assets: [{ name: 'preprint-bridge-1.0.0.xpi', bytes, type: 'application/x-xpinstall', digest: `sha256:${hash(bytes)}` }] };
const asset = { name: plan.assets[0].name, size: bytes.length, digest: plan.assets[0].digest, state: 'uploaded' };
const release = { id: 1, draft: false, prerelease: false, target_commitish: plan.sha,
  html_url: 'https://github.com/Kazuma-yj/preprint-bridge/releases/tag/v1.0.0', assets: [asset] };

test('release reruns verify existing assets without changing a published release', async () => {
  const calls = [];
  assert.equal(await publish(plan, async (method, url) => { calls.push(method); return release; }), release.html_url);
  assert.deepEqual(calls, ['GET']);
});

test('a published checksum mismatch cannot be overwritten', async () => {
  await assert.rejects(publish(plan, async method => {
    assert.equal(method, 'GET');
    return { ...release, assets: [{ ...asset, digest: 'sha256:wrong' }] };
  }), /Checksum mismatch/);
});

test('a new release stays draft until the uploaded asset has been verified', async () => {
  const order = [];
  await publish(plan, async (method, url, options) => {
    if (method === 'GET') return null;
    if (url.includes('uploads.github.com')) {
      order.push('upload'); assert.deepEqual(options.bytes, bytes); return asset;
    }
    if (method === 'POST') {
      order.push('draft'); assert.equal(options.data.draft, true);
      return { ...release, draft: true, assets: [], upload_url: 'https://uploads.github.com/repos/owner/repo/releases/1/assets{?name,label}' };
    }
    assert.equal(method, 'PATCH'); assert.equal(options.data.draft, false);
    order.push('publish'); return release;
  });
  assert.deepEqual(order, ['draft', 'upload', 'publish']);
});

test('failed asset upload prevents draft publication', async () => {
  const calls = [];
  await assert.rejects(publish(plan, async (method, url) => {
    calls.push(method);
    if (method === 'GET') return { ...release, draft: true, assets: [], upload_url: 'https://uploads.github.com/example{?name}' };
    if (method === 'POST') throw Error('Upload unavailable');
    throw Error('Must not publish');
  }), /Upload unavailable/);
  assert.deepEqual(calls, ['GET', 'POST']);
});

test('an existing tag on another commit is never moved', async () => {
  await assert.rejects(publish(plan, async (method, url) => {
    assert.equal(method, 'GET');
    return url.includes('/git/ref/') ? { object: { sha: 'b'.repeat(40) } } : null;
  }), /different commit/);
});
