# Messenger Chat Export (Microsoft Edge extension)

Exports the Facebook Messenger conversation you have open to a plain `.txt` file
and/or a readable PDF (chat bubbles, names, dates and pictures).
Works on `messenger.com` and `facebook.com/messages`. Everything runs locally in
your browser; nothing is sent anywhere.

## Install (Edge)

1. Download this `messenger-txt-exporter` folder (or unzip `messenger-txt-exporter.zip`).
2. Open `edge://extensions`.
3. Turn on **Developer mode** (bottom-left toggle).
4. Click **Load unpacked** and select the `messenger-txt-exporter` folder.
5. Pin the extension from the puzzle-piece menu for easy access.

(Also works in Chrome via `chrome://extensions`.)

## Use

1. Open a conversation on messenger.com or facebook.com/messages.
2. Click the extension icon, pick **TXT**, **PDF** or **Both**, then **Export open chat**.
3. With "Scroll up to load older messages" on, it scrolls the chat to the top
   to load history (progress shows in the top-right of the page), then saves
   `messenger_<Name>_<date>.txt` to your Downloads folder.

**Where files go:** `Downloads/Messenger export/<chat name>/`.

**PDF:** made automatically, no print dialog. While a PDF is being made, Edge briefly opens a
background tab and shows a bar saying the extension "started debugging this browser"; that's
how it saves the PDF and it closes by itself. Pictures are embedded and text stays selectable.
Untick **Include pictures in PDF** for smaller files and lower memory use.

**Split into a file per year / month:** recommended for long chats. While scrolling back,
each year/month is saved as soon as it has fully loaded (e.g. `messenger_Alice_2025-03.txt`),
and then dropped from the add-on's memory. If the tab crashes or you stop it, the finished
periods are already saved.

**Date range (optional):** set **From** and/or **To**. With a From date the add-on
stops scrolling as soon as it passes that day, so you don't need to guess how far back to go.
Dates come from the dividers Messenger shows between message groups ("Today", "Mon 10:15",
"Nov 3, 2025", "lapkričio 3 d." …), in English or Lithuanian. Each message gets the date of the
divider above it. If no dates can be read, the whole loaded chat is exported and the popup says so.

**Long chats / when does it stop?** It keeps scrolling until one of these happens:
you reach the From date, Messenger loads nothing new for **Give up after N s** (default 90 s;
raise it if your chat stops early), you click **Stop & save what I have** on the progress box,
or the step limit is hit. The final message says which one it was. When Messenger seems stuck,
the add-on scrolls down a bit and back up to wake it.

**Keep the Messenger tab visible.** Edge slows background tabs to a crawl, so the export pauses
while the tab is hidden and continues when you come back. Using another *window* is fine.

**Hide already-read messages while scrolling** (on by default) hides messages the add-on has
already read, so the page stays lighter; they are shown again when the export ends.

**Max scroll steps** is a safety limit (each step loads one batch of older messages); raise it for very long chats.

## Output example

```
Conversation: Alice Smith
Exported: 11/23/2026, 10:25:10 AM
Messages: 54
============================================================
--- Mon 10:15 AM ---
Alice Smith: hey!
You: hi, how are you?
Alice Smith: good, see this
             [photo]
```

## Limitations

- Messenger itself keeps every loaded message on the page, so very long runs still make the
  tab heavy. Splitting keeps the add-on's own memory low and saves progress, but for a chat
  going back many years consider running it in stages with From/To dates.
- Messenger's page layout is undocumented and changes often; if an update breaks
  detection, the selectors in `content.js` (`findGrid`, `parseRow`) are the place to adjust.
- Only the timestamp separators Messenger shows in the chat are captured; per-message
  times appear only on hover, so they aren't included.
- In the TXT file, photos, videos, voice messages and files appear as `[photo]`, `[video]`, etc.
  In the PDF, photos (and video preview frames) are shown as pictures; voice messages and files are noted as text.
- PDF pictures are the sizes Messenger shows in the chat, not full-resolution originals.
- Encrypted chats you haven't unlocked on this device won't show older history.
