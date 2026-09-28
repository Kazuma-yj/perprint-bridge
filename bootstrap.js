/* global Zotero, Services, APP_SHUTDOWN */
var PreprintBridge;
var lifecycleGeneration = 0;

async function startup({ rootURI }) {
  const generation = ++lifecycleGeneration;
  await Zotero.initializationPromise;
  // Disable/uninstall can happen while initialization is pending. A stale
  // startup must not register menus after the user has disabled the add-on.
  if (generation !== lifecycleGeneration) return;
  PreprintBridge?.stop();
  // Zotero registers bundled locale/*.ftl files automatically. The scripts
  // are loaded directly from rootURI, so no chrome registration is needed.
  const scope = { Zotero, Services, URL };
  Services.scriptloader.loadSubScript(rootURI + "content/core.js", scope);
  Services.scriptloader.loadSubScript(rootURI + "content/ccf-data.js", scope);
  Services.scriptloader.loadSubScript(rootURI + "content/ccf.js", scope);
  Services.scriptloader.loadSubScript(rootURI + "content/plugin.js", scope);
  if (!scope.PreprintBridge) throw new Error("Preprint Bridge failed to load");
  PreprintBridge = scope.PreprintBridge;
  try {
    for (const window of Zotero.getMainWindows()) onMainWindowLoad({ window });
    PreprintBridge.start();
  } catch (error) {
    PreprintBridge.stop();
    PreprintBridge = undefined;
    Zotero.debug("[Preprint Bridge] Startup failed: " + (error.stack || error));
    throw error;
  }
}

function onMainWindowLoad({ window }) {
  window.MozXULElement?.insertFTLIfNeeded("preprint-bridge.ftl");
}

function onMainWindowUnload() {}

function shutdown(_data, reason) {
  ++lifecycleGeneration;
  if (reason === APP_SHUTDOWN) return;
  PreprintBridge?.stop();
  PreprintBridge = undefined;
  for (const window of Zotero.getMainWindows()) {
    window.document.querySelector('[href="preprint-bridge.ftl"]')?.remove();
  }
}

function install() {}
function uninstall() {}
