// Dialogs: a searchable picker (instruments, drum kits) and simple information dialogs.
// Keyboard: Escape closes, the search field filters as you type, arrows move through the
// list, Enter picks; focus returns to the element that opened the dialog.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function shell(title, cls = "") {
  const prev = document.activeElement;
  const back = document.createElement("div"); back.className = "dlg-backdrop";
  back.innerHTML = `<div class="dlg ${cls}" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
    <header class="dlg-head"><h2 id="dlgTitle">${esc(title)}</h2><button type="button" class="icon-btn dlg-close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>
    <div class="dlg-body"></div></div>`;
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey, true); if (prev && prev.focus) prev.focus(); };
  const onKey = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  back.addEventListener("mousedown", e => { if (e.target === back) close(); });
  back.querySelector(".dlg-close").addEventListener("click", close);
  return { back, body: back.querySelector(".dlg-body"), close };
}

/*
 * items: [{ key, name, group, sub }]; current: selected key; onPick(key); onPreview(key) → Promise.
 * groups are shown as filter chips in the order they first appear.
 */
export function openPicker({ title, items, current, onPick, onPreview, note = "", searchLabel = "Search" }) {
  const { body, close } = shell(title, "dlg-picker");
  const groups = [...new Set(items.map(i => i.group))];
  let group = "", query = "";
  body.innerHTML = `<input type="search" class="dlg-search" placeholder="${esc(searchLabel)}" aria-label="${esc(searchLabel)}">
    ${groups.length > 8
      ? `<span class="select"><select class="dlg-family" aria-label="Family"><option value="">All families</option>${groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join("")}</select></span>`
      : `<div class="chips" role="group" aria-label="Families"><button type="button" class="chip" aria-pressed="true" data-g="">All</button>${groups.map(g => `<button type="button" class="chip" aria-pressed="false" data-g="${esc(g)}">${esc(g)}</button>`).join("")}</div>`}
    <ul class="dlg-list" role="listbox" aria-label="${esc(title)}"></ul>
    <p class="snote dlg-note" role="status">${esc(note)}</p>`;
  const list = body.querySelector(".dlg-list"), search = body.querySelector(".dlg-search"), status = body.querySelector(".dlg-note");
  const render = () => {
    const q = query.trim().toLowerCase();
    const shown = items.filter(i => (!group || i.group === group) && (!q || (i.name + " " + i.group).toLowerCase().includes(q)));
    list.innerHTML = shown.length ? shown.map(i => `<li role="option" aria-selected="${i.key === current}" data-k="${esc(i.key)}">
        <button type="button" class="pick"><span>${esc(i.name)}</span><small>${esc(i.sub || i.group)}</small></button>
        ${onPreview ? `<button type="button" class="icon-btn listen" aria-label="Listen to ${esc(i.name)}" title="Listen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg></button>` : ""}</li>`).join("")
      : `<li class="empty">Nothing matches “${esc(query)}”.</li>`;
  };
  render();
  search.addEventListener("input", () => { query = search.value; render(); });
  const fam = body.querySelector(".dlg-family");
  if (fam) fam.addEventListener("change", () => { group = fam.value; render(); });
  if (body.querySelector(".chips")) body.querySelector(".chips").addEventListener("click", e => {
    const b = e.target.closest(".chip"); if (!b) return;
    group = b.dataset.g; body.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(c === b))); render();
  });
  list.addEventListener("click", async e => {
    const li = e.target.closest("li[data-k]"); if (!li) return;
    const key = li.dataset.k;
    if (e.target.closest(".listen")) {
      status.textContent = "Loading the sound…";
      try { await onPreview(key); status.textContent = "Playing " + (items.find(i => i.key === key) || {}).name + "."; } catch (err) { status.textContent = "This sound couldn't load, so you're hearing a synthesized version."; }
      return;
    }
    onPick(key); close();
  });
  list.addEventListener("keydown", e => {
    const btns = [...list.querySelectorAll(".pick")], i = btns.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = btns[Math.max(0, Math.min(btns.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]; if (n) n.focus(); }
  });
  search.addEventListener("keydown", e => { if (e.key === "ArrowDown") { e.preventDefault(); const b = list.querySelector(".pick"); if (b) b.focus(); } if (e.key === "Enter") { const b = list.querySelector(".pick"); if (b) b.click(); } });
  const sel = list.querySelector('[aria-selected="true"] .pick');
  (sel || search).focus(); if (sel) sel.scrollIntoView({ block: "center" });
  return close;
}

// A dialog with static HTML content.
export function openInfo(title, html, cls = "") {
  const { body, close } = shell(title, cls);
  body.innerHTML = html;
  body.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", close));
  const f = body.querySelector("button, a, input"); if (f) f.focus();
  return { body, close };
}
