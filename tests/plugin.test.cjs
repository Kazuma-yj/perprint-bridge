const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('publication update preserves identity and attachment state, replaces arXiv DOI', async () => {
  const fields = { url: 'https://arxiv.org/abs/2502.07776', DOI: '10.48550/ARXIV.2502.07776',
    title: 'Auditing Prompt Caching in Language Model APIs', date: '2025', extra: 'User note: keep me',
    libraryCatalog: 'DOI.org (DataCite)', accessDate: '2026-09-27 23:17:11' };
  const attachments = [101, 102];
  const item = {
    id: 42, key: 'SAMEKEY', itemType: 'preprint', attachments,
    getDisplayTitle() { return fields.title; },
    getField(name) { return fields[name] || ''; },
    setType() { this.itemType = 'conferencePaper'; },
    setField(name, value) { fields[name] = value; },
    toJSON() { return { ...fields }; },
    fromJSON(snapshot) { Object.assign(fields, snapshot); },
    async saveTx() { this.saves = (this.saves || 0) + 1; }
  };
  const sandbox = vm.createContext({ URL, Zotero: {
    locale: 'zh-CN', ItemTypes: { getID: type => type },
    debug() {}, MenuManager: { registerMenu() { return 'menu'; }, unregisterMenu() {} }
  }, Services: { prompt: {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/core.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/ccf-data.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/ccf.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/plugin.js'), 'utf8'), sandbox);
  const plugin = vm.runInContext('PreprintBridge', sandbox);
  await plugin.apply(item, {
    itemType: 'conferencePaper', title: 'Auditing Prompt Caching in Language Model APIs',
    venue: 'Proceedings of the 42nd International Conference on Machine Learning',
    conferenceName: '42nd International Conference on Machine Learning',
    year: '2025', pages: '20477-20496', volume: '267',
    series: 'Proceedings of Machine Learning Research',
    catalog: 'Proceedings of Machine Learning Research',
    publisher: 'PMLR', url: 'https://proceedings.mlr.press/v267/gu25b.html',
    ccf: { grade: 'A', acronym: 'ICML', area: '人工智能', kind: 'conference', page: 57 }
  }, '2502.07776');
  assert.equal(item.id, 42);
  assert.equal(item.key, 'SAMEKEY');
  assert.deepEqual(item.attachments, [101, 102]);
  assert.equal(fields.DOI, '');
  assert.match(fields.extra, /User note: keep me/);
  assert.match(fields.extra, /arXiv: 2502\.07776/);
  assert.match(fields.extra, /Original preprint URL:/);
  assert.match(fields.extra, /Original catalog: DOI.org \(DataCite\)/);
  assert.match(fields.extra, /Original preprint access date: 2026-09-27/);
  assert.match(fields.extra, /CCF Rating \(2026\): A; ICML;/);
  assert.equal(fields.accessDate, '');
  assert.equal(fields.libraryCatalog, 'Proceedings of Machine Learning Research');
  assert.equal(fields.series, 'Proceedings of Machine Learning Research');
  assert.equal(fields.proceedingsTitle, 'Proceedings of the 42nd International Conference on Machine Learning');
  assert.equal(item.saves, 1);
});

test('existing PMLR record refreshes edition and CCF rank without replacing item or PDF', async () => {
  const fields = {
    title: 'Auditing Prompt Caching in Language Model APIs',
    url: 'https://proceedings.mlr.press/v267/gu25b.html',
    extra: 'arXiv:2502.07776 [cs.CL]\nOriginal preprint URL: https://arxiv.org/abs/2502.07776',
    DOI: '', date: '2025', libraryCatalog: 'DOI.org (DataCite)',
    accessDate: '2026-09-27 23:17:11'
  };
  const pdfs = [99];
  const item = {
    id: 42, itemType: 'conferencePaper', pdfs,
    isRegularItem: () => true, getCreators: () => [{ lastName: 'Gu' }],
    getDisplayTitle: () => fields.title,
    getField: name => fields[name] || '',
    setField(name, value) { fields[name] = value; },
    setType() { throw Error('refresh must not change the item type'); },
    toJSON: () => ({ ...fields }),
    fromJSON(snapshot) { Object.assign(fields, snapshot); },
    async saveTx() { this.saved = true; }
  };
  const html = `<meta name="citation_title" content="Auditing Prompt Caching in Language Model APIs">
    <meta name="citation_author" content="Chenchen Gu">
    <meta name="citation_publication_date" content="2025/10/06">
    <meta name="citation_firstpage" content="20477">
    <meta name="citation_lastpage" content="20496">
    <pre>@InProceedings{pmlr-v267-gu25b,
    booktitle = {Proceedings of the 42nd International Conference on Machine Learning},
    series = {Proceedings of Machine Learning Research}
    }</pre>`;
  const confirmations = [];
  const sandbox = vm.createContext({ URL, Zotero: {
    locale: 'zh-CN', initializationPromise: Promise.resolve(),
    getMainWindow: () => null, ItemTypes: { getID: x => x }, debug() {},
    HTTP: { async request(_method, url) {
      assert.equal(url, fields.url);
      return { responseText: html, getResponseHeader: () => 'text/html' };
    } }
  }, Services: { prompt: {
    alert() {}, confirm(_win, _title, body) { confirmations.push(body); return true; }
  } } });
  for (const file of ['core.js', 'ccf-data.js', 'ccf.js', 'plugin.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'content', file), 'utf8'), sandbox);
  }
  const plugin = vm.runInContext('PreprintBridge', sandbox);
  await plugin.refreshPMLR(item);
  assert.equal(item.saved, true);
  assert.equal(item.itemType, 'conferencePaper');
  assert.deepEqual(item.pdfs, [99]);
  assert.match(confirmations[0], /CCF A/);
  assert.equal(fields.proceedingsTitle, 'Proceedings of the 42nd International Conference on Machine Learning');
  assert.equal(fields.date, '2025-10-06');
  assert.equal(fields.libraryCatalog, 'Proceedings of Machine Learning Research');
  assert.equal(fields.accessDate, '');
  assert.match(fields.extra, /CCF Rating \(2026\): A; ICML;/);
});
