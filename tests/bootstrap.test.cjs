const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('Zotero 10 startup loads the plugin and registers menus; shutdown removes them', async () => {
  const menus = new Map();
  const chrome = new Set();
  let registrations = 0, destructions = 0;
  const Cc = { '@mozilla.org/addons/addon-manager-startup;1': { getService() {
    return { registerChrome(uri, resources) {
      assert.equal(uri, 'file:///plugin/manifest.json');
      assert.deepEqual(JSON.parse(JSON.stringify(resources)), [['content', 'preprint-bridge', 'content/']]);
      assert.equal(chrome.size, 0, 'old registration must be released first');
      registrations++;
      const handle = { destruct() { assert.equal(chrome.delete(handle), true); destructions++; } };
      chrome.add(handle); return handle;
    } };
  } } };
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
  const Services = { io: { newURI: uri => uri }, scriptloader: { loadSubScript(uri, target) {
    const relative = uri.replace('file:///plugin/', '');
    assert.ok(['content/core.js', 'content/ccf-data.js', 'content/ccf.js', 'content/review-model.js', 'content/plugin.js'].includes(relative));
    vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), vm.createContext(target));
  } } };
  const sandbox = vm.createContext({ Zotero, Services, Cc, Ci: { amIAddonManagerStartup: 'startup' }, URL, APP_SHUTDOWN: 99 });
  vm.runInContext(fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8'), sandbox);
  // Zotero resolves these names on the bootstrap global, including before
  // startup. The reported missing-shutdown warning must not be caused by
  // accidentally packaging/exporting only startup.
  for (const method of ['startup', 'shutdown', 'install', 'uninstall', 'onMainWindowLoad', 'onMainWindowUnload']) {
    assert.equal(typeof sandbox[method], 'function', method);
  }
  await vm.runInContext('startup({ rootURI: "file:///plugin/" })', sandbox);
  assert.deepEqual([...menus.keys()], [
    'preprint-bridge@research.local-preprint-bridge-main'
  ]);
  // Restarting within the same process must replace our menus without leaving
  // false registration IDs behind.
  await vm.runInContext('startup({ rootURI: "file:///plugin/" })', sandbox);
  assert.equal(menus.size, 1);
  vm.runInContext('shutdown({}, 0)', sandbox);
  assert.equal(menus.size, 0);
  menus.set('preprint-bridge@research.local-preprint-bridge-main', {});
  await vm.runInContext('startup({ rootURI: "file:///plugin/" })', sandbox);
  assert.equal(menus.size, 1);
  vm.runInContext('shutdown({}, 0)', sandbox);
  assert.equal(menus.size, 0);
  assert.equal(removedFTL, true);
  assert.equal(chrome.size, 0);
  assert.equal(registrations, 3);
  assert.equal(destructions, 3);
});

test('disabling while Zotero initializes cancels the pending startup', async () => {
  let resolveInitialization;
  let loads = 0;
  const sandbox = vm.createContext({ URL, APP_SHUTDOWN: 99,
    Zotero: { initializationPromise: new Promise(resolve => { resolveInitialization = resolve; }), getMainWindows: () => [] },
    Services: { scriptloader: { loadSubScript() { loads++; } } }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8'), sandbox);
  const pending = sandbox.startup({ rootURI: 'file:///plugin/' });
  sandbox.shutdown({}, 4);
  resolveInitialization();
  await pending;
  assert.equal(loads, 0);
  assert.equal(sandbox.PreprintBridge, undefined);
});

test('failed startup releases chrome registration and a later startup can retry', async () => {
  let registrations = 0, destructions = 0;
  const sandbox = vm.createContext({ URL, APP_SHUTDOWN: 99, Ci: {},
    Cc: { '@mozilla.org/addons/addon-manager-startup;1': { getService() { return {
      registerChrome() { registrations++; return { destruct() { destructions++; } }; }
    }; } } },
    Zotero: { initializationPromise: Promise.resolve(), getMainWindows: () => [], debug() {} },
    Services: { io: { newURI: uri => uri }, scriptloader: { loadSubScript() { throw Error('Bad script'); } } }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8'), sandbox);
  for (let i = 1; i <= 2; i++) {
    await assert.rejects(sandbox.startup({ rootURI: 'file:///plugin/' }), /Bad script/);
    assert.equal(registrations, i); assert.equal(destructions, i);
    assert.equal(sandbox.PreprintBridge, undefined); assert.equal(sandbox.chromeHandle, undefined);
  }
});
