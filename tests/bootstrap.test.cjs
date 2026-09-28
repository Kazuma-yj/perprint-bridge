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
      registerMenu(menu) { menus.set(menu.menuID, menu); return menu.menuID; },
      unregisterMenu(id) { menus.delete(id); }
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
  assert.deepEqual([...menus.keys()], ['preprint-bridge-check', 'preprint-bridge-copy', 'preprint-bridge-refresh']);
  vm.runInContext('shutdown({}, 0)', sandbox);
  assert.equal(menus.size, 0);
  assert.equal(removedFTL, true);
});
