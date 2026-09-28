/* global Zotero, Services, PreprintBridgeCore, PreprintBridgeCCF */
var PreprintBridge = (() => {
  const pluginID = "preprint-bridge@research.local";
  const menus = [];
  const busy = new Set();
  const zh = () => String(Zotero.locale || "").toLowerCase().startsWith("zh");
  const message = (cn, en) => zh() ? cn : en;
  const win = () => Zotero.getMainWindow();
  const title = "Preprint Bridge";
  const alert = (text) => Services.prompt.alert(win(), title, text);
  const log = (line) => Zotero.debug("[Preprint Bridge] " + line);
  const selected = () => Zotero.getActiveZoteroPane()?.getSelectedItems() || [];
  const arxivOf = (item) => PreprintBridgeCore.arxivID(
    [item.getField("url"), item.getField("DOI"), item.getField("extra")].join(" ")
  );
  const isPreprint = (item) => item?.isRegularItem() && item.itemType === "preprint" && !!arxivOf(item);
  const published = (item) => item?.isRegularItem() &&
    ["conferencePaper", "journalArticle"].includes(item.itemType) && !PreprintBridgeCore.arxivID(item.getField("url"));
  const pmlrVolumeOf = item => {
    if (!item?.isRegularItem() || item.itemType !== "conferencePaper") return null;
    try {
      const url = new URL(item.getField("url"));
      if (url.hostname !== "proceedings.mlr.press" || url.protocol !== "https:") return null;
      return /^\/v(\d+)\/[a-z\d-]+\.html$/i.exec(url.pathname)?.[1] || null;
    } catch { return null; }
  };
  const withRating = candidate => ({
    ...candidate, ccf: PreprintBridgeCCF.lookup(candidate)
  });
  const ccfText = (entry) => entry ? `CCF ${entry.grade}（2026 年目录 · ${entry.area} · ${
    entry.kind === "conference" ? "会议" : "期刊"} · 第 ${entry.page} 页）` :
    message("CCF：未找到可靠匹配", "CCF: no reliable match");

  async function request(url, { maxBytes = 1_000_000 } = {}) {
    const response = await Zotero.HTTP.request("GET", url, {
      timeout: 30_000, errorDelayMax: 0,
      headers: { Accept: /\/api\?|api\.crossref/.test(url) ? "application/json" : "text/html" }
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
      c.outcome === "error" ? c.detail : c.outcome === "found" ?
      message("已找到", "found") : c.outcome === "checked" ?
      message("已读取", "checked") : message("无匹配结果", "no match")
    )).join("\n");
  }

  async function apply(item, candidate, arxivId, { allowTitleChange = false } = {}) {
    if (!allowTitleChange && !PreprintBridgeCore.sameTitle(item.getDisplayTitle(), candidate.title)) {
      throw Error(message("标题与预印本不一致，已停止写入。", "Title mismatch; no changes were made."));
    }
    if (!candidate.venue || !candidate.year || !["conferencePaper", "journalArticle"].includes(candidate.itemType)) {
      throw Error(message("正式版本信息缺少刊名、年份或类型。", "Publication metadata is incomplete."));
    }
    const original = item.toJSON();
    const oldURL = item.getField("url");
    const oldCatalog = item.getField("libraryCatalog");
    const oldAccessDate = item.getField("accessDate");
    const changedURL = !!oldURL && oldURL !== candidate.url;
    const oldPreprintCatalog = !!candidate.catalog && !!oldCatalog && oldCatalog !== candidate.catalog &&
      /^(?:doi\.org|datacite|arxiv)/i.test(oldCatalog);
    try {
      if (item.itemType !== candidate.itemType) item.setType(Zotero.ItemTypes.getID(candidate.itemType));
      item.setField("title", candidate.title);
      item.setField("date", candidate.date || candidate.year);
      item.setField("url", candidate.url || "");
      if (candidate.catalog) item.setField("libraryCatalog", candidate.catalog);
      if (changedURL || oldPreprintCatalog) item.setField("accessDate", "");
      // Never leave the arXiv DataCite DOI on an official publication item.
      item.setField("DOI", candidate.doi && !/arxiv\./i.test(candidate.doi) ? candidate.doi : "");
      item.setField("pages", candidate.pages || "");
      item.setField("volume", candidate.volume || "");
      if (candidate.itemType === "conferencePaper") {
        item.setField("proceedingsTitle", candidate.venue);
        if (candidate.series) item.setField("series", candidate.series);
        if (candidate.conferenceName) item.setField("conferenceName", candidate.conferenceName);
        if (candidate.publisher) item.setField("publisher", candidate.publisher);
      } else {
        item.setField("publicationTitle", candidate.venue);
      }
      let extra = String(item.getField("extra") || "");
      if (arxivId && !new RegExp("arxiv[:.]\\s*" + arxivId.replace(".", "\\."), "i").test(extra)) {
        extra += (extra ? "\n" : "") + "arXiv: " + arxivId;
      }
      if (changedURL && !extra.includes(oldURL)) {
        extra += (extra ? "\n" : "") + "Original preprint URL: " + oldURL;
      }
      if ((changedURL || oldPreprintCatalog) && oldAccessDate && !extra.includes("Original preprint access date:")) {
        extra += (extra ? "\n" : "") + "Original preprint access date: " + oldAccessDate;
      }
      if (candidate.catalog && oldCatalog && oldCatalog !== candidate.catalog && !extra.includes("Original catalog:")) {
        extra += (extra ? "\n" : "") + "Original catalog: " + oldCatalog;
      }
      if (candidate.ccf) {
        extra = extra.replace(/^CCF Rating \(2026\):[^\n]*\n?/gm, "").trimEnd();
        extra += (extra ? "\n" : "") + `CCF Rating (2026): ${candidate.ccf.grade}; ${candidate.ccf.acronym}; ${candidate.ccf.area}; ${
          candidate.ccf.kind === "conference" ? "conference" : "journal"}; p. ${candidate.ccf.page}`;
      }
      item.setField("extra", extra);
      await item.saveTx();
    } catch (error) {
      // saveTx is transactional; restore unsaved fields in memory as well.
      try { item.fromJSON(original); } catch (restoreError) { log("Restore failed: " + restoreError); }
      throw error;
    }
  }

  function confirm(candidate, detail) {
    const body = [
      message("检索源：", "Source: ") + candidate.source,
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
    const id = arxivOf(item);
    if (!id) return alert(message("请选择带 arXiv 标识的预印本主条目。", "Select an arXiv preprint parent item."));
    if (busy.has(item.id)) return alert(message("此条目正在检索，请稍候。", "This item is already being checked."));
    busy.add(item.id);
    try {
      const result = await PreprintBridgeCore.discover({
        title: item.getDisplayTitle(), firstAuthor: item.getCreators()[0]?.lastName || "", arxivId: id
      }, request);
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
      if (!confirm(candidate, describe(result))) return;
      await apply(item, candidate, id);
      alert(message("已更新原条目的出版信息；请核对作者与 PDF。", "Publication fields updated. Please review creators and the PDF."));
    } catch (error) {
      log("Update failed: " + (error?.stack || error));
      alert(message("更新失败：", "Update failed: ") + String(error?.message || error));
    } finally { busy.delete(item.id); }
  }

  async function copySelected() {
    const items = selected();
    const preprint = items.find(isPreprint);
    const source = items.find(item => item !== preprint && published(item));
    if (!preprint || !source || items.length !== 2) return;
    const candidate = withRating(candidateFromItem(source));
    if (!PreprintBridgeCore.sameTitle(preprint.getDisplayTitle(), candidate.title) &&
      !Services.prompt.confirm(win(), title,
        message("两个标题不同。请先核对作者和正文，确认这是同一篇论文后继续：\n", "Titles differ. Confirm the authors and paper before continuing:\n") +
        preprint.getDisplayTitle() + "\n→ " + candidate.title)) return;
    if (!confirm(candidate, message("正式版本条目会保留，确认信息后可自行删除重复条目。", "The source item will remain; delete the duplicate after review if desired."))) return;
    try {
      await apply(preprint, candidate, arxivOf(preprint), { allowTitleChange: true });
      alert(message("信息已复制到原预印本条目，来源条目没有删除。", "Metadata copied to the original item; the source was not deleted."));
    } catch (error) {
      log("Copy failed: " + (error?.stack || error));
      alert(message("复制失败：", "Copy failed: ") + String(error?.message || error));
    }
  }

  async function refreshPMLR(item) {
    const volume = pmlrVolumeOf(item);
    if (!volume || busy.has(item.id)) return;
    busy.add(item.id);
    try {
      const url = item.getField("url");
      const reply = await request(url);
      const candidate = PreprintBridgeCore.fromPMLR(reply.body, url, volume,
        item.getDisplayTitle(), item.getCreators()[0]?.lastName || "");
      if (!candidate) throw Error(message("PMLR 页面与当前题名或作者不匹配。", "PMLR title or author does not match this item."));
      const rated = withRating(candidate);
      if (!confirm(rated, message("核对已发表条目并补全正式出版信息。", "Review and complete the published record."))) return;
      await apply(item, rated, arxivOf(item));
      alert(message("已更新出版信息与 CCF 评级；请核对 PDF 附件。", "Publication metadata and CCF rating updated. Review the PDF attachment."));
    } catch (error) {
      log("Refresh failed: " + (error?.stack || error));
      alert(message("核对失败：", "Review failed: ") + String(error?.message || error));
    } finally { busy.delete(item.id); }
  }

  function start() {
    menus.push(Zotero.MenuManager.registerMenu({
      menuID: "preprint-bridge-check", pluginID, target: "main/library/item",
      menus: [{ menuType: "menuitem", l10nID: "preprint-bridge-check",
        onShowing: (_event, context) => context.setVisible(context.items?.length === 1 && isPreprint(context.items[0])),
        onCommand: () => { const item = selected()[0]; if (item) void checkItem(item); }
      }]
    }));
    menus.push(Zotero.MenuManager.registerMenu({
      menuID: "preprint-bridge-copy", pluginID, target: "main/library/item",
      menus: [{ menuType: "menuitem", l10nID: "preprint-bridge-copy",
        onShowing: (_event, context) => context.setVisible(context.items?.length === 2 && context.items.some(isPreprint) && context.items.some(published)),
        onCommand: () => { void copySelected(); }
      }]
    }));
    menus.push(Zotero.MenuManager.registerMenu({
      menuID: "preprint-bridge-refresh", pluginID, target: "main/library/item",
      menus: [{ menuType: "menuitem", l10nID: "preprint-bridge-refresh",
        onShowing: (_event, context) => context.setVisible(context.items?.length === 1 && !!pmlrVolumeOf(context.items[0])),
        onCommand: () => { const item = selected()[0]; if (item) void refreshPMLR(item); }
      }]
    }));
  }
  function stop() { for (const id of menus.splice(0)) Zotero.MenuManager.unregisterMenu(id); }
  return { start, stop, checkItem, refreshPMLR, apply };
})();
