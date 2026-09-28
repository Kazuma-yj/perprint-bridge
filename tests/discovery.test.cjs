const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/core.js'), 'utf8'), context);
const core = vm.runInContext('PreprintBridgeCore', context);
const title = 'Auditing prompt caching in language model APIs';
const pmlrPage = `
<meta name="citation_title" content="Auditing Prompt Caching in Language Model APIs"/>
<meta name="citation_author" content="Chenchen Gu">
<meta name="citation_author" content="Xiang Lisa Li">
<meta name="citation_conference_title" content="International Conference on Machine Learning">
<meta name="citation_publication_date" content="2025/10/06">
<meta name="citation_firstpage" content="20477">
<meta name="citation_lastpage" content="20496">
<meta name="citation_pdf_url" content="https://example.org/paper.pdf">
<pre>@InProceedings{pmlr-v267-gu25b,
  booktitle = {Proceedings of the 42nd International Conference on Machine Learning},
  series = {Proceedings of Machine Learning Research},
  volume = {267}
}</pre>`;
const pages = new Map([
  ['https://arxiv.org/abs/2502.07776', '<td class="tablecell comments mathjax">Accepted at ICML 2025</td>'],
  ['https://proceedings.mlr.press/', '<li><a href="v267"><b>Volume 267</b></a> Proceedings of ICML 2025</li>'],
  ['https://proceedings.mlr.press/v267/', `<div class="paper"><p class="title">Auditing Prompt Caching in Language Model APIs</p><span class="authors">Chenchen Gu,&nbsp;Xiang Lisa Li</span><a href="https://proceedings.mlr.press/v267/gu25b.html">abs</a></div>`],
  ['https://proceedings.mlr.press/v267/gu25b.html', pmlrPage]
]);

test('arXiv ID extraction handles URL, Extra, and DOI', () => {
  assert.equal(core.arxivID('https://arxiv.org/abs/2502.07776v2'), '2502.07776');
  assert.equal(core.arxivID('arXiv:2502.07776 [cs.CL]'), '2502.07776');
  assert.equal(core.arxivID('10.48550/arXiv.2502.07776'), '2502.07776');
});

test('ICML paper resolves through PMLR without calling DBLP', async () => {
  const urls = [];
  const found = await core.discover({ title, firstAuthor: 'Gu', arxivId: '2502.07776' }, async url => {
    urls.push(url);
    if (!pages.has(url)) throw Error('Unexpected URL ' + url);
    return { body: pages.get(url), contentType: 'text/html' };
  });
  assert.equal(found.status, 'found');
  assert.equal(found.candidates[0].url, 'https://proceedings.mlr.press/v267/gu25b.html');
  assert.equal(found.candidates[0].venue, 'Proceedings of the 42nd International Conference on Machine Learning');
  assert.equal(found.candidates[0].conferenceName, '42nd International Conference on Machine Learning');
  assert.equal(found.candidates[0].series, 'Proceedings of Machine Learning Research');
  assert.equal(found.candidates[0].date, '2025-10-06');
  assert.equal(found.candidates[0].pages, '20477-20496');
  assert.equal(urls.length, 4);
  assert.ok(!urls.some(u => u.includes('dblp.org')));
});

test('HTTP 200 HTML challenge is an error and Crossref is still checked', async () => {
  const found = await core.discover({ title, firstAuthor: 'Gu', arxivId: null }, async url => {
    if (url.includes('dblp.')) return { body: '<!doctype html><title>Making sure you are not a bot</title>', contentType: 'text/html' };
    return { body: JSON.stringify({ message: { items: [{
      type: 'proceedings-article', title: [title], DOI: '10.1000/example',
      author: [{ given: 'Chenchen', family: 'Gu' }],
      'container-title': ['ICML Proceedings'], published: { 'date-parts': [[2025]] }
    }] } }), contentType: 'application/json' };
  });
  assert.equal(found.status, 'found');
  assert.equal(found.candidates[0].source, 'Crossref');
  assert.equal(found.checks[0].outcome, 'error');
  assert.match(found.checks[0].detail, /HTML instead of JSON/);
});

