const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const scope = vm.createContext({});
for (const file of ['ccf-data.js', 'ccf.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'content', file), 'utf8'), scope);
}
const ccf = vm.runInContext('PreprintBridgeCCF', scope);

test('CCF 2026: ICML conference is A even when PMLR is the publisher', () => {
  const result = ccf.lookup({
    itemType: 'conferencePaper',
    venue: 'Proceedings of the 42nd International Conference on Machine Learning',
    conferenceName: '42nd International Conference on Machine Learning'
  });
  assert.equal(result.grade, 'A');
  assert.equal(result.acronym, 'ICML');
  assert.equal(result.area, '人工智能');
  assert.equal(result.page, 57);
  assert.equal(ccf.lookup({ itemType: 'journalArticle', venue: 'PMLR' }), null);
});

test('CCF lookup abstains for ambiguous abbreviations and unlisted venues', () => {
  assert.equal(ccf.lookup({ itemType: 'conferencePaper', venue: 'FSE' }), null);
  assert.equal(ccf.lookup({ itemType: 'conferencePaper', venue: 'Unlisted Conference' }), null);
  assert.equal(ccf.lookup({ itemType: 'conferencePaper', venue: 'ICASSP' }).grade, 'B');
  assert.equal(ccf.lookup({ itemType: 'conferencePaper', venue: 'KDD' }).acronym, 'SIGKDD');
  assert.equal(ccf.lookup({ itemType: 'conferencePaper', venue: 'NIPS' }).acronym, 'NeurIPS');
  assert.equal(ccf.lookup({ itemType: 'conferencePaper', venue: 'ICLR' }).grade, 'A');
  assert.equal(ccf.lookup({ itemType: 'conferencePaper', venue: 'NAACL-HLT (1)' }).grade, 'B');
  assert.equal(ccf.lookup({ itemType: 'conferencePaper', venue: 'NAACL-HLT Workshops' }), null);
  assert.equal(ccf.lookup({ itemType: 'conferencePaper', conferenceName: 'ACM Internet Measurement Conference (IMC 2026)' }).grade, 'B');
  assert.equal(ccf.lookup({ itemType: 'conferencePaper', conferenceName: '42nd International Conference on Machine Learning (ICML 2025)' }).grade, 'A');
  assert.equal(ccf.lookup({ itemType: 'conferencePaper', conferenceName: 'ACM SIGKDD Conference on Knowledge Discovery and Data Mining (KDD 2026)' }).acronym, 'SIGKDD');
});

test('CCF cell extraction keeps neighboring table rows out of conference names', () => {
  const expected = {
    ACNS: 'International Conference on Applied Cryptography and Network Security',
    SACMAT: 'ACM Symposium on Access Control Models and Technologies',
    ASPLOS: 'International Conference on Architectural Support for Programming Languages and Operating Systems',
    CHI: 'ACM Conference on Human Factors in Computing Systems'
  };
  for (const [venue, name] of Object.entries(expected)) {
    assert.equal(ccf.lookup({ itemType: 'conferencePaper', venue }).title, name);
  }
  assert.ok(ccf.lookup({ itemType: 'conferencePaper', venue: 'HotStorage' }));
});
