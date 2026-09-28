/* Exercises the actual packaged XHTML/JS/CSS in Chromium, with a fixture
 * controller. Zotero's chrome privileges and desktop menus are not emulated. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '../content');
  const server = http.createServer((request, response) => {
    const name = request.url.split('?')[0].slice(1);
    if (!['review.xhtml', 'review.css', 'review-ui.js'].includes(name)) { response.writeHead(404).end(); return; }
    const types = { xhtml: 'application/xhtml+xml', css: 'text/css', js: 'text/javascript' };
    response.setHeader('Content-Type', types[name.split('.').at(-1)] + '; charset=utf-8');
    response.end(fs.readFileSync(path.join(root, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const errors = [], checks = [];
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1060, height: 780 } });
    page.on('pageerror', error => errors.push(error.message));
    const fixture = () => {
      const zh = !new URL(location.href).searchParams.has('en');
      const names = ['Stealing Part of a Production Language Model', 'Behavioral Consistency and Transparency Analysis on Large Language Model API Gateways', '<img src=x onerror="window.compromised=true"> Example Paper'];
      const state = { writes: [], undo: [], changed: false, undoChanged: false, calls: [], closed: false };
      const session = PreprintBridgeReviewModel.create({
        async check(id, guard) {
          state.calls.push(id);
          await new Promise(resolve => setTimeout(resolve, 250)); guard();
          const accepted = id === 2;
          return { title: names[id - 1], status: accepted ? 'accepted' : 'found',
            candidates: [{ source: accepted ? 'arXiv' : 'PMLR', title: names[id - 1],
              publicationStatus: accepted ? 'accepted' : '', year: accepted ? '2026' : '2024',
              venue: accepted ? 'ACM Internet Measurement Conference' : 'Proceedings of the 41st International Conference on Machine Learning',
              url: 'https://proceedings.mlr.press/v235/carlini24a.html', ccf: { grade: accepted ? 'B' : 'A', acronym: accepted ? 'IMC' : 'ICML' } }],
            previews: [[{ field: 'itemType', before: 'preprint', after: 'conferencePaper' },
              { field: 'conferenceName', before: '', after: accepted ? 'ACM Internet Measurement Conference (IMC 2026)' : '41st International Conference on Machine Learning (ICML 2024)' },
              { field: 'pages', before: '', after: '5680–5705' },
              { field: 'extra', before: 'Reader note', after: 'Reader note\narXiv: 2403.06634\nCCF (2026): A (ICML)' }]],
            checks: [{ source: 'arXiv', outcome: 'checked' }, { source: 'PMLR', outcome: 'found' }] };
        },
        async apply(id, _result, _index, fields) {
          if (state.changed) throw Object.assign(Error('Item changed after review'), { code: 'ITEM_CHANGED' });
          state.fields = fields; state.writes.push(id); return { id };
        },
        rebase(_id, result) {
          state.changed = false;
          const copy = JSON.parse(JSON.stringify(result)); copy.manualOverride = true;
          copy.previews[0].push({ field: 'title', before: 'User edited title', after: result.title }); return copy;
        },
        async undo(id, _saved, { overwrite }) {
          if (state.undoChanged && !overwrite) throw Object.assign(Error('Later manual edits'), { code: 'ITEM_CHANGED' });
          if (overwrite && !window.confirm('Overwrite later manual edits?')) return false;
          state.undo.push(id);
        }
      });
      session.add(names.map((title, i) => ({ id: i + 1, title })));
      window.arguments = [{ session, locale: zh ? 'zh-CN' : 'en-US', onClose() { state.closed = true; } }];
      window.fixture = { state, session };
    };
    await page.addInitScript({ content: fs.readFileSync(path.join(root, 'review-model.js'), 'utf8') + ';(' + fixture.toString() + ')();' });
    const url = `http://127.0.0.1:${server.address().port}/review.xhtml`;
    await page.goto(url);
    await page.waitForFunction(() => window.fixture?.session.view().phase === 'idle');
    assert.equal(await page.locator('.row').count(), 3);
    assert.equal(await page.locator('#apply').isDisabled(), true);
    assert.equal(await page.locator('img').count(), 0); assert.equal(await page.evaluate(() => window.compromised), undefined);
    await page.locator('#select-formal').click();
    assert.deepEqual(await page.evaluate(() => fixture.session.view().rows.map(row => row.selected)), [true, false, true]);
    assert.match(await page.locator('#detail').innerText(), /题名与第一作者一致/);
    assert.equal(await page.locator('#detail table').count(), 1);
    checks.push('actual XHTML renders safely, formal-only selection excludes acceptance notes');

    // Unselect the extra fixture and update one paper without a modal success alert.
    await page.locator('.row input').nth(2).uncheck();
    await page.locator('.row button').nth(0).click();
    let dialogs = 0;
    const dismiss = async dialog => { dialogs++; await dialog.dismiss(); };
    page.on('dialog', dismiss);
    await page.locator('#apply').click();
    await page.waitForFunction(() => fixture.state.writes.length === 1);
    assert.match(await page.locator('#detail .notice.success').innerText(), /作者列表和 PDF 保持原样/);
    assert.equal(dialogs, 0);
    await page.locator('#undo').click();
    await page.waitForFunction(() => fixture.state.undo.length === 1);
    assert.match(await page.locator('#detail').innerText(), /已恢复到本次更新前/);
    checks.push('selected update, inline success, undo, no success alert');

    await page.reload(); await page.waitForFunction(() => fixture.session.view().phase === 'idle');
    await page.getByRole('button', { name: '清空选择', exact: true }).click();
    assert.equal(await page.locator('#apply').isDisabled(), true);
    await page.locator('#detail input[data-field="conferenceName"]').check();
    assert.equal(await page.locator('.row input').nth(0).isChecked(), true);
    assert.equal(await page.locator('#detail input[data-field="pages"]').isChecked(), false);
    await page.locator('#detail input[data-field="pages"]').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.field), 'pages');
    await page.keyboard.press('Space');
    await page.locator('#apply').click(); await page.waitForFunction(() => fixture.state.writes.length === 1);
    assert.deepEqual(await page.evaluate(() => fixture.state.fields), ['conferenceName']);
    assert.equal(await page.locator('#detail tbody tr').count(), 1);
    assert.equal(await page.locator('#detail tbody tr').getAttribute('data-field'), 'conferenceName');
    checks.push('individual field checkboxes enable the paper, retain keyboard focus, and show only saved changes');

    await page.reload(); await page.waitForFunction(() => fixture.session.view().phase === 'idle');
    await page.locator('.row input').nth(0).check();
    await page.evaluate(() => { fixture.state.changed = true; });
    await page.locator('#apply').click();
    await page.getByRole('button', { name: '按当前内容重新预览…', exact: true }).click();
    assert.match(await page.locator('#detail').innerText(), /User edited title/);
    assert.equal(await page.locator('#apply').isDisabled(), true);
    await page.locator('.row input').nth(0).check(); await page.locator('#apply').click();
    await page.waitForFunction(() => fixture.state.writes.length === 1);
    await page.evaluate(() => { fixture.state.undoChanged = true; });
    await page.locator('#undo').click();
    await page.getByRole('button', { name: '查看后续修改并撤销…', exact: true }).click();
    assert.equal(await page.evaluate(() => fixture.state.undo.length), 0);
    page.off('dialog', dismiss); page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '查看后续修改并撤销…', exact: true }).click();
    await page.waitForFunction(() => fixture.state.undo.length === 1);
    checks.push('manual overwrite requires new preview and selection; undo override can be cancelled or confirmed');

    await page.reload(); await page.locator('#stop').click();
    await page.waitForFunction(() => fixture.session.view().phase === 'idle');
    assert.ok(await page.evaluate(() => fixture.state.calls.length < 3));
    await page.locator('#retry').click(); await page.waitForFunction(() => fixture.session.view().rows.every(row => row.result));
    await page.locator('.row button').nth(1).click();
    assert.match(await page.locator('#detail .caution').innerText(), /尚未找到正式出版记录/);
    checks.push('stop and resume retain results; acceptance-only provenance is explicit');

    const screenshots = process.env.UI_SCREENSHOT_DIR;
    if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
    await page.locator('.row button').nth(0).click();
    if (screenshots) await page.screenshot({ path: path.join(screenshots, 'review-zh.png') });
    await page.setViewportSize({ width: 720, height: 700 }); await page.emulateMedia({ colorScheme: 'dark' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (screenshots) await page.screenshot({ path: path.join(screenshots, 'review-dark.png') });
    await page.goto(url + '?en'); await page.waitForFunction(() => fixture.session.view().phase === 'idle');
    assert.equal(await page.locator('#heading').innerText(), 'Review publication information');
    assert.match(await page.locator('#detail').innerText(), /normalized title and first author agree/);
    checks.push('Chinese and English text, narrow viewport, dark appearance');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: checks.length, checks, pageErrors: errors, browser: await browser.version() }, null, 2));
  } catch (error) {
    console.error('UI diagnostics:', JSON.stringify({ errors, text: await page?.locator('body').innerText().catch(() => '') }));
    if (page && process.env.UI_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.UI_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, 'failure.png') }).catch(() => {});
    }
    throw error;
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
