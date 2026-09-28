/* global Zotero, Services, Cc, Ci, APP_SHUTDOWN */
var PreprintBridge;
var lifecycleGeneration = 0;
var chromeHandle;

async function startup({ rootURI }) {
  const generation = ++lifecycleGeneration;
  await Zotero.initializationPromise;
  // Disable/uninstall can happen while initialization is pending. A stale
  // startup must not register menus after the user has disabled the add-on.
  if (generation !== lifecycleGeneration) return;
  PreprintBridge?.stop();
  PreprintBridge = undefined;
  chromeHandle?.destruct();
  chromeHandle = undefined;
  try {
    // openDialog() creates a privileged Gecko window. Its document must be a
    // registered chrome resource, not a jar:file: URL from the XPI.
    chromeHandle = Cc["@mozilla.org/addons/addon-manager-startup;1"]
      .getService(Ci.amIAddonManagerStartup)
      .registerChrome(Services.io.newURI(rootURI + "manifest.json"), [
        ["content", "preprint-bridge", "content/"]
      ]);
    const scope = { Zotero, Services, URL };
    for (const name of ["core", "ccf-data", "ccf", "review-model", "plugin"]) {
      Services.scriptloader.loadSubScript(rootURI + "content/" + name + ".js", scope);
    }
    if (!scope.PreprintBridge) throw new Error("Preprint Bridge failed to load");
    PreprintBridge = scope.PreprintBridge;
    for (const window of Zotero.getMainWindows()) onMainWindowLoad({ window });
    PreprintBridge.start();
  } catch (error) {
    PreprintBridge?.stop();
    PreprintBridge = undefined;
    chromeHandle?.destruct();
    chromeHandle = undefined;
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
  chromeHandle?.destruct();
  chromeHandle = undefined;
  for (const window of Zotero.getMainWindows()) {
    window.document.querySelector('[href="preprint-bridge.ftl"]')?.remove();
  }
}

function install() {}
function uninstall() {}
