const $ = (id) => document.getElementById(id);
const status = (msg) => { $("status").textContent = msg; };

$("export").addEventListener("click", async () => {
  const btn = $("export");
  btn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/(www\.messenger\.com|(www|web)\.facebook\.com)\//.test(tab.url || "")) {
      status("Open a Messenger conversation (messenger.com or facebook.com/messages) in this tab first.");
      return;
    }
    const options = {
      loadAll: $("loadAll").checked,
      maxSteps: Math.max(1, parseInt($("maxSteps").value, 10) || 20000),
      includeSeparators: $("includeSeparators").checked,
      split: $("split").value,
      stallSeconds: Math.max(10, parseInt($("stall").value, 10) || 90),
      lighten: $("lighten").checked,
      pictures: $("pictures").checked,
      from: $("from").value,
      to: $("to").value,
      format: document.querySelector('input[name="fmt"]:checked').value,
    };
    status("Working… (see progress on the page)");

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (opts) => window.__messengerTxtExport(opts),
      args: [options],
    });

    if (!result || !result.ok) status("Failed: " + (result && result.error ? result.error : "unknown error"));
    else status(`Saved ${result.count} messages: ${result.filename}` + (result.note ? `\n${result.note}` : ""));
  } catch (e) {
    status("Error: " + e.message);
  } finally {
    btn.disabled = false;
  }
});