test('source failures do not become a false unpublished result', async () => {
  const urls = [];
  const result = await core.discover({ title, firstAuthor: 'Gu', arxivId: null }, async url => {
    urls.push(url);
    if (url.includes('dblp.')) throw Error('HTTP 429');
    return { body: '{"message":{"items":[]}}', contentType: 'application/json' };
  });
  assert.equal(result.status, 'partial_failure');
  assert.equal(result.candidates.length, 0);
  assert.ok(!urls.some(url => url.includes('uni-trier')), 'do not retry a rate limit on another host');
});

const realICML = require('./fixtures/icml-2024.json');
const carlini = { title: 'Stealing Part of a Production Language Model', firstAuthor: 'Carlini', arxivId: '2403.06634' };
function officialFixtureRequest(url) {
  if (url.includes('arxiv.org')) return { body: realICML.arxiv, contentType: 'text/html' };
  if (url.includes('dblp.')) return { body: '<html><title>Browser verification</title></html>', contentType: 'text/html' };
  if (url.includes('api.crossref')) return { body: '{"message":{"items":[]}}', contentType: 'application/json' };
  const files = new Map([
    ['https://proceedings.mlr.press/', realICML.home],
    ['https://proceedings.mlr.press/v235/', realICML.listing],
    ['https://proceedings.mlr.press/v235/carlini24a.html', realICML.paper]
  ]);
  assert.ok(files.has(url), 'Unexpected URL: ' + url);
  return { body: files.get(url), contentType: 'text/html' };
}

test('real ICML 2024 metadata is found without arXiv comments or usable aggregators', async () => {
  const cache = new Map(), urls = [];
  const request = async url => { urls.push(url); return officialFixtureRequest(url); };
  assert.equal(core.arxivComment(realICML.arxiv), '');
  // The real directory also contains "GRaM at ICML 2024" before ICML itself.
  assert.equal(core.pmlrVolume(realICML.home, '2024'), '235');
  const found = await core.discover(carlini, request, { cache, currentYear: 2026 });
  assert.equal(found.status, 'found');
  assert.equal(found.candidates[0].url, 'https://proceedings.mlr.press/v235/carlini24a.html');
  assert.equal(found.candidates[0].venue, 'Proceedings of the 41st International Conference on Machine Learning');
  assert.equal(found.candidates[0].pages, '5680-5705');
  assert.equal(found.candidates[0].date, '2024-07-08');
  assert.ok(!urls.some(u => /v251/.test(u)), 'do not search the GRaM workshop as ICML');
  urls.length = 0;
  await core.discover(carlini, request, { cache, currentYear: 2026 });
  assert.ok(!urls.includes('https://proceedings.mlr.press/v235/'), 'reuse validated directory data');
  assert.ok(urls.includes('https://proceedings.mlr.press/v235/carlini24a.html'), 'always recheck the actual publication page');
});

test('same title with a different author is never substituted', async () => {
  const result = await core.discover({ ...carlini, firstAuthor: 'Unrelated' }, async url => officialFixtureRequest(url));
  assert.equal(result.candidates.length, 0);
  assert.equal(result.status, 'partial_failure');
});

test('a failed volume does not prevent checking the following publication year', async () => {
  const result = await core.discover({ title, firstAuthor: 'Gu', arxivId: '2402.12345' }, async url => {
    if (url === 'https://proceedings.mlr.press/') return { body: realICML.home + pages.get(url), contentType: 'text/html' };
    if (url === 'https://proceedings.mlr.press/v235/') throw Error('HTTP 503');
    if (url.includes('/v267/')) return { body: pages.get(url), contentType: 'text/html' };
    return officialFixtureRequest(url);
  }, { currentYear: 2026 });
  assert.equal(result.status, 'found');
  assert.equal(result.candidates[0].year, '2025');
  assert.ok(result.checks.some(c => c.source === 'PMLR (ICML 2024)' && c.outcome === 'error'));
});

