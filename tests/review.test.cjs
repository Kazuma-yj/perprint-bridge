const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../content', name + '.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ request, confirm = () => true } = {}) {
  let clock = 10000;
  const urls = [], prompts = [], windows = [];
  class Item {
    constructor(id, data = {}, settings = {}) {
      this.id = id; this.itemType = data.itemType || 'preprint'; this.data = { title: 'Example Paper', extra: '', creators: [{ creatorType: 'author', lastName: 'Smith' }], tags: [], collections: ['COLL'], ...plain(data) };
      delete this.data.itemType;
      this.settings = settings; this.saves = 0; this.attachments = [100 + (id || 0)];
    }
    isRegularItem() { return !['attachment', 'note'].includes(this.itemType); }
    isEditable() { return !this.settings.readonly; }
    getDisplayTitle() { return this.data.title; }
    getCreators() { return this.data.creators; }
    getField(field) { return this.data[field] || ''; }
    setField(field, value) { this.data[field] = value; }
    setType(type) { this.itemType = type; if (type !== 'preprint') delete this.data.archiveID; }
    clone() { return new Item(undefined, this.toJSON()); }
    toJSON() { return plain({ ...this.data, itemType: this.itemType, key: this.id === undefined ? undefined : 'KEY' + this.id }); }
    fromJSON(json, options) { assert.equal(options?.strict, true, 'snapshots must not migrate user Extra'); this.itemType = json.itemType; this.data = plain(json); delete this.data.itemType; delete this.data.key; }
    async saveTx() { if (this.settings.fail) throw Error('Disk full'); this.saves++; this.data.dateModified = String(clock++); }
  }
  const sandbox = vm.createContext({ URL, Date: class extends Date { static now() { return clock; } }, Zotero: {
    locale: 'en-US', debug() {}, ItemTypes: { getID: x => x }, ItemFields: { getLocalizedString: x => x },
    Promise: { async delay(ms) { clock += ms; } },
    MenuManager: { unregisterMenu() {} },
    getMainWindow: () => ({ openDialog(url, name, options, controller) {
      const window = { url, controller, closed: false, focused: 0, close() { this.closed = true; controller.onClose(); }, focus() { this.focused++; } };
      windows.push(window); return window;
    } }),
    HTTP: { async request(method, url) {
      urls.push(url);
      const reply = request ? await request(url) : { message: { type: 'journal-article', DOI: '10.1000/example', title: ['Example Paper'], author: [{ family: 'Smith' }], 'container-title': ['Machine Learning'], published: { 'date-parts': [[2024]] }, page: '1-10', volume: '50' } };
      return { responseText: JSON.stringify(reply), getResponseHeader: () => 'application/json' };
    } }
  }, Services: { prompt: { alert() { throw Error('No alert expected'); }, confirm(_w, _t, body) { prompts.push(body); return confirm(body); } } } });
  for (const name of ['core', 'ccf-data', 'ccf', 'review-model', 'plugin']) vm.runInContext(source(name), sandbox);
  const item = (id, data, settings) => new Item(id, { DOI: '10.1000/example', url: 'https://arxiv.org/abs/2401.01234', archiveID: '2401.01234', ...data }, settings);
  return { plugin: sandbox.PreprintBridge, model: sandbox.PreprintBridgeReviewModel, item, urls, prompts, windows };
}

test('batch preview shows real type-conversion losses; selection updates only chosen items and undo restores the snapshot', async () => {
  const env = harness(), first = env.item(1, { extra: 'User note\nType: untouched' }), second = env.item(2);
  const before = first.toJSON();
  const queue = env.plugin.createReview([first, second, first]);
  await queue.scan();
  let view = queue.view();
  assert.equal(view.rows.length, 2); assert.equal(first.saves, 0);
  assert.equal(view.rows[0].selected, false);
  assert.ok(view.rows[0].result.previews[0].some(change => change.field === 'archiveID' && !change.after));
  assert.ok(view.rows[0].result.previews[0].some(change => change.field === 'itemType' && change.after === 'journalArticle'));
  queue.select(1, true); await queue.applySelected();
  assert.equal(first.saves, 1); assert.equal(second.saves, 0);
  for (const change of view.rows[0].result.previews[0]) assert.deepEqual(first.toJSON()[change.field] || '', plain(change.after));
  assert.deepEqual(first.attachments, [101]); assert.equal(first.id, 1);
  assert.equal(queue.view().rows[0].status, 'updated');
  await queue.undoAll();
  const restored = first.toJSON(); delete restored.dateModified;
  assert.deepEqual(restored, before);
  assert.equal(queue.view().rows[0].status, 'undone');
});

