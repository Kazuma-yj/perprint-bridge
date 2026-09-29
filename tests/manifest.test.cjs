const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Zotero manifest includes the required update URL and matches package version', () => {
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const zotero = manifest.applications.zotero;
  assert.equal(manifest.version, pkg.version);
  assert.equal(zotero.id, 'preprint-bridge@research.local');
  assert.match(zotero.update_url, /^https:\/\/[^/]+\/.+\.json$/);
  assert.equal(zotero.update_url,
    'https://raw.githubusercontent.com/Kazuma-yj/preprint-bridge/main/update.json');
  assert.equal(zotero.strict_min_version, '10.0');
  assert.equal(zotero.strict_max_version, '10.0.*');
});