test('PMLR HTML verification is an error and is not cached as an empty directory', async () => {
  const cache = new Map();
  const bad = await core.discover(carlini, async url => url === 'https://proceedings.mlr.press/' ?
    { body: '<html>Verify your browser</html>', contentType: 'text/html' } : officialFixtureRequest(url), { cache });
  assert.equal(bad.status, 'partial_failure');
  assert.equal(cache.size, 0);
  const good = await core.discover(carlini, async url => officialFixtureRequest(url), { cache });
  assert.equal(good.status, 'found');
});

test('official DBLP graph resolves another venue when search responds with HTML', async () => {
  const result = await core.discover({ title: 'Another Paper', firstAuthor: 'Smith' }, async url => {
    if (url.includes('dblp.org/search')) return { body: '<html>Verification</html>', contentType: 'text/html' };
    assert.ok(url.startsWith('https://sparql.dblp.org/'));
    return { body: JSON.stringify({ results: { bindings: [graphRow()] } }), contentType: 'application/sparql-results+json' };
  });
  assert.equal(result.status, 'found');
  assert.equal(result.candidates[0].conferenceName, 'NeurIPS');
  assert.equal(result.checks[1].source, 'DBLP SPARQL');
});

function graphRow(overrides = {}) {
  return Object.fromEntries(Object.entries({
    paper: 'https://dblp.org/rec/conf/nips/example', title: 'Another Paper.',
    kind: 'https://dblp.org/rdf/schema#Inproceedings', author: 'Alex Smith',
    venue: 'NeurIPS', year: '2024', url: 'https://papers.nips.cc/paper/example', ...overrides
  }).map(([key, value]) => [key, { value }]));
}

test('DBLP graph rejects informal records, wrong authors, arXiv URLs and duplicate rows', () => {
  const rows = [
    graphRow({ kind: 'https://dblp.org/rdf/schema#Informal' }),
    graphRow({ author: 'Other Author' }), graphRow({ url: 'https://arxiv.org/abs/2401.01234' }),
    graphRow({ title: 'Another Paper: A Different Result' }), graphRow(), graphRow()
  ];
  const result = core.fromDBLPGraph({ results: { bindings: rows } }, 'Another Paper', 'Smith');
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'DBLP SPARQL');
  const url = new URL(core.dblpGraphURL('A "quoted" title\nwith a newline', '2401.01234'));
  const query = url.searchParams.get('query');
  assert.ok(query.includes(JSON.stringify('A "quoted" title\nwith a newline')));
  assert.ok(query.includes('FILTER (?ordinal = 1)'));
});

test('real DBLP graph metadata identifies LoRA as ICLR 2022', () => {
  const records = core.fromDBLPGraph(require('./fixtures/dblp-lora.json'),
    'LoRA: Low-Rank Adaptation of Large Language Models', 'Hu');
  assert.equal(records.length, 1);
  assert.equal(records[0].url, 'https://openreview.net/forum?id=nZeVKeeFYf9');
  assert.equal(records[0].year, '2022');
  assert.equal(records[0].conferenceName, 'ICLR');
  assert.match(records[0].venue, /Tenth International Conference on Learning Representations/);
  assert.equal(records[0].authors[0], 'Edward J. Hu');
});

