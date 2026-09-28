const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function record(id, type, fields = {}, options = {}) {
  const data = { title: 'Example Paper', extra: '', ...fields };
  return {
    id, itemType: type, data, saves: 0, attachments: [id + 100],
    isRegularItem: () => !['attachment', 'note'].includes(type),
    isEditable: () => !options.readonly,
    getDisplayTitle: () => data.title,
    getCreators: () => [{ lastName: 'Smith' }],
    getField: name => data[name] || '',
    setField(name, value) { data[name] = value; },
    setType(type) { this.itemType = type; },
    toJSON() { return { ...data, itemType: this.itemType }; },
    fromJSON(snapshot) { this.itemType = snapshot.itemType; Object.assign(data, snapshot); delete data.itemType; },
    async saveTx() { if (options.fail) throw Error('Write unavailable'); this.saves++; }
  };
}

function setup({ request, confirm = () => true, selected = [] } = {}) {
  const menus = [], alerts = [], confirmations = [], launched = [], urls = [];
  const sandbox = vm.createContext({ URL, Zotero: {
    locale: 'en-US', debug() {}, getMainWindow: () => null,
    getActiveZoteroPane: () => ({ getSelectedItems: () => selected }),
    ItemTypes: { getID: type => type },
    MenuManager: { registerMenu(menu) { menus.push(menu); return menu.menuID; }, unregisterMenu() {} },
    launchURL(url) { launched.push(url); },
    HTTP: { async request(method, url) {
      urls.push(url);
      if (!request) throw Error('Unexpected network request');
      const response = await request(url);
      return { responseText: response.body, getResponseHeader: () => response.contentType || 'application/json' };
    } }
  }, Services: { prompt: {
    alert(_window, _title, body) { alerts.push(body); },
    confirm(_window, _title, body) { confirmations.push(body); return confirm(body); }
  } } });
  for (const file of ['core.js', 'ccf-data.js', 'ccf.js', 'plugin.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../content', file), 'utf8'), sandbox);
  }
  return { plugin: sandbox.PreprintBridge, menus, alerts, confirmations, launched, urls };
}

const papers = [
  record(1, 'preprint', { url: 'https://arxiv.org/abs/2403.06634' }),
  record(2, 'conferencePaper', { url: 'https://arxiv.org/abs/2604.21083', extra: '出版状态：已录用，待正式出版' }),
  record(3, 'conferencePaper', { url: 'https://proceedings.mlr.press/v235/carlini24a.html' }),
  record(4, 'conferencePaper', { url: 'https://doi.org/10.18653/v1/N19-1423' }),
  record(5, 'journalArticle', { publicationTitle: 'IEEE Transactions on Software Engineering' })
];

function state(menu, items) {
  const result = { visible: true, enabled: true };
  menu.onShowing?.(null, { items, setVisible(value) { result.visible = value; }, setEnabled(value) { result.enabled = value; } });
  return result;
}

test('one fixed submenu exposes identical commands for preprints, accepted, PMLR, other conferences and journals', () => {
  const { plugin, menus } = setup();
  plugin.start();
  assert.equal(menus.length, 1);
  const root = menus[0].menus[0];
  assert.equal(root.menuType, 'submenu');
  assert.deepEqual(Array.from(root.menus, menu => menu.l10nID || menu.menuType), [
    'preprint-bridge-review', 'preprint-bridge-ccf', 'preprint-bridge-arxiv',
    'preprint-bridge-advanced', 'separator', 'preprint-bridge-help'
  ]);
  for (const item of papers) {
    assert.equal(state(root, [item]).visible, true);
    for (const child of root.menus) assert.equal(state(child, [item]).visible, true);
    assert.equal(state(root.menus[0], [item]).enabled, true);
  }
  const attachment = record(6, 'attachment');
  assert.equal(state(root, [attachment]).visible, false);
  assert.equal(state(root.menus[0], [attachment]).enabled, false);
  for (const locale of ['en-US', 'zh-CN']) {
    const ftl = fs.readFileSync(path.join(__dirname, '../locale', locale, 'preprint-bridge.ftl'), 'utf8');
    for (const item of [root, ...root.menus].filter(m => m.l10nID)) assert.ok(ftl.includes(item.l10nID + ' ='));
    assert.doesNotMatch(ftl, /PMLR/);
  }
});

