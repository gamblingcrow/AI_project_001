// Background page that lays out one chat period for PDF printing.
(async () => {
  const id = Number(location.hash.slice(1));
  const { meta, chunks, error } = await chrome.runtime.sendMessage({ type: "reportMeta", id });
  if (error) { document.body.textContent = error; return; }
  const items = [];
  for (let n = 0; n < chunks; n++) {
    const r = await chrome.runtime.sendMessage({ type: "reportChunk", id, n });
    for (const it of r.items) items.push(it);
  }
  window.__mtxBuildPdfDoc(document, meta.title, items, meta.includeSeparators, meta.count, meta.fileBase, meta.rangeLabel);
  await window.__mtxFinishImages(document);
  await chrome.runtime.sendMessage({ type: "reportReady", id });
})();
