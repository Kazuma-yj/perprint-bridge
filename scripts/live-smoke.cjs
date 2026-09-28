/* Optional network integration check. Uses Python's proxy-aware standard HTTP
 * client and the shipped JS discovery logic. No Zotero objects are modified. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const root = path.join(__dirname, '..');
const sandbox = vm.createContext({ URL, Zotero: { locale: 'zh-CN', ItemTypes: { getID: type => type } }, Services: {} });
for (const file of ['core.js', 'ccf-data.js', 'ccf.js', 'plugin.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'content', file), 'utf8'), sandbox);
}
const cases = JSON.parse(fs.readFileSync(path.join(root, 'tests/live-cases.json'), 'utf8'));
const selected = process.argv.slice(2);
const responses = new Map();
const cacheDir = process.env.SMOKE_CACHE_DIR;
if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
const parsedCache = new Map();
const requestCounts = { network: 0, diskCache: 0, memoryCache: 0 };
const python = `
import json,sys,urllib.request,urllib.error
try:
 req=urllib.request.Request(sys.argv[1],headers={'Accept':sys.argv[2]})
 with urllib.request.urlopen(req,timeout=30) as r:
  body=r.read(int(sys.argv[3])+1)
  if len(body)>int(sys.argv[3]): raise ValueError('Response exceeded size limit')
  print(json.dumps({'body':body.decode('utf-8'), 'contentType':r.headers.get('Content-Type','')}))
except Exception as e:
 print(json.dumps({'error':str(e)}))
`;
async function request(url, { maxBytes = 1_000_000 } = {}) {
  if (responses.has(url)) { requestCounts.memoryCache++; return responses.get(url); }
  const cacheFile = cacheDir && path.join(cacheDir, require('node:crypto').createHash('sha256').update(url).digest('hex') + '.json');
  if (cacheFile && fs.existsSync(cacheFile)) { requestCounts.diskCache++; return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); }
  requestCounts.network++;
  process.stderr.write(`GET ${url.startsWith('https://sparql.dblp.org/') ? 'https://sparql.dblp.org/sparql (publication query)' : url}\n`);
  const { stdout } = await execFile(process.env.PYTHON || 'python3', ['-c', python, url,
    url.startsWith('https://sparql.dblp.org/') ? 'application/sparql-results+json' :
      /\/api\?|api\.crossref/.test(url) ? 'application/json' : 'text/html', String(maxBytes)],
  { maxBuffer: 20_000_000, timeout: 40_000 });
  const result = JSON.parse(stdout);
  if (result.error) throw Error(result.error);
  responses.set(url, result);
  if (cacheFile) fs.writeFileSync(cacheFile, JSON.stringify(result));
  return result;
}
(async () => {
  const report = [];
  for (const paper of cases.filter(c => !selected.length || selected.includes(c.arxivId || c.doi))) {
    const result = await sandbox.PreprintBridgeCore.resolvePublication(paper, request, { cache: parsedCache });
    const candidates = result.candidates.map(c => ({ ...c, ccf: sandbox.PreprintBridgeCCF.lookup(c) }));
    for (const candidate of candidates) {
      const fields = { title: paper.title, url: paper.url || (paper.arxivId ? `https://arxiv.org/abs/${paper.arxivId}` : ''),
        DOI: paper.doi || '', conferenceName: paper.conferenceName || '', extra: '' };
      const item = { itemType: paper.itemType || 'preprint', getDisplayTitle: () => fields.title,
        getField: name => fields[name] || '', setField(name, value) { fields[name] = value; },
        setType(type) { this.itemType = type; }, toJSON: () => ({ ...fields }),
        fromJSON(snapshot) { Object.assign(fields, snapshot); }, async saveTx() {} };
      await sandbox.PreprintBridge.apply(item, candidate, paper.arxivId);
      candidate.appliedFields = fields;
    }
    const match = candidates.some(c => c.url === paper.expectedURL && c.year === paper.expectedYear &&
      (!paper.expectedCCF || (new RegExp(`^CCF \\(2026\\): ${paper.expectedCCF}(?: \\(|$)`, 'm').test(c.appliedFields.extra) &&
        (c.itemType !== 'conferencePaper' || c.appliedFields.conferenceName.endsWith(` ${paper.expectedYear})`)))));
    const passed = paper.expectedURL ? match : !candidates.length;
    report.push({ arxivId: paper.arxivId, doi: paper.doi, title: paper.title, passed, status: result.status,
      candidates, checks: result.checks });
    process.stderr.write(`${passed ? 'PASS' : 'FAIL'} ${paper.arxivId || paper.doi}: ${result.status}\n`);
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(),
    pluginVersion: JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version,
    requestCounts, cases: report }, null, 2));
  if (report.some(r => !r.passed)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
