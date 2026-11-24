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

**Exporting an older period without scrolling through newer messages:** in the chat, use
Messenger's search, click a message from just before your From date (Messenger jumps there and
loads only the messages around it), then click Export. When the chat isn't at the newest message,
the add-on reads from where it is: back to From (if set), then forward to To (or to the newest
message). Reload the page between big runs: that's the only way to make Messenger forget what it
has loaded, and a fresh page is fast again.

**Why it slows down:** Messenger loads history in small batches, one after another, and keeps every
loaded message in the page. The add-on now only looks at the rows Messenger just added, so its own
work per batch stays constant; the progress box shows Messenger's time per batch, the number of rows
on the page and memory use, so you can see the slowdown happening on Messenger's side.

**Long chats / when does it stop?** It keeps scrolling until one of these happens:
you reach the From date, Messenger loads nothing new for **Give up after N s** (default 90 s;
raise it if your chat stops early), you click **Stop & save what I have** on the progress box,
or the step limit is hit. The final message says which one it was. When Messenger seems stuck,
the add-on scrolls down a bit and back up to wake it.

**Keep the Messenger tab visible.** Edge slows background tabs to a crawl, so the export pauses
while the tab is hidden and continues when you come back. Using another *window* is fine.

**Lite mode while scrolling** (on by default) hides messages the add-on has already read, turns
off animations and, when pictures aren't needed, stops drawing images, so the page stays lighter.
Everything is restored when the export ends. It only changes how the page is drawn in your browser.

**Max scroll steps** is a safety limit (each step loads one batch of older messages); raise it for very long chats.

## Output example

```
Conversation: Chat with Alice, Bob
Exported: 11/24/2026, 10:52:56 AM
Period: August 2026
Messages: 291
============================================================
--- Saturday, August 1, 2026 ---
[07:29] You: hey!
[07:31] Alice: hi, how are you?
[07:36] Bob (replying to "hi, how are you?"): good, see this
[07:37] Bob: [photo]
```

Sender and exact time come from the hidden accessibility line Messenger attaches to every
message ("Message sent … by …"), so they are correct even in group chats, and messages are
sorted by time. Unnamed group chats are titled after their members.

## Limitations

- Messenger itself keeps every loaded message on the page, so very long runs still make the
  tab heavy. Splitting keeps the add-on's own memory low and saves progress, but for a chat
  going back many years consider running it in stages with From/To dates.
- Messenger's page layout is undocumented and changes often; if an update breaks
  detection, the selectors in `content.js` (`findGrid`, `parseRow`) are the place to adjust.
- In the TXT file, photos, videos, voice messages and files appear as `[photo]`, `[video]`, etc.
  In the PDF, photos (and video preview frames) are shown as pictures; voice messages and files are noted as text.
- PDF pictures are the sizes Messenger shows in the chat, not full-resolution originals.
- Encrypted chats you haven't unlocked on this device won't show older history.
