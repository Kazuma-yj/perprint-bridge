/* global Zotero, Services, PreprintBridgeCore, PreprintBridgeCCF, PreprintBridgeReviewModel */
var PreprintBridge = (() => {
  const pluginID = "preprint-bridge@research.local";
  const menus = [];
  const busy = new Set();
  const discoveryCache = new Map();
  const progressWindows = new Set();
  let generation = 0;
  let reviewWindow = null, reviewSession = null;
  const zh = () => String(Zotero.locale || "").toLowerCase().startsWith("zh");
  const message = (cn, en) => zh() ? cn : en;
  const win = () => Zotero.getMainWindow();
  const title = "Preprint Bridge";
  const alert = (text) => Services.prompt.alert(win(), title, text);
  const log = (line) => Zotero.debug("[Preprint Bridge] " + line);
  function notify(text) {
    if (typeof Zotero.ProgressWindow !== "function") { log(text); return; }
    const progress = new Zotero.ProgressWindow({ closeOnClick: true });
    progress.changeHeadline(title);
    progress.addDescription(text);
    progress.show();
    progress.startCloseTimer(6000);
  }
  function showProgress() {
    if (typeof Zotero.ProgressWindow !== "function") return null;
    try {
      const progress = new Zotero.ProgressWindow({ closeOnClick: true });
      progress.changeHeadline(title);
      progress.addDescription(message("正在核对发表信息，请稍候。检索多个来源可能需要一些时间。", "Checking publication information. Searching multiple sources may take a little while."));
      progress.show();
      progressWindows.add(progress);
      return progress;
    } catch (error) { log("Progress window: " + error); return null; }
  }
  function closeProgress(progress) {
    if (!progress || !progressWindows.delete(progress)) return;
    try { progress.close(); } catch (error) { log("Progress close: " + error); }
  }
  const selected = () => Zotero.getActiveZoteroPane()?.getSelectedItems() || [];
  const editable = item => !item?.deleted && (typeof item?.isEditable !== "function" || item.isEditable());
  const arxivOf = (item) => PreprintBridgeCore.arxivID(
    [item.getField("url"), item.getField("DOI"), item.getField("extra")].join(" ")
  );
  const regular = item => !!item?.isRegularItem?.();
  const paper = item => regular(item) && ["preprint", "conferencePaper", "journalArticle"].includes(item.itemType);
  const pendingPublication = item => item.itemType === "conferencePaper" &&
    /(?:^|\n)(?:出版状态：已录用，待正式出版|Publication status: Accepted; proceedings pending)(?:\n|$)/.test(item.getField("extra"));
  const isPreprint = item => paper(item) && (item.itemType === "preprint" || pendingPublication(item));
  const published = item => paper(item) && !isPreprint(item) && !PreprintBridgeCore.arxivID(item.getField("url"));
  const ccfEligible = item => regular(item) && ["conferencePaper", "journalArticle"].includes(item.itemType);
  const withRating = candidate => {
    const ccf = PreprintBridgeCCF.lookup(candidate);
    let conferenceName = candidate.conferenceName;
    const year = /\b(?:19|20)\d{2}\b/.exec(String(candidate.year || ""))?.[0];
    if (candidate.itemType === "conferencePaper" && ccf?.acronym && year) {
      const fullName = String(!conferenceName || /^[A-Z0-9+./&-]{2,20}(?:\s+\(\d+\))?$/i.test(conferenceName) ? ccf.title : conferenceName)
        .replace(/\s*[（(]\s*[A-Z][A-Z0-9+./&-]{1,19}(?:\s*(?:19|20)?\d{2})?\s*[）)]\s*$/i, "");
      const abbreviation = ccf.acronym === "SIGKDD" ? "KDD" : ccf.acronym;
      conferenceName = `${fullName} (${abbreviation} ${year})`;
    }
    return { ...candidate, conferenceName, ccf };
  };
  const ccfText = (entry) => entry ? `CCF ${entry.grade}（2026 · ${entry.area}）` :
    message("CCF：未找到可靠匹配", "CCF: no reliable match");
  const ratingLabel = entry => `CCF (2026): ${entry.grade}` + (entry.acronym ?
    ` (${entry.acronym === "SIGKDD" ? "KDD" : entry.acronym})` : "");

  function conciseExtra(value, arxivId, candidate) {
    // Remove only fields written by this plugin in earlier releases. Preserve
    // all other lines, including the user's own notes.
    const pluginLine = /^(?:Original preprint URL:|Original preprint access date:|Original catalog:|CCF Rating \(2026\):|CCF \(2026\):|Publication status: Accepted; proceedings pending|出版状态：已录用，待正式出版)/i;
    const idLine = /^arXiv:\s*\d{4}\.\d{4,5}(?:v\d+)?(?:\s*\[[^\]]+\])?\s*$/i;
    const lines = String(value || "").split(/\r?\n/).filter(line =>
      !pluginLine.test(line) && !(arxivId && idLine.test(line))
    );
    const retained = lines.join("\n").trim();
    const added = [
      arxivId && `arXiv: ${arxivId}`,
      candidate.ccf && ratingLabel(candidate.ccf),
      candidate.publicationStatus === "accepted" && message("出版状态：已录用，待正式出版", "Publication status: Accepted; proceedings pending")
    ].filter(Boolean).join("\n");
    return [retained, added].filter(Boolean).join("\n");
  }

  async function request(url, { maxBytes = 1_000_000 } = {}) {
    const response = await Zotero.HTTP.request("GET", url, {
      timeout: 30_000, errorDelayMax: 0,
      headers: { Accept: url.startsWith("https://sparql.dblp.org/") ? "application/sparql-results+json" :
        /\/api\?|api\.crossref/.test(url) ? "application/json" : "text/html" }
    });
    const body = response.responseText || "";
    if (body.length > maxBytes) throw Error("Response exceeded the size limit for " + new URL(url).hostname);
    return { body, contentType: response.getResponseHeader("Content-Type") || "" };
  }

  function candidateFromItem(item) {
    const isJournal = item.itemType === "journalArticle";
    return {
      source: "Zotero", itemType: item.itemType, title: item.getDisplayTitle(),
      venue: item.getField(isJournal ? "publicationTitle" : "proceedingsTitle"),
      conferenceName: isJournal ? "" : item.getField("conferenceName"),
      year: item.getField("date"), date: item.getField("date"), pages: item.getField("pages"),
      volume: item.getField("volume"), publisher: isJournal ? "" : item.getField("publisher"),
      series: isJournal ? "" : item.getField("series"),
      catalog: item.getField("libraryCatalog"),
      url: item.getField("url"), doi: item.getField("DOI")
    };
  }

  function describe(result) {
    return result.checks.map(c => c.source + ": " + (
      c.outcome === "error" ? c.detail : c.outcome === "accepted" ?
      message("已录用，待正式出版", "accepted; proceedings pending") : c.outcome === "found" ?
      message("已找到", "found") : c.outcome === "checked" ?
      message("已读取", "checked") : message("无匹配结果", "no match")
    )).join("\n");
  }

  function writeFields(item, candidate, arxivId, { allowTitleChange = false } = {}) {
    if (!editable(item)) throw Error(message("此条目不可编辑，请检查馆藏权限或条目是否已删除。", "This item is not editable. Check library permissions or whether it was deleted."));
    const oldURL = item.getField("url");
    const oldDOI = item.getField("DOI");
    const sameDOI = !!PreprintBridgeCore.normalizeDOI(oldDOI) &&
      PreprintBridgeCore.normalizeDOI(oldDOI).toLowerCase() === PreprintBridgeCore.normalizeDOI(candidate.doi).toLowerCase();
    if (item.itemType === "conferencePaper" && candidate.itemType === "conferencePaper" &&
      !candidate.conferenceName && (sameDOI || (!!oldURL && oldURL === candidate.url))) {
      candidate = { ...candidate, conferenceName: item.getField("conferenceName") };
    }
    candidate = withRating(candidate);
    if (!allowTitleChange && !PreprintBridgeCore.sameTitle(item.getDisplayTitle(), candidate.title)) {
      throw Error(message("标题与预印本不一致，已停止写入。", "Title mismatch; no changes were made."));
    }
    if (!candidate.venue || !candidate.year || !["conferencePaper", "journalArticle"].includes(candidate.itemType)) {
      throw Error(message("正式版本信息缺少刊名、年份或类型。", "Publication metadata is incomplete."));
    }
    const changedURL = !!oldURL && oldURL !== candidate.url;
    const oldDate = item.getField("date");
    const keepDetailedDate = item.itemType === candidate.itemType && (oldURL === candidate.url || sameDOI) &&
      !candidate.date && /\b(?:19|20)\d{2}\b/.exec(oldDate)?.[0] === String(candidate.year);
      if (item.itemType !== candidate.itemType) item.setType(Zotero.ItemTypes.getID(candidate.itemType));
      item.setField("title", candidate.title);
      if (!keepDetailedDate) item.setField("date", candidate.date || candidate.year);
      if (candidate.url) item.setField("url", candidate.url);
      if (candidate.catalog) item.setField("libraryCatalog", candidate.catalog);
      if (candidate.url && changedURL) item.setField("accessDate", "");
      // Never leave the arXiv DataCite DOI on an official publication item.
      if (candidate.doi && !/arxiv\./i.test(candidate.doi)) item.setField("DOI", candidate.doi);
      else if (/arxiv\./i.test(oldDOI)) item.setField("DOI", "");
      if (candidate.pages) item.setField("pages", candidate.pages);
      if (candidate.volume) item.setField("volume", candidate.volume);
      if (candidate.itemType === "conferencePaper") {
        item.setField("proceedingsTitle", candidate.venue);
        if (candidate.series) item.setField("series", candidate.series);
        if (candidate.conferenceName) item.setField("conferenceName", candidate.conferenceName);
        if (candidate.publisher) item.setField("publisher", candidate.publisher);
      } else {
        item.setField("publicationTitle", candidate.venue);
      }
      item.setField("extra", conciseExtra(item.getField("extra"), arxivId, candidate));
  }

  async function apply(item, candidate, arxivId, options = {}) {
    const original = item.toJSON();
    try {
      writeFields(item, candidate, arxivId, options);
      await item.saveTx();
    } catch (error) {
      // saveTx is transactional; restore unsaved fields in memory as well.
      try { item.fromJSON(original, { strict: true }); } catch (restoreError) { log("Restore failed: " + restoreError); }
      throw error;
    }
  }

  const snapshot = item => JSON.parse(JSON.stringify(item.toJSON()));
  function fingerprint(value) {
    const sort = input => Array.isArray(input) ? input.map(sort) : input && typeof input === "object" ?
      Object.fromEntries(Object.keys(input).sort().map(key => [key, sort(input[key])])) : input;
    // Sync may advance these values without changing any editable data.
    const { version, dateModified, ...data } = value;
    return JSON.stringify(sort(data));
  }
  function preview(item, candidate, arxivId, options) {
    // Zotero's unsaved clone uses the real item-type field conversion rules.
    // Apply the same mutation as the eventual write; never save this clone.
    const clone = item.clone();
    const before = clone.toJSON();
    writeFields(clone, candidate, arxivId, options);
    const after = clone.toJSON();
    const ignored = new Set(["key", "version", "dateAdded", "dateModified"]);
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter(field => !ignored.has(field) && JSON.stringify(before[field] || "") !== JSON.stringify(after[field] || ""))
      .map(field => ({ field, before: before[field] || "", after: after[field] || "" }));
  }
  function createReview(items = selected()) {
    const started = generation;
    const itemMap = new Map(items.map(item => [item.id, item]));
    const paced = PreprintBridgeReviewModel.pacedRequest(request, { wait: ms => Zotero.Promise.delay(ms) });
    const ensure = (item, baseline) => {
      if (started !== generation) throw Error(message("插件已停用，请重新核对。", "Plugin disabled. Review again."));
      if (!item || !editable(item)) throw Error(message("条目已删除或不可编辑。", "The item was deleted or is read-only."));
      if (busy.has(item.id)) throw Error(message("条目正在处理，请稍后重试。", "The item is busy. Retry later."));
      if (baseline && fingerprint(snapshot(item)) !== fingerprint(baseline)) {
        const error = Error(message("条目在核对后已被修改。你可以查看当前差异，再决定是否覆盖。", "The item changed after review. Review its current differences to choose whether to overwrite."));
        error.code = "ITEM_CHANGED";
        throw error;
      }
    };
    const session = PreprintBridgeReviewModel.create({
      async check(id, guard) {
        const item = itemMap.get(id);
        ensure(item);
        const firstAuthor = item.getCreators()[0]?.lastName || "";
        const problem = !paper(item) ? message("请选择文献主条目。", "Select a paper parent item.") :
          !item.getDisplayTitle().trim() ? message("请先补全题名。", "Add the title first.") :
          !firstAuthor.trim() ? message("请先补全第一作者。", "Add the first author first.") : "";
        if (problem) { const error = Error(problem); error.skipped = true; throw error; }
        const baseline = snapshot(item), arxivId = arxivOf(item);
        busy.add(id);
        try {
          const result = await PreprintBridgeCore.resolvePublication({
            title: item.getDisplayTitle(), firstAuthor, arxivId, doi: item.getField("DOI"),
            url: item.getField("url"), published: published(item)
          }, (url, options) => paced(url, options, () => {
            guard();
            if (started !== generation) throw Error("Plugin disabled");
          }), { cache: discoveryCache });
          guard();
          if (fingerprint(snapshot(item)) !== fingerprint(baseline)) throw Error(message("检索期间条目已被修改，请重新核对。", "The item changed during lookup. Review again."));
          result.candidates = result.candidates.map(withRating);
          result.previews = result.candidates.map(candidate => preview(item, candidate, arxivId));
          log(JSON.stringify(result.checks));
          return { ...result, title: item.getDisplayTitle(), baseline, arxivId };
        } finally { if (started === generation) busy.delete(id); }
      },
      rebase(id, result) {
        const item = itemMap.get(id);
        ensure(item);
        return { ...result, baseline: snapshot(item), manualOverride: true,
          previews: result.candidates.map(candidate => preview(item, candidate, result.arxivId, { allowTitleChange: true })) };
      },
      async apply(id, result, index) {
        const item = itemMap.get(id);
        ensure(item, result.baseline);
        const before = snapshot(item);
        busy.add(id);
        try {
          await apply(item, result.candidates[index], result.arxivId, { allowTitleChange: !!result.manualOverride });
          return { before, after: snapshot(item) };
        } finally { if (started === generation) busy.delete(id); }
      },
      async undo(id, saved, { overwrite = false } = {}) {
        const item = itemMap.get(id);
        ensure(item, overwrite ? null : saved.after);
        const current = snapshot(item);
        if (overwrite) {
          const ignored = new Set(["key", "version", "dateAdded", "dateModified"]);
          const changes = [...new Set([...Object.keys(current), ...Object.keys(saved.before)])]
            .filter(field => !ignored.has(field) && JSON.stringify(current[field] || "") !== JSON.stringify(saved.before[field] || ""))
            .map(field => {
              let label = field;
              try { label = Zotero.ItemFields.getLocalizedString(field); } catch (_) {}
              const value = data => typeof data === "object" ? JSON.stringify(data) : String(data || "—");
              return `${label}:\n${value(current[field])}\n→ ${value(saved.before[field])}`;
            }).join("\n\n");
          if (!Services.prompt.confirm(win(), title, message(
            "撤销会覆盖后续的手动修改。以下是当前内容 → 恢复后的内容，是否继续？\n\n",
            "Undo will overwrite later manual edits. Review current → restored values below. Continue?\n\n"
          ) + changes)) return false;
          ensure(item, current);
        }
        busy.add(id);
        try {
          item.fromJSON(saved.before, { strict: true });
          await item.saveTx();
        } catch (error) {
          item.fromJSON(current, { strict: true });
          throw error;
        } finally { if (started === generation) busy.delete(id); }
      }
    });
    session.add(items.map(item => ({ id: item.id, title: item.getDisplayTitle() })));
    session.addItems = added => {
      for (const item of added) itemMap.set(item.id, item);
      session.add(added.map(item => ({ id: item.id, title: item.getDisplayTitle() })));
    };
    return session;
  }
  function openReview(items = selected()) {
    if (reviewWindow && !reviewWindow.closed && reviewSession) {
      reviewSession.addItems(items);
      reviewWindow.focus();
      void reviewSession.scan();
      return;
    }
    const session = createReview(items);
    reviewSession = session;
    try {
      reviewWindow = win().openDialog("chrome://preprint-bridge/content/review.xhtml", "_blank",
        "chrome,centerscreen,resizable,dialog=no,width=1060,height=720", {
          session, locale: Zotero.locale,
          fieldLabel(field) { return Zotero.ItemFields.getLocalizedString(field); },
          typeLabel(type) { return Zotero.ItemTypes.getLocalizedString(type); },
          onClose() { session.close(); if (reviewSession === session) { reviewSession = null; reviewWindow = null; } }
        });
    } catch (error) {
      session.close(); reviewSession = null;
      alert(message("无法打开核对窗口：", "Could not open the review window: ") + error.message);
    }
  }

  function confirm(candidate, detail) {
    const body = [
      message("检索源：", "Source: ") + candidate.source,
      candidate.publicationStatus === "accepted" && message(
        "仅由 arXiv 上的作者说明证实已录用；尚未找到正式出版记录。更新后保留 arXiv 链接，不填正式 DOI，可日后再次查找。",
        "Acceptance is supported by the arXiv author note only. No publisher record was found. The arXiv URL remains; no publisher DOI is added. You can check again later."
      ),
      message("题名：", "Title: ") + candidate.title,
      message("刊物/会议：", "Venue: ") + candidate.venue,
      candidate.conferenceName && message("会议名称：", "Conference: ") + candidate.conferenceName,
      candidate.series && message("系列：", "Series: ") + candidate.series,
      message("发表日期：", "Published: ") + (candidate.date || candidate.year),
      candidate.volume && message("卷次：", "Volume: ") + candidate.volume,
      candidate.pages && message("页码：", "Pages: ") + candidate.pages,
      candidate.publisher && message("出版方：", "Publisher: ") + candidate.publisher,
      ccfText(candidate.ccf),
      message("链接：", "Link: ") + candidate.url,
      candidate.pdfURL && message("正式 PDF：", "Published PDF: ") + candidate.pdfURL,
      "",
      message("更新原 Zotero 条目的出版信息，保留条目 ID、附件、批注、笔记与馆藏。", "Update the original item's publication fields while retaining its ID, attachments, notes, annotations, and collections."),
      detail || ""
    ].filter(Boolean).join("\n");
    return Services.prompt.confirm(win(), title, body);
  }

  async function checkItem(item) {
    if (!paper(item)) return alert(message("请选择一个预印本、会议论文或期刊文章主条目。", "Select one preprint, conference paper or journal article parent item."));
    const id = arxivOf(item);
    if (!editable(item)) return alert(message("此馆藏中的条目不可编辑。", "This library item is read-only."));
    if (!item.getDisplayTitle().trim()) return alert(message("条目缺少题名，请先补全。", "Add a title before checking this item."));
    const firstAuthor = item.getCreators()[0]?.lastName || "";
    if (!firstAuthor.trim()) return alert(message("条目缺少第一作者。请先补全作者，或使用手动复制正式版本信息。", "The first author is missing. Add the author or copy metadata from a published Zotero item."));
    if (busy.has(item.id)) return alert(message("此条目正在检索，请稍候。", "This item is already being checked."));
    const started = generation;
    busy.add(item.id);
    const progress = showProgress();
    try {
      const result = await PreprintBridgeCore.resolvePublication({
        title: item.getDisplayTitle(), firstAuthor, arxivId: id,
        doi: item.getField("DOI"), url: item.getField("url"), published: published(item)
      }, async (url, options) => {
        if (started !== generation) throw Error("Search cancelled: plugin disabled");
        const reply = await request(url, options);
        if (started !== generation) throw Error("Search cancelled: plugin disabled");
        return reply;
      }, { cache: discoveryCache });
      closeProgress(progress);
      if (started !== generation) return;
      result.candidates = result.candidates.map(withRating);
      log(JSON.stringify(result.checks));
      if (!result.candidates.length) {
        const prefix = result.status === "partial_failure" ?
          message("检索未完成，不能判定论文尚未发表。", "Search incomplete; publication status is unknown.") :
          message("所有可用来源均未找到可靠匹配。", "No reliable match in the checked sources.");
        return alert(prefix + "\n\n" + describe(result));
      }
      let chosen = 0;
      if (result.candidates.length > 1) {
        const labels = result.candidates.map(c => `${c.source} · ${c.venue} (${c.year})`);
        const selection = { value: 0 };
        if (!Services.prompt.select(win(), title,
          message("请选择要核对的正式版本：", "Select a published record to review:"),
          labels.length, labels, selection)) return;
        chosen = selection.value;
      }
      const candidate = result.candidates[chosen];
      // A failed secondary source is useful in the debug log. Once an
      // official record is found, keep the review focused on that record.
      if (!confirm(candidate, candidate.publicationStatus === "accepted" ? describe(result) : "")) return;
      if (started !== generation) return;
      await apply(item, candidate, id);
      if (started !== generation) return;
      notify(candidate.publicationStatus === "accepted" ?
        message("已记录会议录用信息；正式出版信息尚待核对。", "Acceptance recorded; publisher metadata is still pending.") :
        message("出版信息已更新。作者列表和 PDF 保持原样。", "Publication information updated. The author list and PDFs are unchanged."));
    } catch (error) {
      if (started !== generation) return;
      log("Update failed: " + (error?.stack || error));
      alert(message("更新失败：", "Update failed: ") + String(error?.message || error));
    } finally { closeProgress(progress); if (started === generation) busy.delete(item.id); }
  }

  async function copySelected(items = selected()) {
    const preprint = items.find(isPreprint);
    const source = items.find(item => item !== preprint && published(item));
    if (!preprint || !source || items.length !== 2) return;
    if (busy.has(preprint.id)) return alert(message("此条目正在检索，请稍候。", "This item is already being checked."));
    if (!editable(preprint)) return alert(message("此馆藏中的条目不可编辑。", "This library item is read-only."));
    const started = generation;
    const candidate = withRating(candidateFromItem(source));
    if (!PreprintBridgeCore.sameTitle(preprint.getDisplayTitle(), candidate.title) &&
      !Services.prompt.confirm(win(), title,
        message("两个标题不同。请先核对作者和正文，确认这是同一篇论文后继续：\n", "Titles differ. Confirm the authors and paper before continuing:\n") +
        preprint.getDisplayTitle() + "\n→ " + candidate.title)) return;
    if (!confirm(candidate, message("正式版本条目会保留，确认信息后可自行删除重复条目。", "The source item will remain; delete the duplicate after review if desired."))) return;
    if (started !== generation) return;
    try {
      busy.add(preprint.id);
      await apply(preprint, candidate, arxivOf(preprint), { allowTitleChange: true });
      if (started === generation) notify(message("信息已复制到原预印本条目，来源条目没有删除。", "Metadata copied to the original item; the source was not deleted."));
    } catch (error) {
      log("Copy failed: " + (error?.stack || error));
      if (started === generation) alert(message("复制失败：", "Copy failed: ") + String(error?.message || error));
    } finally { if (started === generation) busy.delete(preprint.id); }
  }

  async function updateCCF(items = selected()) {
    // CCF-only updates must not touch bibliographic fields or acceptance state.
    const stats = { updated: 0, unchanged: 0, unmatched: 0, skipped: 0, failed: 0 };
    const started = generation;
    const changes = [], seen = new Set();
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (!ccfEligible(item) || !editable(item) || busy.has(item.id)) { stats.skipped++; continue; }
      const rating = PreprintBridgeCCF.lookup(candidateFromItem(item));
      if (!rating) { stats.unmatched++; continue; }
      const before = item.getField("extra");
      const label = ratingLabel(rating);
      const retained = String(before || "").split(/\r?\n/)
        .filter(line => !/^(?:CCF Rating \(2026\):|CCF \(2026\):)/i.test(line)).join("\n").trim();
      const after = [retained, label].filter(Boolean).join("\n");
      if (after === before) { stats.unchanged++; continue; }
      changes.push({ item, before, after, label });
    }
    const summary = () => message(
      `已更新 ${stats.updated} 项；无需修改 ${stats.unchanged} 项；无可靠匹配 ${stats.unmatched} 项；跳过 ${stats.skipped} 项；失败 ${stats.failed} 项。`,
      `Updated: ${stats.updated}; unchanged: ${stats.unchanged}; no reliable match: ${stats.unmatched}; skipped: ${stats.skipped}; failed: ${stats.failed}.`
    );
    if (!changes.length) { notify(summary()); return stats; }
    const preview = changes.slice(0, 12).map(change => `${change.item.getDisplayTitle()}\n${change.label}`).join("\n\n");
    if (!Services.prompt.confirm(win(), title, message(
      `将更新 ${changes.length} 个条目在“其他”字段中的 CCF 2026 评级。无可靠匹配的条目保留原值。\n\n`,
      `Update the CCF 2026 label in Extra for ${changes.length} items. Unmatched items keep their existing values.\n\n`
    ) + preview + (changes.length > 12 ? message(`\n\n另有 ${changes.length - 12} 项。`, `\n\nAnd ${changes.length - 12} more.`) : ""))) return { ...stats, cancelled: true };
    for (const change of changes) {
      if (started !== generation) return { ...stats, cancelled: true };
      const { item, before, after } = change;
      if (!editable(item) || busy.has(item.id) || item.getField("extra") !== before) { stats.skipped++; continue; }
      busy.add(item.id);
      try {
        item.setField("extra", after);
        await item.saveTx();
        stats.updated++;
      } catch (error) {
        item.setField("extra", before);
        stats.failed++;
        log("CCF update failed: " + (error?.stack || error));
      } finally { if (started === generation) busy.delete(item.id); }
    }
    if (started === generation) (stats.failed ? alert : notify)(summary());
    return stats;
  }

  function openArxiv(items = selected()) {
    const id = items.length === 1 && regular(items[0]) && arxivOf(items[0]);
    if (!id) return alert(message("请选择一个带 arXiv 标识的主条目。", "Select one parent item containing an arXiv identifier."));
    Zotero.launchURL("https://arxiv.org/abs/" + id);
  }

  function showHelp() {
    alert(message(
      "核对并更新出版信息：选中一篇或多篇论文，集中查看差异，再勾选更新。支持停止、重试和窗口内撤销。\n\n更新 CCF 评级：选中一个或多个会议／期刊条目，按已有刊名或会议名本地匹配。\n\n高级 → 从已导入条目手动补全：仅在自动检索无匹配或正式版改名时使用，同时选中预印本与已导入的正式版。\n\n打开 arXiv 原文：选中一个含 arXiv 标识的条目，更新后也可回到预印本页面。\n\n请选中文献主条目。灰色命令表示当前选择不满足条件，或条目不可编辑／正在处理。",
      "Review and update publication: select one or more papers, compare changes, then choose which to update. Stop, retry and undo within the review window.\n\nUpdate CCF rating: select one or more conference/journal items to match their existing venue names locally.\n\nAdvanced → Complete from an imported record: a fallback for unmatched or renamed papers. Select the preprint and an imported publication together.\n\nOpen arXiv preprint: select one item containing an arXiv identifier, even after its publication fields have been updated.\n\nSelect bibliographic parent items. A disabled command means the selection is unsuitable, read-only or already being processed."
    ));
  }

  function menuState(command, items = []) {
    const one = items.length === 1 ? items[0] : null;
    if (command === "review") return items.some(item => paper(item) && editable(item) && !busy.has(item.id));
    if (command === "ccf") return items.some(item => ccfEligible(item) && editable(item) && !busy.has(item.id));
    if (command === "copy") {
      const preprint = items.find(isPreprint);
      return items.length === 2 && !!preprint && editable(preprint) && !busy.has(preprint.id) &&
        items.some(item => item !== preprint && published(item));
    }
    if (command === "arxiv") return !!one && regular(one) && !!arxivOf(one);
    return true;
  }

  function start() {
    stop();
    function register(options) {
      let registeredID = Zotero.MenuManager.registerMenu(options);
      if (registeredID === false) {
        // An earlier hot-reloaded instance may have left one of our own menus.
        const staleID = `${pluginID}-${options.menuID}`;
        if (Zotero.MenuManager.unregisterMenu(staleID)) {
          registeredID = Zotero.MenuManager.registerMenu(options);
        }
      }
      if (typeof registeredID !== "string" || !registeredID) {
        throw Error("Unable to register Preprint Bridge menu " + options.menuID);
      }
      menus.push(registeredID);
    }
    function action(command, callback) {
      return { menuType: "menuitem", l10nID: "preprint-bridge-" + command,
        onShowing: (_event, context) => {
          context.setVisible(true);
          context.setEnabled(menuState(command, context.items || []));
        },
        onCommand: (_event, context) => {
          const items = context?.items || selected();
          if (menuState(command, items)) void callback(items);
        }
      };
    }
    register({
      menuID: "preprint-bridge-main", pluginID, target: "main/library/item",
      menus: [{ menuType: "submenu", l10nID: "preprint-bridge-menu",
        onShowing: (_event, context) => context.setVisible(!!context.items?.some(regular)),
        menus: [
          action("review", items => openReview(items)),
          action("ccf", items => updateCCF(items)),
          action("arxiv", items => openArxiv(items)),
          { menuType: "submenu", l10nID: "preprint-bridge-advanced", menus: [action("copy", items => copySelected(items))] },
          { menuType: "separator" },
          action("help", () => showHelp())
        ]
      }]
    });
  }
  function stop() {
    ++generation;
    reviewSession?.close();
    reviewSession = null;
    if (reviewWindow && !reviewWindow.closed) reviewWindow.close();
    reviewWindow = null;
    busy.clear();
    discoveryCache.clear();
    for (const progress of [...progressWindows]) closeProgress(progress);
    for (const id of menus.splice(0)) Zotero.MenuManager.unregisterMenu(id);
  }
  return { start, stop, checkItem, apply, updateCCF, openArxiv, menuState, preview, createReview, openReview };
})();
