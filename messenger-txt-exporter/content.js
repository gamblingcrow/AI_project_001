// Injected into messenger.com / facebook.com by the popup.
// Defines window.__messengerTxtExport(options) which scrolls the open chat,
// collects messages and saves them as .txt and/or .pdf (optionally one file per year/month).
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- progress overlay ----------
  let userStop = false;

  function overlay() {
    let el = document.getElementById("__mtx_overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "__mtx_overlay";
      el.style.cssText =
        "position:fixed;top:12px;right:12px;z-index:2147483647;background:#0078ff;color:#fff;" +
        "font:13px system-ui,sans-serif;padding:10px 14px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);" +
        "max-width:320px;white-space:pre-wrap";
      const text = document.createElement("div");
      text.className = "__mtx_text";
      const btn = document.createElement("button");
      btn.className = "__mtx_stop";
      btn.textContent = "Stop & save what I have";
      btn.style.cssText = "margin-top:8px;padding:4px 10px;border:0;border-radius:5px;background:#fff;color:#0078ff;font-weight:600;cursor:pointer";
      btn.onclick = () => { userStop = true; btn.disabled = true; btn.textContent = "Stopping…"; };
      el.append(text, btn);
      document.body.appendChild(el);
    }
    return el;
  }
  const progress = (msg, done = false) => {
    const el = overlay();
    el.querySelector(".__mtx_text").textContent = "Messenger export\n" + msg;
    el.querySelector(".__mtx_stop").style.display = done ? "none" : "";
  };
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
    for (const sel of ['[role="row"]', '[role="listitem"]']) {
      const rows = [...grid.querySelectorAll(sel)];
      if (rows.length) {
        // keep outermost rows only
        return rows.filter((r) => {
          const p = r.parentElement && r.parentElement.closest(sel);
          return !p || !grid.contains(p);
        });
      }
    }
    return [...grid.children].filter((c) => (c.innerText || "").trim() || c.querySelector("img, video"));
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
    const m = label.match(/conversation (?:with|titled|named) (.+)$/i);
    if (m) return m[1].trim();
    const main = document.querySelector('[role="main"]');
    const h = main && main.querySelector("h1, h2");
    if (h && h.textContent.trim()) return h.textContent.trim();
    return document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*[|•-]\s*(Messenger|Facebook).*$/i, "").trim() || "Messenger chat";
  }

  const NOISE = /^(Seen|Delivered|Sent|Enter|Seen by .*|Sent \d+.*ago|Loading.*|Kraunama.*)$/i;

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

  // blob: images (encrypted chats) are copied right away, because Messenger may revoke
  // them once the row scrolls out of view.

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

  let wantPictures = true;

  function addImage(list, src, label) {
    if (!wantPictures || !src || list.some((i) => i.src === src)) return;
    const item = { src, label };
    if (src.startsWith("blob:")) {
      item.ready = toDataUrl(src).then((d) => { item.src = d; }).catch(() => {});
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

  // ---------- parsing a single row ----------
  // Messenger puts a hidden screen-reader line in every message row, e.g.
  //   "Enter, Message sent March 3, 2026, 9:15 AM by Alice: <text>"
  // It gives the exact sender and time, so it is used whenever present (and never printed).
  const A11Y = /^(?:enter,\s*)?message (?:sent|received)\s+(.+?)\s+by\s+(.+?)(?::\s+([\s\S]*))?$/i;
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

  function parseTime(str) {
    const s = str.replace(/ | /g, " ").trim();
    const t = Date.parse(s.replace(/,\s*(\d{1,2}:\d{2})/, " $1").replace(/\bat\b/i, " "));
    if (!isNaN(t)) return new Date(t);
    const day = parseSepDate(s);
    if (!day) return null;
    const m = s.match(/(\d{1,2})[:.](\d{2})\s*([ap])?/i);
    let h = m ? +m[1] : 0;
    const min = m ? +m[2] : 0;
    if (m && m[3]) {
      const pm = /p/i.test(m[3]);
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
    }
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min);
  }

  // A short "Aug 12, 2026, 11:23 AM"-style header Messenger shows above a group of messages.
  const isDateHeader = (t) =>
    t.length < 50 && /\d{1,2}[:.]\d{2}|\b(19|20)\d{2}\b/.test(t) && !!parseSepDate(t);

  function findA11y(texts, row) {
    for (let i = 0; i < texts.length; i++) {
      const m = texts[i].match(A11Y);
      if (m) return { index: i, raw: texts[i], m };
    }
    for (const e of row.querySelectorAll("[aria-label]")) {
      const raw = e.getAttribute("aria-label").trim();
      const m = raw.match(A11Y);
      if (m) return { index: -1, raw, m };
    }
    return null;
  }

  function parseRow(row, gridRect) {
    const headingText = [...row.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .map((h) => h.textContent.trim())
      .filter(Boolean);
    const texts = leafTexts(row);
    const { tags: media, images } = collectMedia(row);

    const a = findA11y(texts, row);
    if (a) {
      const [, time, whoRaw, bodyRaw = ""] = a.m;
      const who = /^you$/i.test(whoRaw.trim()) ? "You" : whoRaw.trim();
      const a11yBody = bodyRaw.trim();
      const nb = norm(a11yBody), nWho = norm(who);
      const rest = texts.filter((_, i) => i !== a.index);
      // Find the visible bubble text that matches the hidden line (keeps line breaks and links).
      let bodyIdx = -1;
      if (a11yBody) {
        bodyIdx = rest.findIndex((t) => t.trim() === a11yBody);
        if (bodyIdx < 0 && nb) {
          bodyIdx = rest.findIndex((t) => {
            const nt = norm(t);
            return nt && (nt === nb || (nt.length > 8 && (nb.startsWith(nt) || nt.startsWith(nb))));
          });
        }
        if (bodyIdx < 0 && !nb) { // emoji-only message: the last emoji-only text is the bubble
          for (let i = rest.length - 1; i >= 0; i--) if (rest[i].trim() && !norm(rest[i])) { bodyIdx = i; break; }
        }
      }
      const pre = [], post = [];
      rest.forEach((t, i) => {
        if (i === bodyIdx) return;
        const nt = norm(t);
        if (!t.trim() || (nt && nt === nWho) || isDateHeader(t) || /replied to|original message/i.test(t)) return;
        (bodyIdx < 0 || i < bodyIdx ? pre : post).push(t);
      });
      const body = bodyIdx >= 0 ? rest[bodyIdx] : a11yBody;
      // Text above the message is the message it replies to; text below is e.g. a link preview.
      const quote = pre.join(" ");
      return {
        type: "message", raw: a.raw, ts: parseTime(time), who, body, quote,
        text: [body, ...post, ...media].filter(Boolean).join("\n"), media, images,
      };
    }

    // ----- fallback when there is no hidden line (other languages / older layouts) -----
    let sender = null, side = null;
    for (const h of headingText) {
      if (/^you sent/i.test(h)) { sender = "You"; break; }
      const m = h.match(/^(.+?) sent\b/i) || h.match(/^(.+?) replied to\b/i);
      if (m) { sender = /^you$/i.test(m[1]) ? "You" : m[1]; break; }
    }
    const bubble = row.querySelector('div[dir="auto"]') || row.querySelector("img, video");
    if (bubble && gridRect.width) {
      const r = bubble.getBoundingClientRect();
      if (r.width) side = r.left + r.width / 2 > gridRect.left + gridRect.width / 2 ? "right" : "left";
    }
    const header = texts.find(isDateHeader);
    let bodyTexts = texts.filter((t) => !isDateHeader(t));
    if (!bodyTexts.length && !media.length) {
      const t = (headingText.join(" ") || row.innerText || "").replace(/\s+/g, " ").trim();
      if (t && t.length < 120 && !NOISE.test(t)) {
        return { type: "separator", raw: "sep:" + t, text: t, date: parseSepDate(t) };
      }
      return null;
    }
    if (!sender && bodyTexts.length > 1 && side === "left" && bodyTexts[0].length < 40) {
      const label = row.querySelector('span:not([dir="auto"])');
      if (label && label.textContent.trim() === bodyTexts[0]) sender = bodyTexts.shift();
    }
    const body = bodyTexts.join("\n");
    return {
      type: "message", raw: `row:${sender || side}:${body}:${media.join()}:${images.map((i) => i.src).join()}`,
      ts: header ? parseTime(header) : null, sender, side, body, quote: "", text: [body, ...media].filter(Boolean).join("\n"), media, images,
    };
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

  const fmtDay = (d) => d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const fmtLongDay = (d) => d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const parseInputDate = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };

  // ---------- collecting ----------
  // Messages are stored by identity (the hidden "Message sent … by …" line), not by DOM position,
  // so rows that Messenger re-renders, re-orders or inserts below its "Loading…" row can't be
  // duplicated or misplaced. Everything is sorted by time when saving.
  //
  // A MutationObserver reports which rows Messenger added or changed, so each step only reads
  // the new rows: the add-on's own work per step stays the same however long the chat gets.
  const records = new Map();      // key -> record
  const doneKeys = new Set();     // keys already written to a file (or outside the date range)
  const slots = new Map();        // raw text -> [{ ref: WeakRef(row), key }] (tells re-renders from look-alike messages)
  const rowInfo = new WeakMap();  // row element -> { key, raw }
  const senders = new Set();
  let batchNo = 0, minTs = null, maxTs = null;
  let direction = -1;             // -1 = loading older (scrolling up), +1 = loading newer (scrolling down)

  let rowSel = null;              // '[role="row"]' | '[role="listitem"]' | null (= direct children of the list)
  function detectRowSel(grid) {
    for (const sel of ['[role="row"]', '[role="listitem"]']) if (grid.querySelector(sel)) return sel;
    return null;
  }

  // The (outermost) message row that contains a node, or null.
  function rowOf(grid, node) {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el || el === grid || !grid.contains(el)) return null;
    if (rowSel) {
      let r = el.closest(rowSel);
      if (!r || !grid.contains(r)) return null;
      for (let p = r.parentElement && r.parentElement.closest(rowSel); p && grid.contains(p);
        p = p.parentElement && p.parentElement.closest(rowSel)) r = p;
      return r;
    }
    while (el && el.parentElement !== grid) el = el.parentElement;
    return el;
  }

  const pending = new Set();
  let observer = null, wake = null;
  function startObserver(grid) {
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList") {
          for (const n of m.addedNodes) {
            const r = rowOf(grid, n.nodeType === 1 ? n : m.target);
            if (r) pending.add(r);
            else if (n.nodeType === 1 && rowSel) {
              for (const x of n.querySelectorAll(rowSel)) { const rr = rowOf(grid, x); if (rr) pending.add(rr); }
            } else if (n.nodeType === 1 && !rowSel && n.parentElement === grid) pending.add(n);
          }
          if (m.removedNodes.length) { const r = rowOf(grid, m.target); if (r) pending.add(r); }
        } else if (m.type === "characterData") {
          const r = rowOf(grid, m.target);
          if (r) pending.add(r);
        }
      }
      if (pending.size && wake) { const w = wake; wake = null; w(true); }
    });
    observer.observe(grid, { childList: true, subtree: true, characterData: true });
  }
  function stopObserver() { if (observer) observer.disconnect(); observer = null; }

  function waitForRows(ms) {
    if (pending.size) return Promise.resolve(true);
    return new Promise((res) => {
      wake = res;
      setTimeout(() => { if (wake === res) { wake = null; res(false); } }, ms);
    });
  }
  function takePending() { const rows = [...pending]; pending.clear(); return rows; }

  function assignSlot(raw, row) {
    let list = slots.get(raw);
    if (!list) slots.set(raw, (list = []));
    for (const s of list) if (s.ref.deref() === row) return s.key;
    // The same message re-rendered as a new element: the old element is gone from the page.
    for (const s of list) {
      const el = s.ref.deref();
      if (!el || !el.isConnected) { s.ref = new WeakRef(row); return s.key; }
    }
    // Otherwise it's a different message that looks identical (same person, minute and text).
    const key = raw + "#" + (list.length + 1);
    list.push({ ref: new WeakRef(row), key });
    return key;
  }

  // A later look at the same row may see more (a picture that finished loading, etc.).
  function mergeInto(rec, p) {
    if (!rec) return;
    if ((p.images || []).length > (rec.images || []).length) { rec.images = p.images; rec.media = p.media; }
    if ((p.text || "").length > (rec.text || "").length) {
      rec.text = p.text; rec.body = p.body; rec.quote = p.quote; rec.media = p.media;
    }
    if (!rec.ts && p.ts) rec.ts = p.ts;
  }

  const readQueue = [];           // rows in the order they were read (for lite mode hiding)

  function collect(grid, rows) {
    batchNo++;
    const rank = direction * batchNo; // orders batches in time: older batches first
    const gridRect = grid.getBoundingClientRect();
    const list = rows.filter((r) => r.isConnected);
    list.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const batch = [];
    let added = 0;
    list.forEach((row, idx) => {
      const p = parseRow(row, gridRect);
      if (!p) return;
      const prev = rowInfo.get(row);
      if (prev && prev.raw === p.raw) { const r = records.get(prev.key); mergeInto(r, p); batch.push(r || null); return; }
      // The hidden line arrived after the first look: replace the provisional record.
      if (prev && prev.raw.startsWith("row:") && !p.raw.startsWith("row:")) records.delete(prev.key);
      const key = assignSlot(p.raw, row);
      rowInfo.set(row, { key, raw: p.raw });
      readQueue.push(new WeakRef(row));
      if (records.has(key)) { mergeInto(records.get(key), p); batch.push(records.get(key)); return; }
      if (doneKeys.has(key)) { batch.push(null); return; }
      const rec = { ...p, key, rank, idx };
      records.set(key, rec);
      batch.push(rec);
      added++;
    });
    // Rows without their own time take it from neighbours in the same batch (page order).
    let carry = null;
    for (const r of batch) {
      if (!r) continue;
      if (r.ts) carry = r.ts;
      else if (r.type === "separator" && r.date) { r.ts = r.date; carry = r.date; }
      else if (carry && r.rank === rank) r.ts = carry;
    }
    carry = null;
    for (let i = batch.length - 1; i >= 0; i--) {
      const r = batch[i];
      if (!r) continue;
      if (r.ts) carry = r.ts;
      else if (carry && r.rank === rank) r.ts = carry;
    }
    for (const r of batch) {
      if (!r || r.rank !== rank) continue;
      if (r.ts && (!minTs || r.ts < minTs)) minTs = r.ts;
      if (r.ts && (!maxTs || r.ts > maxTs)) maxTs = r.ts;
      if (r.who && r.who !== "You") senders.add(r.who);
    }
    return added;
  }

  // Time used for sorting/periods; rows that never got one borrow from the neighbouring batches.
  const T = (r) => r.ts || r.tsGuess || null;
  function sortRecords(items) {
    if (items.some((r) => !r.ts) && items.some((r) => r.ts)) {
      const byPos = [...items].sort((a, b) => a.rank - b.rank || a.idx - b.idx);
      let c = null;
      for (const r of byPos) { if (r.ts) c = r.ts; else if (c) r.tsGuess = c; }
      c = null;
      for (let i = byPos.length - 1; i >= 0; i--) {
        const r = byPos[i];
        if (r.ts) c = r.ts; else if (!r.tsGuess && c) r.tsGuess = c;
      }
    }
    return items.sort((a, b) => {
      const ta = T(a), tb = T(b);
      return (ta && tb && ta - tb) || a.rank - b.rank || a.idx - b.idx;
    });
  }

  // Fallback sender guess for rows without the hidden line (group chats name only the first of a run).
  function fillSenders(items, title) {
    let lastLeft = null;
    for (const it of items) {
      if (it.type !== "message") continue;
      if (!it.who) it.who = it.sender || (it.side === "right" ? "You" : (lastLeft || title));
      if (it.who !== "You") lastLeft = it.who;
    }
  }

  // ---------- lite mode ----------
  // Hide rows that were already read (except the most recently read ones, which sit at the edge
  // where Messenger loads more), turn off animations and, when pictures aren't needed, stop
  // drawing images. Only changes how the page is drawn in this browser; undone at the end.
  const hiddenRows = [];
  function hideReadRows(keep = 60) {
    const end = readQueue.length - keep;
    for (let i = 0; i < end; i++) {
      const r = readQueue[i].deref();
      if (r && r.isConnected && r.style.display !== "none") {
        r.style.display = "none";
        hiddenRows.push(new WeakRef(r));
      }
    }
    if (end > 0) readQueue.splice(0, end);
  }
  function showRows() {
    for (const ref of hiddenRows.splice(0)) {
      const r = ref.deref();
      if (r) r.style.display = "";
    }
    readQueue.length = 0;
  }
  function liteMode(grid, hideImages) {
    grid.setAttribute("data-mtx-grid", "");
    const st = document.createElement("style");
    st.id = "__mtx_lite";
    st.textContent =
      "*,*::before,*::after{animation:none!important;transition:none!important}" +
      (hideImages ? "[data-mtx-grid] img,[data-mtx-grid] video{visibility:hidden!important}" : "");
    document.head.appendChild(st);
  }
  function endLite() {
    showRows();
    document.getElementById("__mtx_lite")?.remove();
    document.querySelector("[data-mtx-grid]")?.removeAttribute("data-mtx-grid");
  }

  // ---------- periods ----------
  function periodKey(d, split) {
    if (split === "none") return "all";
    if (!d) return "undated";
    return split === "year" ? `${d.getFullYear()}` : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }
  function periodLabel(key, split) {
    if (key === "all") return "";
    if (key === "undated" || split === "year") return key;
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { year: "numeric", month: "long" });
  }
  const periodStart = (d, split) =>
    split === "year" ? new Date(d.getFullYear(), 0, 1) : new Date(d.getFullYear(), d.getMonth(), 1);
  const periodEnd = (d, split) =>
    split === "year" ? new Date(d.getFullYear() + 1, 0, 1) : new Date(d.getFullYear(), d.getMonth() + 1, 1);

  // ---------- text output ----------
  const short = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  function format(title, items, includeSeparators, rangeLabel, periodLabelText) {
    const timed = items.some((i) => i.type === "message" && i.ts);
    const lines = [];
    let count = 0, lastDay = null;
    for (const it of items) {
      if (it.type === "separator") {
        if (!timed && includeSeparators) lines.push("", `--- ${it.text} ---`);
        continue;
      }
      if (timed && it.ts && includeSeparators) {
        const d = it.ts.toDateString();
        if (d !== lastDay) { lines.push("", `--- ${fmtLongDay(it.ts)} ---`); lastDay = d; }
      }
      const head = `${it.ts && timed ? `[${fmtTime(it.ts)}] ` : ""}${it.who}` +
        (it.quote ? ` (replying to "${short(it.quote)}")` : "") + ": ";
      const [first = "", ...rest] = (it.text || "").split("\n");
      lines.push(head + first);
      for (const r of rest) lines.push(" ".repeat(Math.min(head.length, 12)) + r);
      count++;
    }
    const header = [
      `Conversation: ${title}`,
      `Exported: ${new Date().toLocaleString()}`,
      `Source: ${location.href}`,
      ...(periodLabelText ? [`Period: ${periodLabelText}`] : []),
      ...(rangeLabel ? [`Range: ${rangeLabel}`] : []),
      `Messages: ${count}`,
      "=".repeat(60),
    ];
    return { text: header.join("\n") + "\n" + lines.join("\n").replace(/^\n+/, "") + "\n", count };
  }

  // ---------- saving files ----------
  const viaExtension = () => typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;

  function anchorDownload(filename, text) {
    const blob = new Blob(["﻿" + text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename.split("/").pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async function saveText(path, text) {
    if (!viaExtension()) return anchorDownload(path, text);
    const r = await chrome.runtime.sendMessage({ type: "saveText", filename: path, text });
    if (!r || !r.ok) throw new Error((r && r.error) || "Saving the text file failed");
  }

  // Plain, message-safe copy of items for the PDF page.
  function pdfPayload(items) {
    return items.map((it) =>
      it.type === "separator"
        ? { type: "separator", text: it.text }
        : { type: "message", who: it.who, body: it.body, quote: it.quote || "", media: it.media,
            ts: it.ts ? it.ts.getTime() : null,
            time: it.ts ? fmtTime(it.ts) : "", day: it.ts ? fmtLongDay(it.ts) : "",
            images: (it.images || []).map((im) => ({ src: im.src, label: im.label })) }
    );
  }

  const approxSize = (it) =>
    300 + ((it.body || it.text || "").length * 2) + (it.images || []).reduce((a, im) => a + im.src.length, 0);

  // Automatic PDF: the extension renders the items in a background tab and saves it (no print dialog).
  async function savePdfAuto(path, meta, items) {
    const begin = await chrome.runtime.sendMessage({ type: "pdfBegin", meta: { ...meta, filename: path } });
    if (!begin || !begin.id) throw new Error("Could not start PDF");
    let batch = [], size = 0;
    const send = async () => {
      if (!batch.length) return;
      await chrome.runtime.sendMessage({ type: "pdfChunk", id: begin.id, items: batch });
      batch = []; size = 0;
    };
    for (const it of items) {
      const s = approxSize(it);
      if (batch.length && size + s > 16e6) await send();
      batch.push(it); size += s;
    }
    await send();
    const r = await chrome.runtime.sendMessage({ type: "pdfEnd", id: begin.id });
    if (!r || !r.ok) throw new Error((r && r.error) || "PDF failed");
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
    .quote { max-width: 70%; font-size: 8.5pt; color: #666; border-left: 3px solid #ccc; padding: 1px 8px;
             margin: 2px 10px 2px; white-space: pre-wrap; overflow-wrap: anywhere; }
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
    const timed = items.some((i) => i.type === "message" && i.day);
    let prevWho = null, prevTs = 0, lastDay = null;
    for (const it of items) {
      if (it.type === "separator") {
        if (includeSeparators && !timed) b.appendChild(el(doc, "div", "sep", it.text));
        prevWho = null;
        continue;
      }
      if (timed && it.day && it.day !== lastDay) {
        if (includeSeparators) b.appendChild(el(doc, "div", "sep", it.day));
        lastDay = it.day;
        prevWho = null;
      }
      const m = el(doc, "div", "msg" + (it.who === "You" ? " me" : ""));
      // name (and time) when the sender changes or after a 10-minute gap
      if (it.who !== prevWho || (it.ts && it.ts - prevTs > 10 * 60 * 1000)) {
        m.appendChild(el(doc, "div", "who", it.time ? `${it.who} · ${it.time}` : it.who));
      }
      prevWho = it.who;
      prevTs = it.ts || prevTs;
      if (it.quote) m.appendChild(el(doc, "div", "quote", "↪ " + it.quote));
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


  async function finishImages(doc) {
    await waitForImages(doc);
    for (const img of [...doc.images]) {
      if (!img.naturalWidth) img.replaceWith(el(doc, "div", "tag", `[${img.alt} could not be loaded]`));
    }
  }

  // Fallback when the automatic PDF can't run: print dialog inside the page.
  async function savePdfDialog(meta, items) {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:900px;height:700px;opacity:0;pointer-events:none;border:0;z-index:-1";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    buildPdfDoc(doc, meta.title, items, meta.includeSeparators, meta.count, meta.fileBase, meta.rangeLabel);
    await finishImages(doc);
    progress('Choose "Save as PDF" as the printer in the dialog.');
    const oldTitle = document.title;
    document.title = meta.fileBase;
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    document.title = oldTitle;
    setTimeout(() => iframe.remove(), 2000);
  }

  // Shared with report.html (the background PDF page).
  window.__mtxBuildPdfDoc = buildPdfDoc;
  window.__mtxFinishImages = finishImages;
  window.__mtxParseDate = parseSepDate; // handy for troubleshooting from the console

  // ---------- main ----------
  const GENERIC_TITLE = /^(messenger|facebook|chats?|messages?|)$/i;

  window.__messengerTxtExport = async ({
    loadAll = true, maxSteps = 20000, includeSeparators = true, format: fmt = "txt",
    from: fromStr = "", to: toStr = "", split = "none", pictures = true,
    stallSeconds = 90, lighten = true,
  } = {}) => {
    userStop = false;
    try {
      wantPictures = pictures && fmt !== "txt";
      const from = parseInputDate(fromStr), to = parseInputDate(toStr);
      if (from && to && from > to) return { ok: false, error: "The From date is after the To date." };
      const toEnd = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1) : null;
      const rangeLabel = from || to ? `${from ? fmtDay(from) : "start"} – ${to ? fmtDay(to) : "now"}` : "";

      const grid = findGrid();
      if (!grid) {
        const diag = diagnostics();
        progress("Couldn't find an open conversation on this page.\n" + diag, true);
        closeOverlay(15000);
        return { ok: false, error: "No open conversation found. Open a chat first.\n" + diag };
      }
      let title = chatTitle(grid);
      const stamp = new Date().toISOString().slice(0, 10);
      let safe = null, folder = null;

      // Unnamed group chats show up as just "Messenger": name them after the people in them.
      function fixTitle() {
        if (safe) return;
        if (GENERIC_TITLE.test(title.trim())) {
          const names = [...senders];
          title = names.length
            ? "Chat with " + names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4}` : "")
            : "Messenger chat";
        }
        safe = title.replace(/[\\/:*?"<>|~\u0000-\u001f]+/g, "_").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 80) || "chat";
        folder = `Messenger export/${safe}`;
      }

      const savedFiles = [];
      let savedMessages = 0;

      async function savePeriod(key, group) {
        const count = group.filter((i) => i.type === "message").length;
        if (!count) return;
        fixTitle();
        const label = periodLabel(key, split);
        const base = `messenger_${safe}_${key === "all" ? stamp : key}`;
        const shownTitle = label ? `${title} — ${label}` : title;
        if (fmt === "txt" || fmt === "both") {
          const { text } = format(title, group, includeSeparators, rangeLabel, label);
          await saveText(`${folder}/${base}.txt`, text);
          savedFiles.push(base + ".txt");
        }
        if (fmt === "pdf" || fmt === "both") {
          progress(`Saving PDF ${label || ""}… (loading pictures)`);
          await Promise.allSettled(group.flatMap((i) => (i.images || []).map((im) => im.ready)).filter(Boolean));
          const meta = { title: shownTitle, includeSeparators, count, fileBase: base, rangeLabel };
          const payload = pdfPayload(group);
          try {
            if (!viaExtension()) throw new Error("no extension context");
            await savePdfAuto(`${folder}/${base}.pdf`, meta, payload);
            savedFiles.push(base + ".pdf");
          } catch (e) {
            if (split !== "none") throw e;
            await savePdfDialog(meta, payload); // single file: fall back to the print dialog
            savedFiles.push(base + ".pdf (via print dialog)");
          }
        }
        savedMessages += count;
      }

      // Is the loaded range [minTs, maxTs] guaranteed to contain all of this period (within From/To)?
      let startedAtPresent = true;
      function periodComplete(ts) {
        const ps = periodStart(ts, split), pe = periodEnd(ts, split);
        const lo = from && from > ps ? from : ps;
        const hi = toEnd && toEnd < pe ? toEnd : pe;
        return !!(minTs && minTs < lo && (startedAtPresent || (maxTs && maxTs >= hi)));
      }

      // Save every period that is fully loaded (or everything when final), then forget it to free memory.
      async function flush(final) {
        if (!final && split === "none") return;
        if (!final && !minTs) return;
        const items = sortRecords([...records.values()]);
        fillSenders(items, title);
        const ready = final ? items : items.filter((it) => T(it) && periodComplete(T(it)));
        if (!ready.length) return;
        const groups = new Map();
        for (const it of ready) {
          records.delete(it.key);
          doneKeys.add(it.key);
          const t = T(it);
          if (t && ((from && t < from) || (toEnd && t >= toEnd))) continue;
          const k = periodKey(t, split);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(it);
        }
        for (const [k, g] of groups) await savePeriod(k, g);
      }

      rowSel = detectRowSel(grid);
      if (lighten) liteMode(grid, !wantPictures);
      collect(grid, getRows(grid));
      startObserver(grid);
      progress(`Found chat: ${title}\nRead ${records.size} rows…`);

      const scroller = loadAll ? findScroller(grid) : null;
      if (loadAll && !scroller) progress("Couldn't find the scroll area; exporting visible messages only.");

      // Where are we? At the newest message → read backwards (as before). Somewhere in the past
      // (e.g. after clicking a search result) → read back to From (if set), then forward to To.
      if (scroller) startedAtPresent = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
      const phases = !scroller ? [] : startedAtPresent ? [-1] : from ? [-1, 1] : [1];

      const batchTimes = [];
      let totalSteps = 0, stopReason = "", pageRows = 0;
      const memMB = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
      const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

      async function runPhase(dir) {
        direction = dir;
        let lastNewAt = Date.now();
        for (let step = 1; ; step++) {
          if (dir < 0 && from && minTs && minTs < from) return "from";
          if (dir > 0 && toEnd && maxTs && maxTs >= toEnd) return "to";
          if (totalSteps++ >= maxSteps) return "steps";
          if (userStop) return "user";

          // Background tabs are throttled by the browser: pause instead of mistaking it for the end.
          if (document.hidden) {
            progress(`Paused: the Messenger tab is in the background.\nSwitch back to it to continue.\nRead ${records.size + doneKeys.size} rows so far.`);
            while (document.hidden && !userStop) await sleep(1000);
            lastNewAt = Date.now();
            continue;
          }

          const t0 = Date.now();
          if (t0 - lastNewAt > 3000) {
            // Nudge: move away from the edge and back, so Messenger notices it should load more.
            const d = Math.min(800, Math.max(200, scroller.clientHeight));
            scroller.scrollTop = dir < 0 ? d : scroller.scrollHeight - scroller.clientHeight - d;
            scroller.dispatchEvent(new Event("scroll"));
            await sleep(400);
          }
          scroller.scrollTop = dir < 0 ? 0 : scroller.scrollHeight;
          scroller.dispatchEvent(new Event("scroll"));
          const got = await waitForRows(5000);
          const arrived = Date.now();
          if (got) await sleep(150); // let Messenger finish drawing the batch
          const added = pending.size ? collect(grid, takePending()) : 0;
          if (added) {
            lastNewAt = Date.now();
            batchTimes.push((arrived - t0) / 1000);
          } else {
            // Near the newest messages there is simply nothing more to load: don't wait long.
            const limit = dir > 0 && maxTs && Date.now() - maxTs < 864e5 ? Math.min(stallSeconds, 20) : stallSeconds;
            if (!document.hidden && Date.now() - lastNewAt > limit * 1000) return "stalled";
          }

          await flush(false);
          if (lighten) hideReadRows();
          if (step % 10 === 1) pageRows = rowSel ? grid.querySelectorAll(rowSel).length : grid.children.length;
          const idle = Math.round((Date.now() - lastNewAt) / 1000);
          const mem = memMB();
          progress(`${dir < 0 ? "Loading older messages" : "Loading newer messages"}… step ${totalSteps}\n` +
            `Read ${records.size + doneKeys.size} messages` +
            (minTs ? `\nRange loaded: ${fmtDay(minTs)} – ${fmtDay(maxTs)}` : "") +
            (dir < 0 && from ? `\nGoing back to: ${fmtDay(from)}` : "") +
            (dir > 0 && to ? `\nGoing forward to: ${fmtDay(to)}` : "") +
            (batchTimes.length ? `\nMessenger: ${avg(batchTimes.slice(-10)).toFixed(1)} s per batch · ${pageRows} rows on page` +
              (mem ? ` · ${mem} MB` : "") : "") +
            (idle >= 5 ? `\nWaiting for Messenger to load more… ${idle}s` : "") +
            (savedFiles.length ? `\nSaved ${savedFiles.length} file(s), latest: ${savedFiles[savedFiles.length - 1]}` : ""));
        }
      }

      for (let i = 0; i < phases.length; i++) {
        if (i > 0) showRows(); // the rows at the other edge must be visible again to load from there
        stopReason = await runPhase(phases[i]);
        if (stopReason === "user" || stopReason === "steps") break;
      }

      stopObserver();
      await flush(true);
      endLite();
      const reachedFrom = !from || (minTs && minTs < from);
      const reachedTo = !to || startedAtPresent || (maxTs && maxTs >= toEnd);

      const notes = [];
      if ((from || to) && !minTs) notes.push("Couldn't read any dates in this chat, so the date range was ignored.");
      if (!startedAtPresent) notes.push(`Started from where the chat was scrolled to, not from the newest message.`);
      if (from && minTs && !reachedFrom) {
        notes.push(`Didn't reach ${fmtDay(from)}: the oldest message loaded is from ${fmtDay(minTs)}` +
          (startedAtPresent ? "." : " (jump to a message from before that day and run again)."));
      }
      if (to && !reachedTo && stopReason !== "user") notes.push(`Didn't reach ${fmtDay(to)}: Messenger stopped loading newer messages at ${fmtDay(maxTs)}.`);
      if (stopReason === "stalled" && reachedFrom && reachedTo) notes.push(`Stopped when Messenger had nothing more to load (${startedAtPresent ? "start of the chat" : "end of the loaded range"}).`);
      else if (stopReason === "steps") notes.push("Stopped at the scroll step limit.");
      else if (stopReason === "user") notes.push("Stopped by you.");
      if (batchTimes.length >= 20) {
        notes.push(`Messenger speed: ${avg(batchTimes.slice(0, 10)).toFixed(1)} s per batch at the start, ` +
          `${avg(batchTimes.slice(-10)).toFixed(1)} s at the end (${batchTimes.length} batches).`);
      }
      if (!savedFiles.length) notes.push("No messages matched, nothing was saved.");
      const note = notes.join("\n");

      const where = viaExtension() && folder ? `Downloads/${folder}/` : "Downloads";
      const filename = savedFiles.length <= 2 ? savedFiles.join(" and ") : `${savedFiles.length} files`;
      progress(`Done! ${savedMessages} messages → ${filename}\nFolder: ${where}` + (note ? `\n${note}` : ""), true);
      closeOverlay(note ? 15000 : 5000);
      return { ok: true, count: savedMessages, filename: `${filename} in ${where}`, note };
    } catch (e) {
      stopObserver();
      endLite();
      progress("Error: " + e.message, true);
      closeOverlay(10000);
      return { ok: false, error: e.message };
    }
  };
})();
