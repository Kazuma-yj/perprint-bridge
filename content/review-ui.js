/* global window, document */
(() => {
  "use strict";
  function initialize() {
  const controller = window.arguments?.[0];
  if (!controller?.session) {
    document.getElementById("heading").textContent = "Open this window from Zotero / 请从 Zotero 打开此窗口";
    return;
  }
  const { session } = controller;
  const cn = String(controller.locale).toLowerCase().startsWith("zh");
  const t = (zh, en) => cn ? zh : en;
  document.documentElement.lang = cn ? "zh-CN" : "en";
  const $ = id => document.getElementById(id);
  // createElement() on an XHTML document must use the XHTML namespace.
  const el = (name, text, className) => {
    const node = document.createElementNS("http://www.w3.org/1999/xhtml", name);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const statuses = {
    queued: t("等待核对", "Queued"), checking: t("正在检索…", "Checking…"),
    ready: t("已找到正式记录", "Publication found"), accepted: t("仅有录用说明", "Acceptance note only"),
    unchanged: t("出版字段无需修改", "No field changes"), not_found: t("未找到匹配", "No match found"),
    incomplete: t("部分来源不可用", "Search incomplete"), cancelled: t("已停止，尚未核对", "Stopped; not checked"),
    error: t("未完成 · 可重试", "Failed · retry available"), skipped: t("需要补全条目", "Item needs attention"),
    updating: t("正在保存…", "Saving…"), updated: t("已更新", "Updated"), undone: t("已撤销", "Undone")
  };
  const fields = {
    itemType: ["条目类型", "Item type"], title: ["题名", "Title"], date: ["发表日期", "Published"],
    proceedingsTitle: ["论文集标题", "Proceedings title"], conferenceName: ["会议名称", "Conference"],
    publicationTitle: ["刊名", "Journal"], DOI: ["DOI", "DOI"], url: ["网址", "URL"],
    pages: ["页码", "Pages"], volume: ["卷次", "Volume"], series: ["系列", "Series"],
    publisher: ["出版方", "Publisher"], libraryCatalog: ["文库编目", "Library catalog"],
    accessDate: ["访问日期", "Accessed"], extra: ["其他", "Extra"], repository: ["存储库", "Repository"],
    archiveID: ["存档标识", "Archive ID"], creators: ["作者", "Creators"]
  };
  const fieldName = field => {
    if (fields[field]) return t(...fields[field]);
    try { return controller.fieldLabel?.(field) || field; } catch (_) { return field; }
  };
  function display(value, field) {
    if (!value) return "—";
    if (field === "itemType") {
      const types = { preprint: t("预印本", "Preprint"), conferencePaper: t("会议论文", "Conference paper"), journalArticle: t("期刊文章", "Journal article") };
      return types[value] || value;
    }
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  let active = null, latest;
  $("heading").textContent = t("核对出版信息", "Review publication information");
  $("intro").textContent = t("先查看差异，再勾选要更新的论文。", "Review the changes, then choose which papers to update.");
  $("queue-heading").textContent = t("本次选中的论文", "PAPERS IN THIS SESSION");
  $("retry").textContent = t("继续 / 重试未完成项", "Continue / retry unfinished");
  $("stop").textContent = t("停止队列", "Stop queue");
  $("undo").textContent = t("撤销本窗口的更新", "Undo this window’s updates");
  $("policy").textContent = t("只更新原条目的出版字段。作者列表、PDF 和批注保持原样。", "Updates publication fields on the original item. Authors, PDFs and annotations stay in place.");
  $("undo-note").textContent = t("撤销记录仅保留到关闭此窗口。遇到手动修改时，可查看差异后选择覆盖。", "Undo is available until this window closes. Manual edits can be overwritten after reviewing the differences.");
  $("detail").setAttribute("aria-label", t("出版信息及修改预览", "Publication details and changes"));
  function run(task) {
    $("error").hidden = true;
    Promise.resolve().then(task).catch(error => { $("error").textContent = String(error.message || error); $("error").hidden = false; });
  }
  $("retry").addEventListener("click", () => run(() => session.scan({ retry: true })));
  $("stop").addEventListener("click", () => session.cancel());
  $("apply").addEventListener("click", () => run(() => session.applySelected()));
  $("undo").addEventListener("click", () => run(() => session.undoAll()));
  $("select-formal").addEventListener("click", () => {
    const formal = latest.rows.filter(row => row.status === "ready");
    session.selectFormal(!formal.every(row => row.selected));
  });
  function renderDetail(row, idle) {
    const box = $("detail"); box.replaceChildren();
    if (!row) { box.append(el("p", t("队列为空。", "The queue is empty."))); return; }
    box.append(el("span", statuses[row.status], "badge" + (row.status === "updated" ? " success" : "")), el("h2", row.title));
    if (row.error) box.append(el("p", row.error, "notice caution"));
    if (row.conflict) {
      const overwrite = el("button", row.conflict === "apply" ? t("按当前内容重新预览…", "Review changes against current data…") : t("查看后续修改并撤销…", "Review later edits and undo…"));
      overwrite.type = "button"; overwrite.disabled = !idle;
      overwrite.addEventListener("click", () => run(() => row.conflict === "apply" ? session.rebase(row.id) : session.undoAll(row.id, true)));
      box.append(overwrite);
    }
    if (row.status === "updated") box.append(el("p", t("出版信息已更新。作者列表和 PDF 保持原样。", "Publication information updated. The author list and PDFs are unchanged."), "notice success"));
    if (row.status === "undone") box.append(el("p", t("已恢复到本次更新前的条目信息。", "The item’s metadata has been restored to its state before this update."), "notice success"));
    const result = row.result, candidate = result?.candidates[row.candidateIndex];
    if (candidate) {
      if (result.manualOverride && row.status !== "updated") box.append(el("p", t("下方以当前条目为基准，使用上次找到的出版记录。请确认仍为同一篇论文；勾选更新将覆盖列出的当前值。", "The differences below use the current item and the previously found publication. Confirm this is still the same paper; selecting it for update overwrites the listed values."), "notice caution"));
      if (result.candidates.length > 1) {
        const select = el("select", undefined, "candidate");
        select.setAttribute("aria-label", t("选择出版记录", "Choose publication record"));
        result.candidates.forEach((c, i) => { const option = el("option", `${c.source} · ${c.venue} (${c.year})`); option.value = i; select.append(option); });
        select.value = row.candidateIndex;
        select.disabled = !idle || !["ready", "accepted", "unchanged"].includes(row.status);
        select.addEventListener("change", () => session.chooseCandidate(row.id, Number(select.value)));
        box.append(select);
      }
      const accepted = candidate.publicationStatus === "accepted";
      box.append(el("p", t("来源：", "Source: ") + candidate.source + " · " + (candidate.date || candidate.year), "metadata"));
      box.append(el("p", candidate.venue, "metadata"));
      box.append(el("p", accepted ? t("依据：arXiv 作者的录用说明。尚未找到正式出版记录；保留 arXiv 链接，不填正式 DOI。", "Evidence: the author’s arXiv acceptance note. No publication record found; the arXiv URL stays and no publisher DOI is added.") :
        result.manualOverride ? t("上次检索的匹配依据：当时的规范化题名与第一作者一致。", "Previous lookup basis: the normalized title and first author at that time matched.") :
        t("匹配依据：规范化题名与第一作者一致。", "Match basis: normalized title and first author agree."), accepted ? "notice caution" : "notice"));
      if (candidate.url) box.append(el("p", candidate.url, "metadata"));
      if (candidate.ccf) box.append(el("p", `CCF (2026): ${candidate.ccf.grade}` + (candidate.ccf.acronym ? ` (${candidate.ccf.acronym})` : ""), "metadata"));
      const changes = result.previews[row.candidateIndex];
      box.append(el("h3", row.status === "updated" ? t("本次已保存的修改", "Changes saved in this session") : t("将要修改的字段", "Proposed field changes")));
      if (!changes.length) box.append(el("p", t("这些出版字段与现有记录相同。", "These publication fields already match the record."), "muted"));
      else {
        const table = el("table"), head = el("thead"), tr = el("tr");
        for (const text of [t("字段", "Field"), t("修改前", "Before"), t("修改后", "After")]) { const th = el("th", text); th.scope = "col"; tr.append(th); }
        head.append(tr); table.append(head);
        const body = el("tbody");
        for (const change of changes) {
          const line = el("tr");
          line.append(el("th", fieldName(change.field)), el("td", display(change.before, change.field)), el("td", display(change.after, change.field)));
          line.firstChild.scope = "row"; body.append(line);
        }
        table.append(body); box.append(table);
      }
    } else if (row.status === "not_found" || row.status === "incomplete") {
      box.append(el("p", t("此次未能确认发表信息，不能据此判定论文尚未发表。可稍后重试。", "Publication could not be confirmed. This does not establish that the paper is unpublished. You can retry later."), "notice"));
    } else if (row.status === "checking" || row.status === "queued" || row.status === "cancelled") {
      box.append(el("p", t("按顺序检索。停止后可继续，已找到的结果会保留。", "Papers are checked one at a time. Stop and continue without losing completed results."), "muted"));
    }
    if (result?.checks?.length) {
      const details = el("details"); details.append(el("summary", t("查看各来源的检索结果", "View source checks")));
      for (const check of result.checks) {
        const outcomes = { found: t("已找到", "found"), checked: t("已读取", "read"), accepted: t("录用说明", "acceptance note"), error: t("不可用", "unavailable"), not_found: t("无匹配", "no match") };
        details.append(el("p", `${check.source}: ${outcomes[check.outcome] || check.outcome}` + (check.detail ? " · " + check.detail : "")));
      }
      box.append(details);
    }
  }
  function render(state) {
    latest = state;
    if (active === null || !state.rows.some(row => row.id === active)) active = state.rows[0]?.id ?? null;
    const idle = state.phase === "idle";
    const checked = state.rows.filter(row => !["queued", "checking", "cancelled"].includes(row.status)).length;
    const selected = state.rows.filter(row => row.selected && row.canSelect).length;
    const updated = state.rows.filter(row => row.canUndo).length;
    const phase = { idle: t("核对结果", "Review results"), checking: t("正在核对", "Checking"), stopping: t("正在停止，等待当前操作结束", "Stopping after the current operation"), updating: t("正在更新", "Updating"), undoing: t("正在撤销", "Undoing") }[state.phase];
    $("summary").textContent = `${phase} · ${t("已核对", "Checked")} ${checked}/${state.rows.length} · ${t("已勾选", "Selected")} ${selected} · ${t("已更新", "Updated")} ${updated}`;
    $("retry").disabled = !idle || !state.rows.some(row => ["queued", "cancelled", "error", "not_found", "incomplete", "skipped", "undone"].includes(row.status));
    $("stop").hidden = idle; $("stop").disabled = state.phase === "stopping";
    const formal = state.rows.filter(row => row.status === "ready");
    $("select-formal").disabled = !idle || !formal.length;
    $("select-formal").textContent = formal.length && formal.every(row => row.selected) ? t("取消勾选正式记录", "Deselect publications") : t("勾选全部正式记录", "Select all publications");
    $("apply").textContent = t(`更新勾选的 ${selected} 项`, `Update ${selected} selected`);
    $("apply").disabled = !idle || !selected; $("undo").disabled = !idle || !updated;
    const list = $("rows"), focusID = document.activeElement?.getAttribute("data-focus");
    list.replaceChildren();
    for (const row of state.rows) {
      const entry = el("div", undefined, "row" + (row.id === active ? " active" : ""));
      entry.dataset.status = row.status;
      const check = el("input"); check.type = "checkbox"; check.checked = row.selected;
      check.disabled = !idle || !row.canSelect; check.setAttribute("aria-label", t("选择更新：", "Select for update: ") + row.title);
      check.setAttribute("data-focus", "check-" + row.id);
      check.addEventListener("change", () => { active = row.id; session.select(row.id, check.checked); });
      const button = el("button"); button.type = "button"; button.setAttribute("aria-pressed", String(row.id === active));
      button.setAttribute("data-focus", "row-" + row.id);
      button.append(el("span", row.title, "row-title"), el("span", statuses[row.status], "row-status"));
      button.addEventListener("click", () => { active = row.id; render(latest); });
      entry.append(check, button); list.append(entry);
    }
    if (focusID) Array.from(list.querySelectorAll("[data-focus]")).find(node => node.getAttribute("data-focus") === focusID)?.focus({ preventScroll: true });
    renderDetail(state.rows.find(row => row.id === active), idle);
  }
  const unsubscribe = session.subscribe(render);
  window.addEventListener("unload", () => { unsubscribe(); controller.onClose?.(); session.close(); }, { once: true });
  run(() => session.scan());
  }
  // Gecko chrome documents and browser XML documents can handle defer
  // differently. Always wait until the XHTML body exists before binding UI.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