test('changed items require fresh differences, then can explicitly overwrite even a manually edited title', async () => {
  const env = harness(), item = env.item(1), queue = env.plugin.createReview([item]);
  await queue.scan(); queue.select(1, true);
  item.data.title = 'My edited title'; item.data.extra = 'New note';
  await queue.applySelected();
  assert.equal(item.saves, 0); assert.equal(queue.view().rows[0].conflict, 'apply');
  queue.rebase(1);
  let row = queue.view().rows[0];
  assert.equal(row.selected, false); assert.equal(row.status, 'ready'); assert.equal(row.result.manualOverride, true);
  assert.equal(row.result.previews[0].find(change => change.field === 'title').before, 'My edited title');
  queue.select(1, true); await queue.applySelected();
  assert.equal(item.data.title, 'Example Paper'); assert.match(item.data.extra, /^New note/);
  await queue.undoAll();
  assert.equal(item.data.title, 'My edited title'); assert.equal(item.data.extra, 'New note');
});

test('undo protects later edits and allows a separately confirmed overwrite with current values in the prompt', async () => {
  let allow = false;
  const env = harness({ confirm: () => allow }), item = env.item(1), queue = env.plugin.createReview([item]);
  const before = item.toJSON();
  await queue.scan(); queue.select(1, true); await queue.applySelected();
  item.data.pages = 'Edited pages'; item.data.tags.push({ tag: 'Later tag' });
  await queue.undoAll();
  assert.equal(item.data.pages, 'Edited pages'); assert.equal(queue.view().rows[0].conflict, 'undo');
  await queue.undoAll(1, true);
  assert.equal(item.saves, 1); assert.match(env.prompts[0], /Edited pages/); assert.match(env.prompts[0], /Later tag/);
  allow = true; await queue.undoAll(1, true);
  const restored = item.toJSON(); delete restored.dateModified;
  assert.deepEqual(restored, before); assert.equal(item.saves, 2);
});

test('a second edit after re-preview is protected, and failed writes/undo restore in-memory fields', async () => {
  const env = harness(), item = env.item(1), queue = env.plugin.createReview([item]);
  await queue.scan(); queue.select(1, true); item.data.extra = 'First edit'; await queue.applySelected();
  queue.rebase(1); queue.select(1, true); item.data.extra = 'Second edit'; await queue.applySelected();
  assert.equal(item.saves, 0); assert.equal(item.data.extra, 'Second edit');
  queue.rebase(1); queue.select(1, true); item.settings.fail = true;
  await queue.applySelected(); assert.equal(item.itemType, 'preprint'); assert.equal(item.data.extra, 'Second edit');
  item.settings.fail = false; await queue.scan({ retry: true }); queue.select(1, true); await queue.applySelected();
  const updated = item.toJSON(); item.settings.fail = true; await queue.undoAll();
  assert.deepEqual(item.toJSON(), updated); assert.equal(queue.view().rows[0].canUndo, true);
});

test('read-only, incomplete and failed rows do not block later papers; no candidates never writes', async () => {
  const env = harness(), readonly = env.item(1, {}, { readonly: true }), missing = env.item(2, { creators: [] }), failing = env.item(3, {}, { fail: true }), valid = env.item(4);
  const queue = env.plugin.createReview([readonly, missing, failing, valid]);
  await queue.scan();
  assert.equal(env.urls.length, 2);
  queue.selectFormal(true); await queue.applySelected();
  assert.equal(readonly.saves, 0); assert.equal(missing.saves, 0); assert.equal(failing.saves, 0); assert.equal(valid.saves, 1);
  assert.equal(queue.view().rows[2].status, 'error');
});

test('sequential queue cancels an in-flight search, resumes only unfinished rows, and deduplicates appended items', async () => {
  const { model } = harness(); let resolve, calls = [], active = 0, peak = 0;
  const result = { status: 'found', candidates: [{ title: 'Paper' }], previews: [[{ field: 'date', before: '', after: '2024' }]] };
  const queue = model.create({ async check(id) {
    calls.push(id); peak = Math.max(peak, ++active);
    if (id === 1 && calls.length === 1) await new Promise(r => { resolve = r; });
    active--; return result;
  } });
  queue.add([{ id: 1 }, { id: 2 }]);
  const running = queue.scan(); queue.cancel();
  await queue.scan({ retry: true }); // cannot race an outstanding operation
  resolve(); await running;
  assert.deepEqual(calls, [1]); assert.equal(queue.view().rows[0].status, 'cancelled');
  queue.add([{ id: 2 }, { id: 3 }]); await queue.scan({ retry: true });
  assert.deepEqual(calls, [1, 1, 2, 3]); assert.equal(peak, 1);
  await queue.scan({ retry: true }); assert.equal(calls.length, 4);
});

