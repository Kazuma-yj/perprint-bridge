/* Test-only companion add-on. Installed only into an isolated disposable
 * profile by scripts/zotero-smoke.py; never included in the release XPI. */
/* global Zotero, Services, IOUtils, PathUtils, ChromeUtils */
function startup() { void run(); }
function shutdown() {}
function install() {}
function uninstall() {}
const addonID = 'preprint-bridge@research.local';
const output = Services.env.get('PB_TEST_OUTPUT');
const expectBlank = Services.env.get('PB_TEST_EXPECT_BLANK') === '1';
const checks = [];
const assert = (condition, detail) => { if (!condition) throw Error(detail); checks.push(detail); };
async function until(callback, detail, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = callback();
    if (value) return value;
    await Zotero.Promise.delay(50);
  }
  throw Error('Timed out: ' + detail);
}
function windows() {
  const result = [], enumerator = Services.wm.getEnumerator(null);
  while (enumerator.hasMoreElements()) result.push(enumerator.getNext());
  return result;
}
function command() {
  return Zotero.MenuManager._menuManager.getCustomMenuOptions('main/library/item')
    .find(option => option.pluginID === addonID)?.menus[0].menus
    .find(menu => menu.l10nID === 'preprint-bridge-review');
}
async function open(items) {
  const before = new Set(windows());
  const menu = await until(command, 'installed plugin registers its menu');
  menu.onCommand(null, { items });
  return until(() => windows().find(window => !before.has(window)), 'review window opens');
}
function capture(win) {
  return { uri: win?.location.href, title: win?.document.title,
    heading: win?.document.getElementById('heading')?.textContent,
    rows: win?.document.querySelectorAll('.row').length || 0,
    text: win?.document.documentElement?.textContent.slice(0,8000) };
}
async function screenshot(win) {
  try {
    const canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
    canvas.width = win.innerWidth; canvas.height = win.innerHeight;
    canvas.getContext('2d').drawWindow(win, 0, 0, canvas.width, canvas.height, 'rgb(255,255,255)');
    const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0));
    await IOUtils.write(PathUtils.join(output, 'zotero-review.png'), bytes);
  } catch (error) { return String(error); }
  return null;
}
async function run() {
  let review, originalRequest;
  const report = { zoteroVersion: Zotero.version, expectBlank, checks };
  try {
    await Zotero.initializationPromise;
    await until(() => Zotero.getMainWindow()?.document.readyState === 'complete', 'main window ready', 60000);
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    const addon = await AddonManager.getAddonByID(addonID);
    assert(addon?.isActive, 'release XPI is installed and active');
    report.pluginVersion = addon.version;
    report.packageURI = addon.getResourceURI().spec;
    assert(report.packageURI.startsWith('jar:file:'), 'plugin loaded from the actual XPI');
    const fixture = JSON.parse(await IOUtils.readUTF8(Services.env.get('PB_TEST_FIXTURES'))).records[0].record;
    originalRequest = Zotero.HTTP.request;
    Zotero.HTTP.request = async function(method, url, ...args) {
      if (String(url).startsWith('https://api.crossref.org/works/')) {
        return { responseText: JSON.stringify({ message: fixture }), getResponseHeader: () => 'application/json' };
      }
      if (/arxiv|dblp|crossref|mlr\.press/.test(String(url))) throw Error('Unexpected publication request: ' + url);
      return originalRequest.call(this, method, url, ...args);
    };
    const item = new Zotero.Item('preprint');
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField('title', 'Random Forests');
    item.setField('DOI', fixture.DOI);
    item.setField('url', 'https://example.invalid/test-preprint');
    item.setField('extra', 'Keep this test note');
    item.setCreators([{ firstName: 'Leo', lastName: 'Breiman', creatorType: 'author' }]);
    await item.saveTx();
    const key = item.key, creators = JSON.stringify(item.getCreators());
    const note = new Zotero.Item('note');
    note.parentID = item.id; note.setNote('Retain this child note'); await note.saveTx();
    review = await open([item]);
    await Zotero.Promise.delay(1800);
    report.initialWindow = capture(review);
    if (expectBlank) {
      assert(!review.document.getElementById('heading'), '1.2.0 reproduces the blank native window');
      report.passed = true;
    } else {
      await until(() => review.document.querySelector('.row'), 'native window renders the review queue');
      assert(review.location.href === 'chrome://preprint-bridge/content/review.xhtml', 'registered chrome document loaded');
      assert(review.document.nodePrincipal.isSystemPrincipal, 'review window has the required system principal');
      assert(review.document.title === 'Preprint Bridge', 'window title is set');
      const rect = review.document.getElementById('heading').getBoundingClientRect();
      assert(rect.width > 0 && rect.height > 0, 'heading has visible layout');
      const session = review.arguments[0].session;
      await until(() => session.view().phase === 'idle', 'publication check finishes');
      report.afterLookup = capture(review);
      assert(session.view().rows[0].status === 'ready', 'real Zotero item clone produces an update preview');
      assert(review.document.querySelectorAll('#detail tbody tr').length > 0, 'field differences rendered in Gecko');
      const checkbox = review.document.querySelector('.row input'); checkbox.click();
      assert(!review.document.getElementById('apply').disabled, 'selecting a row enables update');
      review.document.getElementById('apply').click();
      await until(() => session.view().rows[0].status === 'updated' || session.view().rows[0].status === 'error', 'write finishes');
      assert(session.view().rows[0].status === 'updated', 'update saved in the real Zotero database');
      assert(item.itemType === 'journalArticle' && item.getField('publicationTitle') === 'Machine Learning', 'published fields are correct');
      assert(item.key === key && note.parentID === item.id && JSON.stringify(item.getCreators()) === creators, 'identity, child note and authors are retained');
      review.document.getElementById('undo').click();
      await until(() => session.view().rows[0].status === 'undone', 'undo finishes');
      assert(item.itemType === 'preprint' && item.getField('extra') === 'Keep this test note', 'undo restores the real item');
      review.close();
      await Zotero.Promise.delay(100);
      review = await open([item]);
      await until(() => review.document.querySelector('.row'), 'closed window reopens');
      assert(true, 'review window reopens after closing');
      await addon.disable();
      await until(() => review.closed && !command(), 'disable closes window and unregisters menu');
      let registered = true;
      try { Cc['@mozilla.org/chrome/chrome-registry;1'].getService(Ci.nsIChromeRegistry).convertChromeURL(Services.io.newURI('chrome://preprint-bridge/content/review.xhtml'));  }
      catch (_) { registered = false; }
      assert(!registered, 'disable unregisters chrome resources');
      await addon.enable();
      review = await open([item]);
      await until(() => review.document.querySelector('.row'), 're-enabled plugin opens window');
      assert(true, 'disable/re-enable registers a working window again');
      await until(() => review.arguments[0].session.view().phase === 'idle', 'final preview ready');
      report.finalWindow = capture(review);
      report.screenshotError = await screenshot(review);
      report.passed = true;
    }
  } catch (error) {
    report.passed = false;
    report.error = String(error.stack || error);
    report.window = capture(review);
    report.console = Services.console.getMessageArray().map(message => message.message).slice(-50);
  } finally {
    if (originalRequest) Zotero.HTTP.request = originalRequest;
    await IOUtils.writeUTF8(PathUtils.join(output, 'result.json'), JSON.stringify(report, null, 2));
  }
}
