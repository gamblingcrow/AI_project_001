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
  const progress = (msg) => { overlay().textContent = "Messenger → TXT\n" + msg; };
  const closeOverlay = (delay = 4000) =>
    setTimeout(() => document.getElementById("__mtx_overlay")?.remove(), delay);

  // ---------- locating the conversation ----------
  function findGrid() {
    const labelled = document.querySelector(
      '[role="grid"][aria-label*="essage" i], [role="log"], [aria-label^="Messages in conversation" i]'
    );
    if (labelled && labelled.querySelector('[role="row"]')) return labelled;
    // Fallback: the container with the most rows inside the main area.
    const scope = document.querySelector('[role="main"]') || document.body;
    let best = null, bestCount = 0;
    for (const g of scope.querySelectorAll('[role="grid"], [role="list"], [role="log"]')) {
      const n = g.querySelectorAll('[role="row"], [role="listitem"]').length;
      if (n > bestCount) { best = g; bestCount = n; }
    }
    return best;
  }

  function getRows(grid) {
    let rows = [...grid.querySelectorAll('[role="row"]')];
    if (!rows.length) rows = [...grid.querySelectorAll('[role="listitem"]')];
    // keep outermost rows only
    return rows.filter((r) => !rows.some((o) => o !== r && o.contains(r)));
  }

  function isScrollable(el) {
    const s = getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 5;
  }

  function findScroller(grid) {
    for (let el = grid; el && el !== document.body; el = el.parentElement) {
      if (isScrollable(el)) return el;
    }
    // Scroller may be inside the grid.
    for (const el of grid.querySelectorAll("div")) if (isScrollable(el)) return el;
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

  function mediaTags(row) {
    const tags = [];
    for (const img of row.querySelectorAll("img")) {
      const r = img.getBoundingClientRect();
      if (Math.max(r.width, r.height) >= 60) tags.push("[photo]");
    }
    if (row.querySelector("video")) tags.push("[video]");
    if (row.querySelector("audio, [aria-label*='audio' i], [aria-label*='voice' i]")) tags.push("[voice message]");
    if (!tags.length && row.querySelector("a[download], [aria-label*='file' i]")) tags.push("[file]");
    return [...new Set(tags)];
  }

  function parseRow(row, gridRect) {
    const headingText = [...row.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .map((h) => h.textContent.trim())
      .filter(Boolean);
    const texts = leafTexts(row);
    const media = mediaTags(row);

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
      if (t && t.length < 120 && !NOISE.test(t)) return { type: "separator", text: t };
      return null;
    }

    // A short name label shown above group-chat bubbles.
    if (!sender && texts.length > 1 && side === "left" && texts[0].length < 40 && !/\s{2}/.test(texts[0])) {
      const label = row.querySelector('span:not([dir="auto"])');
      if (label && label.textContent.trim() === texts[0]) sender = texts.shift();
    }

    return { type: "message", sender, side, text: [...texts, ...media].join("\n") };
  }

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
  function format(title, entries, includeSeparators) {
    const lines = [];
    let lastLeft = null, count = 0;
    for (const { data } of entries) {
      if (!data) continue;
      if (data.type === "separator") {
        if (includeSeparators) lines.push("", `--- ${data.text} ---`);
        continue;
      }
      let who = data.sender;
      if (!who) who = data.side === "right" ? "You" : (lastLeft || title);
      if (who !== "You") lastLeft = who;
      const [first, ...rest] = data.text.split("\n");
      lines.push(`${who}: ${first}`);
      for (const r of rest) lines.push(`${" ".repeat(who.length + 2)}${r}`);
      count++;
    }
    const header = [
      `Conversation: ${title}`,
      `Exported: ${new Date().toLocaleString()}`,
      `Source: ${location.href}`,
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

  // ---------- main ----------
  window.__messengerTxtExport = async ({ loadAll = true, maxSteps = 300, includeSeparators = true } = {}) => {
    try {
      const grid = findGrid();
      if (!grid) {
        progress("Couldn't find an open conversation on this page.");
        closeOverlay();
        return { ok: false, error: "No open conversation found. Open a chat first." };
      }
      const title = chatTitle(grid);
      let acc = merge([], snapshot(grid));
      progress(`Found chat: ${title}\nCollected ${acc.length} rows…`);

      const scroller = loadAll ? findScroller(grid) : null;
      if (loadAll && !scroller) progress("Couldn't find the scroll area; exporting visible messages only.");

      if (scroller) {
        let stale = 0;
        for (let step = 1; step <= maxSteps && stale < 4; step++) {
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
          progress(`Loading history… step ${step}/${maxSteps}\nCollected ${acc.length} rows`);
        }
      }

      const { text, count } = format(title, acc, includeSeparators);
      const safe = title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "chat";
      const filename = `messenger_${safe}_${new Date().toISOString().slice(0, 10)}.txt`;
      download(filename, text);
      progress(`Done! Saved ${count} messages to ${filename}`);
      closeOverlay();
      return { ok: true, count, filename };
    } catch (e) {
      progress("Error: " + e.message);
      closeOverlay(8000);
      return { ok: false, error: e.message };
    }
  };
})();