test('accepted-only rows require individual selection and candidates with no differences remain unselected', async () => {
  const { model } = harness(), writes = [];
  const queue = model.create({ async check(id) { return { candidates: [{ publicationStatus: id === 2 ? 'accepted' : '' }], previews: [id === 3 ? [] : [{ field: 'date', after: '2026' }]] }; }, async apply(id) { writes.push(id); return {}; } });
  queue.add([1, 2, 3].map(id => ({ id })));
  await queue.scan(); queue.selectFormal(true);
  assert.deepEqual(plain(queue.view().rows.map(row => row.selected)), [true, false, false]);
  queue.select(2, true); await queue.applySelected();
  assert.deepEqual(writes, [1, 2]);
});

test('stop during a save lets that transaction finish, keeps undo, and does not save the next paper', async () => {
  const { model } = harness(); let finish;
  const writes = [], undos = [];
  const queue = model.create({
    async check() { return { candidates: [{}], previews: [[{ field: 'date', after: '2024' }]] }; },
    async apply(id) { writes.push(id); await new Promise(resolve => { finish = resolve; }); return { id }; },
    async undo(id) { undos.push(id); }
  });
  queue.add([{ id: 1 }, { id: 2 }]); await queue.scan(); queue.selectFormal(true);
  const saving = queue.applySelected(); queue.cancel(); finish(); await saving;
  assert.deepEqual(writes, [1]);
  assert.equal(queue.view().rows[0].canUndo, true);
  assert.equal(queue.view().rows[1].status, 'ready');
  await queue.undoAll(); assert.deepEqual(undos, [1]);
});

test('changing a candidate resets selection and displays that candidate’s changes', async () => {
  const { model } = harness(); let chosen;
  const queue = model.create({ async check() { return { candidates: [{ source: 'A' }, { source: 'B' }], previews: [[{ after: '2024' }], [{ after: '2025' }]] }; }, async apply(_id, _result, index) { chosen = index; return {}; } });
  queue.add([{ id: 1 }]); await queue.scan(); queue.select(1, true); queue.chooseCandidate(1, 1);
  assert.equal(queue.view().rows[0].selected, false);
  queue.select(1, true); await queue.applySelected(); assert.equal(chosen, 1);
});

test('closing or disabling cancels search and prevents later writes; reopening uses a new window', async () => {
  const env = harness(), item = env.item(1);
  env.plugin.openReview([item]);
  const first = env.windows[0]; assert.equal(first.url, 'chrome://preprint-bridge/content/review.xhtml');
  env.plugin.openReview([item, env.item(2)]); assert.equal(env.windows.length, 1); assert.equal(first.focused, 1);
  const queue = first.controller.session;
  // openReview appends and starts scanning asynchronously
  await new Promise(setImmediate);
  queue.selectFormal(true); env.plugin.stop(); await queue.applySelected();
  assert.equal(item.saves, 0); assert.equal(first.closed, true);
  env.plugin.openReview([item]); assert.equal(env.windows.length, 2);
  env.windows[1].close();
});

test('pacing spaces requests, aborts during a wait, and cools down both DBLP hosts after 429', async () => {
  const { model } = harness(); let clock = 0; const times = [];
  const paced = model.pacedRequest(async url => { times.push([url, clock]); if (url.includes('/limited')) throw Object.assign(Error('limited'), { status: 429 }); return {}; },
    { now: () => clock, wait: async ms => { clock += ms; }, interval: 1000 });
  await paced('https://dblp.org/first'); await paced('https://sparql.dblp.org/second');
  assert.equal(times[1][1] - times[0][1], 1000);
  await assert.rejects(paced('https://dblp.org/limited'), /limited/);
  await assert.rejects(paced('https://sparql.dblp.org/next'), /429/);
  await paced('https://api.crossref.org/works'); assert.equal(times.length, 4);
  let cancelled = false;
  const other = model.pacedRequest(async () => ({}), { now: () => clock, wait: async ms => { clock += ms; cancelled = true; } });
  await other('https://arxiv.org/first');
  await assert.rejects(other('https://arxiv.org/second', {}, () => { if (cancelled) throw Error('Cancelled'); }), /Cancelled/);
});
