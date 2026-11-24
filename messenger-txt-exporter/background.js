// Saves files into Downloads/Messenger export/<chat>/ and turns chat pages into PDFs
// without a print dialog (renders report.html in a background tab, then Page.printToPDF).
const jobs = new Map();
let seq = 0;

function download(filename, url) {
  return chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false });
}

function withTimeout(promise, ms, msg) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

async function makePdf(job) {
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`report.html#${job.id}`), active: false });
  try {
    await withTimeout(job.ready, 5 * 60 * 1000, "The PDF page took too long to load");
    const target = { tabId: tab.id };
    await chrome.debugger.attach(target, "1.3");
    try {
      const { data } = await chrome.debugger.sendCommand(target, "Page.printToPDF", {
        printBackground: true,
        preferCSSPageSize: true,
      });
      await download(job.meta.filename, "data:application/pdf;base64," + data);
    } finally {
      await chrome.debugger.detach(target).catch(() => {});
    }
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
    jobs.delete(job.id);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  switch (msg.type) {
    case "saveText":
      download(msg.filename, "data:text/plain;charset=utf-8," + encodeURIComponent("﻿" + msg.text))
        .then(() => reply({ ok: true }), (e) => reply({ ok: false, error: e.message }));
      return true;

    case "pdfBegin": {
      const id = ++seq;
      const job = { id, meta: msg.meta, chunks: [] };
      job.ready = new Promise((r) => (job.markReady = r));
      jobs.set(id, job);
      reply({ id });
      return;
    }
    case "pdfChunk":
      jobs.get(msg.id).chunks.push(msg.items);
      reply({ ok: true });
      return;
    case "pdfEnd":
      makePdf(jobs.get(msg.id)).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: e.message }));
      return true;

    // from report.html
    case "reportMeta": {
      const job = jobs.get(msg.id);
      reply(job ? { meta: job.meta, chunks: job.chunks.length } : { error: "unknown job" });
      return;
    }
    case "reportChunk":
      reply({ items: jobs.get(msg.id).chunks[msg.n] });
      return;
    case "reportReady":
      jobs.get(msg.id)?.markReady();
      reply({ ok: true });
      return;
  }
});
