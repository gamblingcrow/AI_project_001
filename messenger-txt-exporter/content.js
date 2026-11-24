// Injected into messenger.com / facebook.com by the popup.
// Defines window.__messengerTxtExport(options) which scrolls the open chat,
// collects messages and downloads them as a .txt file.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- progress overlay ----------
  function overlay() {
    let el = document.getElementById("__mtx_overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "__mtx_overlay";
      el.style.cssText =
        "position:fixed;top:12px;right:12px;z-index:2147483647;background:#0078ff;color:#fff;" +
        "font:13px system-ui,sans-serif;padding:10px 14px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);" +
        "max-width:320px;white-space:pre-wrap";
      document.body.appendChild(el);
    }
    return el;
  }
  const progress = (msg) => { overlay().textContent = "Messenger export\n" + msg; };
  const closeOverlay = (delay = 4000) =>
    setTimeout(() => document.getElementById("__mtx_overlay")?.remove(), delay);

  // ---------- locating the conversation ----------
  function findGrid() {
    const labelled = document.querySelector(
      '[role="grid"][aria-label*="essage" i], [role="log"], [aria-label^="Messages in conversation" i]'
    );
    if (labelled && labelled.querySelector('[role="row"]')) return labelled;
    // Fallback 1: find the chat by layout (the scroll area right above the message box).
    const byLayout = findByLayout();
    if (byLayout) return byLayout;
    // Fallback 2: the container with the most rows inside the main area.
    const scope = document.querySelector('[role="main"]') || document.body;
    let best = null, bestCount = 0;
    for (const g of scope.querySelectorAll('[role="grid"], [role="list"], [role="log"]')) {
      const n = g.querySelectorAll('[role="row"], [role="listitem"]').length;
      if (n > bestCount) { best = g; bestCount = n; }
    }
    return best;
  }

  function findComposer() {
    const all = [...document.querySelectorAll('[contenteditable="true"], textarea')];
    const visible = all.filter((e) => e.getBoundingClientRect().width > 50);
    return (
      visible.find((e) => /message|aa/i.test(e.getAttribute("aria-label") || e.getAttribute("placeholder") || "")) ||
      visible.find((e) => e.getAttribute("role") === "textbox") ||
      visible[visible.length - 1] ||
      null
    );
  }

  function findByLayout() {
    const composer = findComposer();
    const cr = composer && composer.getBoundingClientRect();
    let best = null, bestScore = 0;
    for (const el of document.querySelectorAll("div")) {
      if (!hasScrollStyle(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 200 || r.height < 120) continue;
      const n = el.querySelectorAll('[dir="auto"]').length;
      if (n < 1) continue;
      let score = n;
      if (cr && cr.width) {
        const cx = cr.left + cr.width / 2;
        if (cx < r.left || cx > r.right) continue; // must be in the same column as the message box
        if (r.bottom > cr.top + 20) continue;       // and sit above it (excludes whole-page scrollers)
        score += 100000;
      } else {
        score += r.left; // no message box found: prefer the right-hand pane (chat list is on the left)
      }
      if (score > bestScore) { best = el; bestScore = score; }
    }
    return best ? listContainer(best) : null;
  }

  // Inside the scroll area, the message list is the element with the most children holding content.
  function listContainer(scroller) {
    let best = scroller, bestN = 0;
    for (const el of [scroller, ...scroller.querySelectorAll("div")]) {
      let n = 0;
      for (const c of el.children) if (c.querySelector('[dir="auto"], img, video')) n++;
      if (n > bestN) { best = el; bestN = n; }
    }
    return best;
  }

  function getRows(grid) {
    let rows = [...grid.querySelectorAll('[role="row"]')];
    if (!rows.length) rows = [...grid.querySelectorAll('[role="listitem"]')];
    if (!rows.length) rows = [...grid.children].filter((c) => (c.innerText || "").trim() || c.querySelector("img, video"));
    // keep outermost rows only
    return rows.filter((r) => !rows.some((o) => o !== r && o.contains(r)));
  }

  function hasScrollStyle(el) {
    return /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY);
  }

  function isScrollable(el) {
    return hasScrollStyle(el) && el.scrollHeight > el.clientHeight + 5;
  }

  function diagnostics() {
    const q = (s) => document.querySelectorAll(s).length;
    return `page=${location.hostname}${location.pathname.replace(/\/[^/]*\d{5,}[^/]*/g, "/…")} ` +
      `rows=${q('[role="row"]')} grids=${q('[role="grid"]')} textboxes=${q('[contenteditable="true"]')} ` +
      `texts=${q('[dir="auto"]')} main=${q('[role="main"]')}`;
  }

  function findScroller(grid) {
    for (let el = grid; el && el !== document.body; el = el.parentElement) {
      if (isScrollable(el)) return el;
    }
    // Scroller may be inside the grid.
    for (const el of grid.querySelectorAll("div")) if (isScrollable(el)) return el;
    // Content may not overflow yet: accept the nearest ancestor styled as a scroll area.
    for (let el = grid; el && el !== document.body; el = el.parentElement) {
      if (hasScrollStyle(el)) return el;
    }
    return null;
  }

  function chatTitle(grid) {
    const label = grid.getAttribute("aria-label") || "";
    const m = label.match(/conversation with (.+)$/i);
    if (m) return m[1].trim();
    const main = document.querySelector('[role="main"]');
    const h = main && main.querySelector("h1, h2");
    if (h && h.textContent.trim()) return h.textContent.trim();
    return document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*[|•-]\s*(Messenger|Facebook).*$/i, "").trim() || "Messenger chat";
  }

  // ---------- parsing a single row ----------
  const NOISE = /^(Seen|Delivered|Sent|Enter|Seen by .*|Sent \d+.*ago)$/i;

  function leafTexts(row) {
    const nodes = [...row.querySelectorAll('div[dir="auto"], span[dir="auto"]')];
    const leaves = nodes.filter((n) => !nodes.some((o) => o !== n && n.contains(o)));
    const out = [];
    for (const n of leaves) {
      if (n.closest("h1,h2,h3,h4,h5,h6")) continue;
      const t = (n.innerText || n.textContent || "").trim();
      if (t && !NOISE.test(t) && out[out.length - 1] !== t) out.push(t);
    }
    return out;
  }

  // Image loads started during collection (blob: images from encrypted chats are copied
  // right away, because Messenger may revoke them once the row scrolls out of view).
  const pendingImages = [];

  function toDataUrl(src) {
    return fetch(src)
      .then((r) => r.blob())
      .then((b) => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(b);
      }));
  }

  function addImage(list, src, label) {
    if (!src || list.some((i) => i.src === src)) return;
    const item = { src, label };
    if (src.startsWith("blob:")) {
      pendingImages.push(toDataUrl(src).then((d) => { item.src = d; }).catch(() => {}));
    }
    list.push(item);
  }

  function collectMedia(row) {
    const tags = [], images = [];
    for (const img of row.querySelectorAll("img")) {
      const r = img.getBoundingClientRect();
      if (Math.max(r.width, r.height) >= 60) {
        tags.push("[photo]");
        addImage(images, img.currentSrc || img.src, "photo");
      }
    }
    for (const v of row.querySelectorAll("video")) {
      tags.push("[video]");
      addImage(images, v.poster, "video");
    }
    if (row.querySelector("audio, [aria-label*='audio' i], [aria-label*='voice' i]")) tags.push("[voice message]");
    if (!tags.length && row.querySelector("a[download], [aria-label*='file' i]")) tags.push("[file]");
    return { tags: [...new Set(tags)], images };
  }

  function parseRow(row, gridRect) {
    const headingText = [...row.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .map((h) => h.textContent.trim())
      .filter(Boolean);
    const texts = leafTexts(row);
    const { tags: media, images } = collectMedia(row);

    let sender = null, side = null;
    for (const h of headingText) {
      if (/^you sent/i.test(h)) { sender = "You"; break; }
      const m = h.match(/^(.+?) sent\b/i) || h.match(/^(.+?) replied to\b/i);
      if (m) { sender = /^you$/i.test(m[1]) ? "You" : m[1]; break; }
    }

    // Alignment fallback: outgoing bubbles are on the right.
    const bubble = row.querySelector('div[dir="auto"]') || row.querySelector("img, video");
    if (bubble && gridRect.width) {
      const r = bubble.getBoundingClientRect();
      if (r.width) side = r.left + r.width / 2 > gridRect.left + gridRect.width / 2 ? "right" : "left";
    }

    if (!texts.length && !media.length) {
      // Date/time separator or system line.
      const t = (headingText.join(" ") || row.innerText || "").replace(/\s+/g, " ").trim();
      if (t && t.length < 120 && !NOISE.test(t)) return { type: "separator", text: t, date: parseSepDate(t) };
      return null;
    }

    // A short name label shown above group-chat bubbles.
    if (!sender && texts.length > 1 && side === "left" && texts[0].length < 40 && !/\s{2}/.test(texts[0])) {
      const label = row.querySelector('span:not([dir="auto"])');
      if (label && label.textContent.trim() === texts[0]) sender = texts.shift();
    }

    return { type: "message", sender, side, text: [...texts, ...media].join("\n"), body: texts.join("\n"), media, images };
  }

  // ---------- reading dates from Messenger's dividers ----------
  // Handles English and Lithuanian forms: "Today", "Yesterday", "Mon 10:15", "Nov 3, 2025, 4:12 PM",
  // "lapkričio 3 d.", "2025-11-03 16:12", "11/3/25", "3.11.2025", or just a time (= today).
  const MONTHS = [
    ["january", 0], ["february", 1], ["march", 2], ["april", 3], ["june", 5], ["july", 6], ["august", 7],
    ["september", 8], ["october", 9], ["november", 10], ["december", 11],
    ["saus", 0], ["vas", 1], ["kov", 2], ["bal", 3], ["geg", 4], ["birž", 5], ["birz", 5], ["liep", 6],
    ["rugp", 7], ["rugs", 8], ["spal", 9], ["lapkr", 10], ["gruod", 11],
    ["jan", 0], ["feb", 1], ["mar", 2], ["apr", 3], ["may", 4], ["jun", 5], ["jul", 6], ["aug", 7],
    ["sep", 8], ["oct", 9], ["nov", 10], ["dec", 11],
  ];
  const WEEKDAYS = [
    ["sunday", 0], ["monday", 1], ["tuesday", 2], ["wednesday", 3], ["thursday", 4], ["friday", 5], ["saturday", 6],
    ["sekmad", 0], ["pirmad", 1], ["antrad", 2], ["trečiad", 3], ["treciad", 3], ["ketvirtad", 4], ["penktad", 5],
    ["šeštad", 6], ["sestad", 6],
    ["sun", 0], ["mon", 1], ["tue", 2], ["wed", 3], ["thu", 4], ["fri", 5], ["sat", 6],
  ];
  const WEEKDAY_ABBR_LT = { sk: 0, pr: 1, an: 2, tr: 3, kt: 4, pn: 5, "št": 6 };
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  function parseSepDate(text) {
    const now = new Date(), today = dayStart(now);
    const t = text.toLowerCase().replace(/\u202f|\u00a0/g, " ");
    if (/(^|[^\p{L}])(today|šiandien)/u.test(t)) return today;
    if (/(^|[^\p{L}])(yesterday|vakar)/u.test(t)) return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

    let m = t.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const fixYear = (y) => (y < 100 ? 2000 + y : y);
    m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
    if (m) return new Date(fixYear(+m[3]), +m[1] - 1, +m[2]);
    m = t.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
    if (m) return new Date(fixYear(+m[3]), +m[2] - 1, +m[1]);

    const noTime = t.replace(/\d{1,2}[:.]\d{2}(\s*[ap]\.?m\.?)?/g, " ");
    const words = noTime.split(/[^\p{L}\d]+/u).filter(Boolean);

    for (const w of words) {
      const hit = MONTHS.find(([k]) => w.startsWith(k));
      if (!hit || /\d/.test(w)) continue;
      const yearM = noTime.match(/\b(19|20)\d{2}\b/);
      const dayM = noTime.replace(/\b(19|20)\d{2}\b/, " ").match(/\b(\d{1,2})\b/);
      if (!dayM) continue;
      let d = new Date(yearM ? +yearM[0] : today.getFullYear(), hit[1], +dayM[1]);
      if (!yearM && d > today) d = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
      return d;
    }

    for (const w of words) {
      let wd = WEEKDAYS.find(([k]) => w.startsWith(k));
      wd = wd ? wd[1] : WEEKDAY_ABBR_LT[w];
      if (wd === undefined) continue;
      let back = (today.getDay() - wd + 7) % 7 || 7;
      return new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    }

    // Only a time ("10:15 AM") means today.
    if (/^\s*\d{1,2}[:.]\d{2}(\s*[ap]\.?m\.?)?\s*$/.test(t)) return today;
    const p = Date.parse(text.replace(/\bat\b/gi, " "));
    return isNaN(p) ? null : dayStart(new Date(p));
  }

  // Date of the oldest divider collected so far (dividers are in chronological order).
  function oldestDate(acc) {
    for (const e of acc) if (e.data && e.data.date) return e.data.date;
    return null;
  }

  // Give every item the date of the divider above it and keep only items inside [from, to].
  function applyRange(items, from, to) {
    if (!from && !to) return items;
    let current = (items.find((i) => i.date) || {}).date || null; // items above the first divider
    const out = [];
    for (const it of items) {
      if (it.type === "separator" && it.date) current = it.date;
      if (!current) { if (!from) out.push(it); continue; }
      if (from && current < from) continue;
      if (to && current > to) continue;
      out.push(it);
    }
    return out;
  }

  const fmtDay = (d) => d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const parseInputDate = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };

  // ---------- incremental collection (survives list virtualization) ----------
  let idSeq = 0;
  const ids = new WeakMap();
  const idOf = (el) => { if (!ids.has(el)) ids.set(el, ++idSeq); return ids.get(el); };

  function snapshot(grid) {
    const gridRect = grid.getBoundingClientRect();
    return getRows(grid).map((row) => ({ id: idOf(row), data: parseRow(row, gridRect) }));
  }

  function merge(acc, snap) {
    if (!acc.length) return snap.slice();
    const known = new Set(acc.map((e) => e.id));
    const firstIdx = snap.findIndex((e) => e.id === acc[0].id);
    const newer = snap.filter((e) => !known.has(e.id));
    if (firstIdx >= 0) {
      // Rows before the old first row were loaded above it.
      const before = snap.slice(0, firstIdx).filter((e) => !known.has(e.id));
      const after = newer.filter((e) => !before.includes(e));
      return [...before, ...acc, ...after];
    }
    // No overlap: assume everything new is older history.
    return [...newer, ...acc];
  }

  // ---------- formatting ----------
  // Fill in senders: group chats only name the first message of a run.
  function resolve(title, entries) {
    let lastLeft = null;
    const out = [];
    for (const { data } of entries) {
      if (!data) continue;
      if (data.type === "separator") { out.push(data); continue; }
      let who = data.sender;
      if (!who) who = data.side === "right" ? "You" : (lastLeft || title);
      if (who !== "You") lastLeft = who;
      out.push({ ...data, who });
    }
    return out;
  }

  function format(title, items, includeSeparators, rangeLabel) {
    const lines = [];
    let count = 0;
    for (const data of items) {
      if (data.type === "separator") {
        if (includeSeparators) lines.push("", `--- ${data.text} ---`);
        continue;
      }
      const who = data.who;
      const [first, ...rest] = data.text.split("\n");
      lines.push(`${who}: ${first}`);
      for (const r of rest) lines.push(`${" ".repeat(who.length + 2)}${r}`);
      count++;
    }
    const header = [
      `Conversation: ${title}`,
      `Exported: ${new Date().toLocaleString()}`,
      `Source: ${location.href}`,
      ...(rangeLabel ? [`Range: ${rangeLabel}`] : []),
      `Messages: ${count}`,
      "=".repeat(60),
    ];
    return { text: header.join("\n") + "\n" + lines.join("\n").replace(/^\n+/, "") + "\n", count };
  }

  function download(filename, text) {
    const blob = new Blob(["﻿" + text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // ---------- PDF (printable page + Edge's "Save as PDF") ----------
  const PDF_CSS = `
    @page { margin: 14mm; }
    * { box-sizing: border-box; }
    body { font: 11pt/1.4 "Segoe UI", system-ui, sans-serif; color: #111; margin: 0; padding: 16px; background: #fff; }
    header { border-bottom: 2px solid #0078ff; margin-bottom: 14px; padding-bottom: 8px; }
    header h1 { font-size: 18pt; margin: 0 0 4px; }
    header p { margin: 0; color: #555; font-size: 9pt; }
    .sep { text-align: center; color: #666; font-size: 9pt; margin: 16px 0 8px; break-after: avoid; }
    .msg { display: flex; flex-direction: column; align-items: flex-start; margin: 3px 0; break-inside: avoid; }
    .msg.me { align-items: flex-end; }
    .who { font-size: 8.5pt; color: #666; margin: 6px 10px 1px; }
    .bubble { max-width: 75%; background: #f0f0f0; border-radius: 14px; padding: 6px 11px;
              white-space: pre-wrap; overflow-wrap: anywhere; }
    .me .bubble { background: #0078ff; color: #fff; }
    .bubble.media { background: none; padding: 0; }
    img { display: block; max-width: 320px; max-height: 360px; border-radius: 10px; margin: 3px 0; }
    .tag { color: #888; font-style: italic; font-size: 9pt; margin: 2px 10px; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`;

  function el(doc, tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function buildPdfDoc(doc, title, items, includeSeparators, count, fileBase, rangeLabel) {
    doc.title = fileBase;
    const style = el(doc, "style", null, PDF_CSS);
    doc.head.appendChild(style);
    const b = doc.body;
    const h = el(doc, "header");
    h.appendChild(el(doc, "h1", null, title));
    h.appendChild(el(doc, "p", null, `Exported ${new Date().toLocaleString()} · ${count} messages` + (rangeLabel ? ` · ${rangeLabel}` : "")));
    b.appendChild(h);
    let prevWho = null;
    for (const it of items) {
      if (it.type === "separator") {
        if (includeSeparators) b.appendChild(el(doc, "div", "sep", it.text));
        prevWho = null;
        continue;
      }
      const m = el(doc, "div", "msg" + (it.who === "You" ? " me" : ""));
      if (it.who !== prevWho) m.appendChild(el(doc, "div", "who", it.who));
      prevWho = it.who;
      if (it.body) m.appendChild(el(doc, "div", "bubble", it.body));
      for (const im of it.images || []) {
        const box = el(doc, "div", "bubble media");
        const img = doc.createElement("img");
        img.src = im.src;
        img.alt = im.label;
        box.appendChild(img);
        m.appendChild(box);
      }
      const shown = (it.images || []).map((i) => `[${i.label}]`);
      for (const t of it.media || []) if (!shown.includes(t)) m.appendChild(el(doc, "div", "tag", t));
      b.appendChild(m);
    }
  }

  function waitForImages(doc, timeoutMs = 30000) {
    const imgs = [...doc.images].filter((i) => !i.complete);
    const all = Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; })));
    return Promise.race([all, sleep(timeoutMs)]);
  }

  async function savePdf(title, items, includeSeparators, count, fileBase, keepPreview, rangeLabel) {
    progress("Preparing PDF (loading pictures)…");
    await Promise.allSettled(pendingImages);
    const iframe = document.createElement("iframe");
    iframe.id = "__mtx_pdf";
    iframe.style.cssText = keepPreview
      ? "position:fixed;inset:0;width:100%;height:100%;z-index:2147483646;background:#fff;border:0"
      : "position:fixed;right:0;bottom:0;width:900px;height:700px;opacity:0;pointer-events:none;border:0;z-index:-1";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    buildPdfDoc(doc, title, items, includeSeparators, count, fileBase, rangeLabel);
    await waitForImages(doc);
    // Replace pictures that failed to load with a note.
    for (const img of doc.images) {
      if (!img.naturalWidth) img.replaceWith(el(doc, "div", "tag", `[${img.alt} could not be loaded]`));
    }
    if (keepPreview) return;
    progress('Choose "Save as PDF" as the printer in the dialog.');
    const oldTitle = document.title;
    document.title = fileBase;
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    document.title = oldTitle;
    setTimeout(() => iframe.remove(), 2000);
  }

  window.__mtxParseDate = parseSepDate; // handy for troubleshooting from the console

  // ---------- main ----------
  window.__messengerTxtExport = async ({ loadAll = true, maxSteps = 300, includeSeparators = true, format: fmt = "txt", keepPreview = false, from: fromStr = "", to: toStr = "" } = {}) => {
    try {
      const from = parseInputDate(fromStr), to = parseInputDate(toStr);
      if (from && to && from > to) return { ok: false, error: "The From date is after the To date." };
      const rangeLabel = from || to ? `${from ? fmtDay(from) : "start"} – ${to ? fmtDay(to) : "now"}` : "";
      let reachedFrom = false;
      const grid = findGrid();
      if (!grid) {
        const diag = diagnostics();
        progress("Couldn't find an open conversation on this page.\n" + diag);
        closeOverlay(15000);
        return { ok: false, error: "No open conversation found. Open a chat first.\n" + diag };
      }
      const title = chatTitle(grid);
      let acc = merge([], snapshot(grid));
      progress(`Found chat: ${title}\nCollected ${acc.length} rows…`);

      const scroller = loadAll ? findScroller(grid) : null;
      if (loadAll && !scroller) progress("Couldn't find the scroll area; exporting visible messages only.");

      if (scroller) {
        let stale = 0;
        for (let step = 1; step <= maxSteps && stale < 4 && !reachedFrom; step++) {
          const prevHeight = scroller.scrollHeight;
          const prevFirst = acc[0] && acc[0].id;
          scroller.scrollTop = 0;
          scroller.dispatchEvent(new Event("scroll"));
          // wait for more history to load
          let grew = false;
          for (let t = 0; t < 20; t++) {
            await sleep(150);
            if (scroller.scrollHeight !== prevHeight) { grew = true; break; }
          }
          await sleep(250);
          acc = merge(acc, snapshot(grid));
          const progressed = grew || (acc[0] && acc[0].id !== prevFirst);
          stale = progressed ? 0 : stale + 1;
          const oldest = oldestDate(acc);
          if (from && oldest && oldest < from) reachedFrom = true;
          progress(`Loading history… step ${step}/${maxSteps}\nCollected ${acc.length} rows` +
            (oldest ? `\nOldest date reached: ${fmtDay(oldest)}` : "") +
            (from ? `\nGoing back to: ${fmtDay(from)}` : ""));
        }
      }

      const items = applyRange(resolve(title, acc), from, to);
      let note = "";
      if ((from || to) && !acc.some((e) => e.data && e.data.date)) {
        note = "Couldn't read any dates in this chat, so the date range was ignored.";
      } else if (from && !reachedFrom && loadAll) {
        note = `Didn't reach ${fmtDay(from)} (chat start or scroll limit reached first).`;
      }
      const { text, count } = format(title, items, includeSeparators, rangeLabel);
      const safe = title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "chat";
      const fileBase = `messenger_${safe}_${new Date().toISOString().slice(0, 10)}`;
      const saved = [];
      if (fmt === "txt" || fmt === "both") {
        download(fileBase + ".txt", text);
        saved.push(fileBase + ".txt");
      }
      if (fmt === "pdf" || fmt === "both") {
        await savePdf(title, items, includeSeparators, count, fileBase, keepPreview, rangeLabel);
        saved.push(fileBase + ".pdf (via print dialog)");
      }
      const filename = saved.join(" and ");
      progress(`Done! ${count} messages → ${filename}` + (note ? `\n${note}` : ""));
      closeOverlay(note ? 10000 : 4000);
      return { ok: true, count, filename, note };
    } catch (e) {
      progress("Error: " + e.message);
      closeOverlay(8000);
      return { ok: false, error: e.message };
    }
  };
})();