test('multi-selection and read-only items change enabled state, not menu names or visibility', () => {
  const { plugin, menus } = setup(); plugin.start();
  const children = menus[0].menus[0].menus;
  assert.equal(state(children[0], [papers[0], papers[2]]).enabled, true);
  assert.equal(state(children[1], [papers[0], papers[2]]).enabled, true);
  assert.equal(state(children[3].menus[0], [papers[0], papers[2]]).enabled, true);
  assert.equal(state(children[3].menus[0], [papers[2], papers[3]]).enabled, false);
  const readonly = record(7, 'conferencePaper', { extra: 'arXiv: 2403.06634' }, { readonly: true });
  assert.equal(state(children[0], [readonly]).enabled, false);
  assert.equal(state(children[1], [readonly]).enabled, false);
  assert.equal(state(children[2], [readonly]).enabled, true);
  assert.equal(state(children[5], [readonly]).enabled, true);
  for (const child of children) assert.equal(state(child, [readonly]).visible, true);
});

test('CCF batch updates only Extra, retaining user notes, acceptance state, identity and attachments', async () => {
  const accepted = record(10, 'conferencePaper', { conferenceName: 'IMC',
    extra: 'Reader note: keep\narXiv: 2604.21083\nCCF Rating (2026): C; IMC\n出版状态：已录用，待正式出版',
    DOI: '', date: '2026', url: 'https://arxiv.org/abs/2604.21083' });
  const journal = record(11, 'journalArticle', { publicationTitle: 'TSE', extra: 'User note' });
  const unmatched = record(12, 'conferencePaper', { conferenceName: 'FSE', extra: 'CCF (2026): B (FSE)' });
  const readonly = record(13, 'conferencePaper', { conferenceName: 'ICML' }, { readonly: true });
  const before = { ...accepted.data };
  const { plugin, urls, confirmations } = setup();
  const stats = await plugin.updateCCF([accepted, journal, unmatched, readonly, accepted]);
  assert.equal(stats.updated, 2);
  assert.equal(stats.unmatched, 1);
  assert.equal(stats.skipped, 1);
  assert.equal(confirmations.length, 1);
  assert.deepEqual(urls, []);
  assert.equal(accepted.data.extra, 'Reader note: keep\narXiv: 2604.21083\n出版状态：已录用，待正式出版\nCCF (2026): B (IMC)');
  for (const key of Object.keys(before).filter(key => key !== 'extra')) assert.equal(accepted.data[key], before[key]);
  assert.deepEqual(accepted.attachments, [110]);
  assert.equal(accepted.id, 10);
  assert.match(journal.data.extra, /^User note\nCCF \(2026\): A \(TSE\)$/);
  assert.equal(unmatched.data.extra, 'CCF (2026): B (FSE)');
  assert.equal(readonly.saves, 0);
  const again = await plugin.updateCCF([accepted, journal]);
  assert.equal(again.unchanged, 2);
  assert.equal(confirmations.length, 1);
});

test('CCF cancellation leaves all records untouched, and a failed write restores Extra while continuing', async () => {
  const first = record(20, 'conferencePaper', { conferenceName: 'ICML', extra: 'Keep' }, { fail: true });
  const second = record(21, 'conferencePaper', { conferenceName: 'ICLR' });
  const cancelled = setup({ confirm: () => false });
  assert.equal((await cancelled.plugin.updateCCF([first, second])).cancelled, true);
  assert.equal(first.data.extra, 'Keep'); assert.equal(second.saves, 0);
  const active = setup();
  const stats = await active.plugin.updateCCF([first, second]);
  assert.equal(stats.failed, 1); assert.equal(stats.updated, 1);
  assert.equal(first.data.extra, 'Keep'); assert.equal(second.saves, 1);
});

test('CCF batch skips a record edited after the preview', async () => {
  const item = record(30, 'conferencePaper', { conferenceName: 'ICML', extra: 'Original' });
  const { plugin } = setup({ confirm() { item.data.extra = 'New user note'; return true; } });
  const stats = await plugin.updateCCF([item]);
  assert.equal(stats.skipped, 1); assert.equal(item.saves, 0);
  assert.equal(item.data.extra, 'New user note');
});

