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
    if (url.includes('dblp.org')) return { body: '<!doctype html><title>Making sure you are not a bot</title>', contentType: 'text/html' };
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
  const result = await core.discover({ title, firstAuthor: 'Gu', arxivId: null }, async url => {
    if (url.includes('dblp.org')) throw Error('HTTP 429');
    return { body: '{"message":{"items":[]}}', contentType: 'application/json' };
  });
  assert.equal(result.status, 'partial_failure');
  assert.equal(result.candidates.length, 0);
});

test('accepted IMC paper remains provisional when DBLP serves HTML and Crossref has no record', async () => {
  const target = 'Behavioral Consistency and Transparency Analysis on Large Language Model API Gateways';
  const result = await core.discover({ title: target, firstAuthor: 'Lin', arxivId: '2604.21083' }, async url => {
    if (url.includes('arxiv.org')) return { contentType: 'text/html', body: '<td class="tablecell comments mathjax">11 pages. Initially submitted to IMC 2026 Cycle 1; accepted on March 13, 2026. To appear in Proceedings of the 2026 ACM Internet Measurement Conference (IMC \'26)</td>' };
    if (url.includes('dblp.org')) return { contentType: 'text/html', body: '<!doctype html><title>Checking your browser</title>' };
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
    if (url.includes('dblp.org')) return { body: '<html>bot</html>', contentType: 'text/html' };
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
