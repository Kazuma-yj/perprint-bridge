/* A window-scoped queue. Adapters own Zotero objects; the UI only sees data. */
var PreprintBridgeReviewModel = (() => {
  function create(adapter) {
    const rows = [], listeners = new Set();
    let phase = "idle", epoch = 0, closed = false;
    const ready = row => ["ready", "accepted"].includes(row.status);
    const retryable = row => ["queued", "cancelled", "error", "not_found", "incomplete", "skipped", "undone"].includes(row.status);
    const view = () => ({ phase, closed, rows: rows.map(row => ({
      id: row.id, title: row.title, status: row.status, selected: row.selected,
      candidateIndex: row.candidateIndex, result: row.result, error: row.error,
      canSelect: ready(row), canUndo: !!row.undo, conflict: row.conflict
    })) });
    const emit = () => { if (!closed) for (const listener of listeners) listener(view()); };
    function add(entries) {
      if (closed) return;
      for (const entry of entries) {
        if (rows.some(row => row.id === entry.id)) continue;
        rows.push({ ...entry, status: "queued", selected: false, candidateIndex: 0, result: null, error: "", undo: null });
      }
      emit();
    }
    async function scan({ retry = false } = {}) {
      if (closed || phase !== "idle") return;
      if (retry) for (const row of rows) if (retryable(row)) row.status = "queued";
      phase = "checking";
      const token = ++epoch;
      const guard = () => { if (closed || token !== epoch) throw Error("Cancelled"); };
      emit();
      try {
        for (const row of rows) {
          guard();
          if (row.status !== "queued") continue;
          row.status = "checking"; row.error = ""; row.conflict = null; row.result = null; row.selected = false;
          emit();
          try {
            const result = await adapter.check(row.id, guard);
            guard();
            row.result = result;
            row.title = result.title || row.title;
            row.candidateIndex = 0;
            if (!result.candidates.length) row.status = result.status === "partial_failure" ? "incomplete" : "not_found";
            else choose(row, 0);
          } catch (error) {
            if (closed || token !== epoch) { row.status = "cancelled"; break; }
            row.status = error.skipped ? "skipped" : "error";
            row.error = String(error.message || error);
          }
          emit();
        }
      } catch (error) {
        if (!closed && token === epoch) throw error;
      } finally { phase = "idle"; emit(); }
    }
    function choose(row, index) {
      row.candidateIndex = index;
      row.selected = false;
      const candidate = row.result.candidates[index];
      row.status = !row.result.previews[index].length ? "unchanged" : candidate.publicationStatus === "accepted" ? "accepted" : "ready";
    }
    function chooseCandidate(id, index) {
      const row = rows.find(row => row.id === id);
      if (closed || phase !== "idle" || !row || row.undo || !["ready", "accepted", "unchanged"].includes(row.status) ||
        !Number.isInteger(index) || !row.result?.candidates[index]) return;
      choose(row, index); emit();
    }
    function select(id, value) {
      if (closed || phase !== "idle") return;
      const row = rows.find(row => row.id === id);
      if (row && ready(row)) { row.selected = !!value; emit(); }
    }
    function selectFormal(value) {
      if (closed || phase !== "idle") return;
      // Acceptance-only records always require an individual choice.
      for (const row of rows) if (row.status === "ready") row.selected = !!value;
      emit();
    }
    function rebase(id) {
      const row = rows.find(row => row.id === id);
      if (closed || phase !== "idle" || row?.conflict !== "apply") return;
      try {
        row.result = adapter.rebase(id, row.result);
        row.error = ""; row.conflict = null;
        choose(row, row.candidateIndex);
      } catch (error) { row.error = String(error.message || error); }
      emit();
    }
    function cancel() {
      if (phase === "idle") return;
      ++epoch;
      phase = "stopping";
      emit();
    }
    async function applySelected() {
      if (closed || phase !== "idle") return;
      const chosen = rows.filter(row => ready(row) && row.selected);
      if (!chosen.length) return;
      phase = "updating";
      const token = ++epoch;
      emit();
      try {
        for (const row of chosen) {
          if (closed || token !== epoch) break;
          row.status = "updating"; row.error = ""; emit();
          try {
            row.undo = await adapter.apply(row.id, row.result, row.candidateIndex);
            row.status = "updated";
          } catch (error) {
            row.status = "error"; row.error = String(error.message || error);
            row.conflict = error.code === "ITEM_CHANGED" ? "apply" : null;
          }
          row.selected = false;
          emit();
        }
      } finally { phase = "idle"; emit(); }
    }
    async function undoAll(onlyID, overwrite = false) {
      if (closed || phase !== "idle") return;
      const changed = rows.filter(row => row.undo && (onlyID === undefined || row.id === onlyID)).reverse();
      if (!changed.length) return;
      phase = "undoing";
      const token = ++epoch;
      emit();
      try {
        for (const row of changed) {
          if (closed || token !== epoch) break;
          try {
            if (await adapter.undo(row.id, row.undo, { overwrite }) === false) continue;
            row.undo = null; row.status = "undone"; row.result = null; row.error = ""; row.conflict = null;
          } catch (error) {
            row.error = String(error.message || error);
            row.conflict = error.code === "ITEM_CHANGED" ? "undo" : null;
          }
          emit();
        }
      } finally { phase = "idle"; emit(); }
    }
    function close() { closed = true; ++epoch; listeners.clear(); }
    return { add, scan, select, selectFormal, chooseCandidate, rebase, applySelected, undoAll, cancel, close, view,
      subscribe(listener) { listeners.add(listener); listener(view()); return () => listeners.delete(listener); }
    };
  }
  // Shared pacing survives retries within a window; cooling down a rate-limited
  // host allows other sources/items to proceed without immediately hammering it.
  function pacedRequest(request, { wait, now = Date.now, interval = 1200, cooldown = 60_000 } = {}) {
    const next = new Map(), blocked = new Map();
    return async (url, options, guard = () => {}) => {
      guard();
      const hostname = new URL(url).hostname;
      const host = /(?:^|\.)dblp\.org$/.test(hostname) ? "dblp.org" : hostname;
      if ((blocked.get(host) || 0) > now()) throw Error("HTTP 429: " + host + " is cooling down; retry later");
      let delay = (next.get(host) || 0) - now();
      while (delay > 0) {
        await wait(Math.min(delay, 200)); guard();
        delay = (next.get(host) || 0) - now();
      }
      next.set(host, now() + interval);
      try { const result = await request(url, options); guard(); return result; }
      catch (error) {
        const status = error.status || error.xmlhttp?.status;
        if (status === 429 || /\b429\b/.test(String(error.message || error))) blocked.set(host, now() + cooldown);
        throw error;
      }
    };
  }
  return { create, pacedRequest };
})();