test('arXiv shortcut works after conversion and never opens an arbitrary item URL', () => {
  const { plugin, launched } = setup();
  plugin.openArxiv([record(40, 'conferencePaper', { url: 'https://doi.org/10.1000/example', extra: 'arXiv: 2403.06634' })]);
  assert.deepEqual(launched, ['https://arxiv.org/abs/2403.06634']);
  plugin.openArxiv([record(41, 'journalArticle', { url: 'javascript:alert(1)' })]);
  assert.equal(launched.length, 1);
});

test('the unified command refreshes a journal by DOI without needing an arXiv identifier', async () => {
  const item = record(50, 'journalArticle', { DOI: 'https://doi.org/10.1000%2Fexample',
    publicationTitle: 'TSE', url: 'https://publisher.example/paper', date: '2024-03-15', extra: 'Keep' });
  const { plugin, urls, confirmations } = setup({ request(url) {
    assert.equal(url, 'https://api.crossref.org/works/10.1000%2Fexample');
    return { body: JSON.stringify({ message: { type: 'journal-article', DOI: '10.1000/example',
      title: ['Example Paper'], author: [{ given: 'Alex', family: 'Smith' }],
      'container-title': ['IEEE Transactions on Software Engineering'],
      published: { 'date-parts': [[2024]] }, page: '100-110', volume: '50' } }) };
  } });
  await plugin.checkItem(item);
  assert.equal(urls.length, 1); assert.equal(confirmations.length, 1);
  assert.equal(item.data.publicationTitle, 'IEEE Transactions on Software Engineering');
  assert.equal(item.data.date, '2024-03-15');
  assert.equal(item.data.DOI, '10.1000/example'); assert.equal(item.saves, 1);
  assert.equal(item.data.extra, 'Keep\nCCF (2026): A (TSE)');
  assert.equal(item.itemType, 'journalArticle'); assert.deepEqual(item.attachments, [150]);
});

test('CCF labels for full-title-only journals stay concise', async () => {
  const item = record(60, 'journalArticle', { publicationTitle: 'Machine Learning' });
  const { plugin } = setup();
  await plugin.updateCCF([item]);
  assert.equal(item.data.extra, 'CCF (2026): B');
});

test('disabling from a CCF review dialog prevents the queued writes', async () => {
  const item = record(61, 'conferencePaper', { conferenceName: 'ICML' });
  const env = setup({ confirm() { env.plugin.stop(); return true; } });
  const result = await env.plugin.updateCCF([item]);
  assert.equal(result.cancelled, true);
  assert.equal(item.saves, 0);
  assert.equal(item.data.extra, '');
});

test('publication review cancellation or disabling leaves the item unchanged', async () => {
  for (const disable of [false, true]) {
    const item = record(62, 'journalArticle', { DOI: '10.1000/example', publicationTitle: 'TSE' });
    const env = setup({
      confirm() { if (disable) env.plugin.stop(); return disable; },
      request: () => ({ body: JSON.stringify({ message: { type: 'journal-article', DOI: '10.1000/example',
        title: ['Example Paper'], author: [{ family: 'Smith' }], 'container-title': ['TSE'],
        published: { 'date-parts': [[2024]] } } }) })
    });
    await env.plugin.checkItem(item);
    assert.equal(env.confirmations.length, 1);
    assert.equal(item.saves, 0);
    assert.equal(item.data.extra, '');
    assert.equal(env.alerts.length, 0);
  }
});

test('completion of a disabled search does not unlock a new search for the same item', async () => {
  const pending = [];
  const env = setup({ request: () => new Promise(resolve => pending.push(resolve)) });
  const item = record(63, 'journalArticle', { DOI: '10.1000/example' });
  const old = env.plugin.checkItem(item);
  env.plugin.stop(); env.plugin.start();
  const current = env.plugin.checkItem(item);
  const reply = { body: JSON.stringify({ message: { type: 'journal-article', DOI: '10.1000/example',
    title: ['Example Paper'], author: [{ family: 'Smith' }], 'container-title': ['TSE'],
    published: { 'date-parts': [[2024]] } } }) };
  pending[0](reply); await old;
  assert.equal(env.plugin.menuState('review', [item]), false);
  pending[1](reply); await current;
  assert.equal(env.plugin.menuState('review', [item]), true);
  assert.equal(item.saves, 1);
});