for (const paper of [
  { fixture: 'dblp-attention.json', title: 'Attention Is All You Need', firstAuthor: 'Vaswani', venue: 'NIPS', year: '2017', pages: '5998-6008' },
  { fixture: 'dblp-bert.json', title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', firstAuthor: 'Devlin', venue: 'NAACL-HLT (1)', year: '2019', pages: '4171-4186' }
]) {
  test('real DBLP record: ' + paper.title, () => {
    const records = core.fromDBLPGraph(require('./fixtures/' + paper.fixture), paper.title, paper.firstAuthor);
    assert.equal(records.length, 1);
    assert.equal(records[0].conferenceName, paper.venue);
    assert.equal(records[0].year, paper.year);
    assert.equal(records[0].pages, paper.pages);
    if (paper.fixture === 'dblp-bert.json') assert.equal(records[0].doi, '10.18653/V1/N19-1423');
  });
}

test('editorial Position label and quoted metadata are handled without fuzzy title matching', () => {
  const paper = pmlrPage.replace('Auditing Prompt Caching in Language Model APIs', "Position: A Model's View");
  assert.equal(core.fromPMLR(paper, 'https://proceedings.mlr.press/v267/test.html', '267', "A Model's View", 'Gu').title, "Position: A Model's View");
  assert.equal(core.sameTitle('The Platonic Representation Hypothesis', 'Position: The Platonic Representation Hypothesis'), true);
  assert.equal(core.sameTitle('The Platonic Representation Hypothesis', 'Revisiting the Platonic Representation Hypothesis'), false);
  assert.equal(core.fromPMLR('<meta name="citation_title" content="Some Paper"><meta name="citation_author" content="Gu">', '', '', 'Some Paper', 'Gu'), null);
});

test('accepted IMC paper remains provisional when DBLP serves HTML and Crossref has no record', async () => {
  const target = 'Behavioral Consistency and Transparency Analysis on Large Language Model API Gateways';
  const result = await core.discover({ title: target, firstAuthor: 'Lin', arxivId: '2604.21083' }, async url => {
    if (url.includes('arxiv.org')) return { contentType: 'text/html', body: '<td class="tablecell comments mathjax">11 pages. Initially submitted to IMC 2026 Cycle 1; accepted on March 13, 2026. To appear in Proceedings of the 2026 ACM Internet Measurement Conference (IMC \'26)</td>' };
    if (url.includes('dblp.')) return { contentType: 'text/html', body: '<!doctype html><title>Checking your browser</title>' };
    return { contentType: 'application/json', body: '{"message":{"items":[]}}' };
  });
  assert.equal(result.status, 'accepted');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].conferenceName, 'ACM Internet Measurement Conference (IMC 2026)');
  assert.equal(result.candidates[0].publicationStatus, 'accepted');
  assert.equal(result.candidates[0].url, 'https://arxiv.org/abs/2604.21083');
  assert.equal(result.candidates[0].doi, undefined);
  assert.equal(result.checks[1].outcome, 'error');
});

test('a publisher record takes precedence over an arXiv acceptance note', async () => {
  const result = await core.discover({ title, firstAuthor: 'Gu', arxivId: '2502.07776' }, async url => {
    if (url.includes('arxiv.org')) return { body: '<td class="tablecell comments">To appear in Proceedings of the 2025 International Conference on Machine Learning (ICML \'25)</td>', contentType: 'text/html' };
    if (url.includes('dblp.')) return { body: '<html>bot</html>', contentType: 'text/html' };
    return { body: JSON.stringify({ message: { items: [{ type: 'proceedings-article', title: [title], DOI: '10.1000/paper', author: [{ given: 'Chenchen', family: 'Gu' }], 'container-title': ['Proceedings of ICML'], published: { 'date-parts': [[2025]] } }] } }), contentType: 'application/json' };
  });
  assert.equal(result.status, 'found');
  assert.equal(result.candidates[0].source, 'Crossref');
});

test('rejects wrong first author and CoRR, accepts matching conference', () => {
  const records = { result: { hits: { hit: [
    { info: { title, venue: 'CoRR', author: 'Gu, Chenchen', ee: 'https://arxiv.org/abs/2502.07776' } },
    { info: { title, venue: 'ICML', author: 'Other, Person', ee: 'https://proceedings.mlr.press/v267/wrong.html' } },
    { info: { title: title + '.', venue: 'ICML', author: 'Gu, Chenchen', year: '2025',
      ee: 'https://proceedings.mlr.press/v267/gu25b.html' } }
  ] } } };
  const results = core.fromDBLP(records, title, 'Gu');
  assert.equal(results.length, 1);
  assert.equal(results[0].year, '2025');
});
