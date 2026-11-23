# Messenger Chat to TXT (Microsoft Edge extension)

Exports the Facebook Messenger conversation you have open to a plain `.txt` file.
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
2. Click the extension icon, then **Export open chat**.
3. With "Scroll up to load older messages" on, it scrolls the chat to the top
   to load history (progress shows in the top-right of the page), then saves
   `messenger_<Name>_<date>.txt` to your Downloads folder.

For very long chats, raise **Max scroll steps** (each step loads one batch of older messages).

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

- Messenger's page layout is undocumented and changes often; if an update breaks
  detection, the selectors in `content.js` (`findGrid`, `parseRow`) are the place to adjust.
- Only the timestamp separators Messenger shows in the chat are captured; per-message
  times appear only on hover, so they aren't included.
- Photos, videos, voice messages and files appear as `[photo]`, `[video]`, etc.
- Encrypted chats you haven't unlocked on this device won't show older history.
