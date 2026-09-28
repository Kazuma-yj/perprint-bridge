const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('Zotero 10 startup loads the plugin and registers menus; shutdown removes them', async () => {
  const menus = new Map();
  let removedFTL = false;
  const window = {
    MozXULElement: { insertFTLIfNeeded(file) { assert.equal(file, 'preprint-bridge.ftl'); } },
    document: { querySelector(selector) {
      assert.equal(selector, '[href="preprint-bridge.ftl"]');
      return { remove() { removedFTL = true; } };
    } }
  };
  const Zotero = {
    initializationPromise: Promise.resolve(),
    getMainWindows: () => [window],
    MenuManager: {
      registerMenu(menu) {
        const id = `${menu.pluginID}-${menu.menuID}`;
        if (menus.has(id)) return false;
        menus.set(id, menu);
        return id;
      },
      unregisterMenu(id) {
        assert.notEqual(id, false);
        return menus.delete(id);
      }
    },
    debug() {}
  };
  const Services = { scriptloader: { loadSubScript(uri, target) {
    const relative = uri.replace('file:///plugin/', '');
    assert.ok(['content/core.js', 'content/ccf-data.js', 'content/ccf.js', 'content/plugin.js'].includes(relative));
    vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), vm.createContext(target));
  } } };
  const sandbox = vm.createContext({ Zotero, Services, APP_SHUTDOWN: 99 });
  vm.runInContext(fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8'), sandbox);
  await vm.runInContext('startup({ rootURI: "file:///plugin/" })', sandbox);
  assert.deepEqual([...menus.keys()], [
    'preprint-bridge@research.local-preprint-bridge-check',
    'preprint-bridge@research.local-preprint-bridge-copy',
    'preprint-bridge@research.local-preprint-bridge-refresh'
  ]);
  // Restarting within the same process must replace our menus without leaving
  // false registration IDs behind.
  await vm.runInContext('startup({ rootURI: "file:///plugin/" })', sandbox);
  assert.equal(menus.size, 3);
  vm.runInContext('shutdown({}, 0)', sandbox);
  assert.equal(menus.size, 0);
  menus.set('preprint-bridge@research.local-preprint-bridge-check', {});
  await vm.runInContext('startup({ rootURI: "file:///plugin/" })', sandbox);
  assert.equal(menus.size, 3);
  vm.runInContext('shutdown({}, 0)', sandbox);
  assert.equal(menus.size, 0);
  assert.equal(removedFTL, true);
});
