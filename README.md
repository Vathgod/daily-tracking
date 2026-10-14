# Daily Tracking

A phone-first web app for planning your day and tracking trades. Install it on your phone's home screen.

- **Plan**: write tonight what you'll do tomorrow, then tick each activity off. Anything left unticked turns red as *Missed*, and you can move it to today.
- **Trades**: log NAS100, XAUUSD and EURUSD trades. Points/pips, RR, session (Asia / London / London-NY overlap / New York, in Cambodia time) and Win/Loss are calculated for you. Includes a daily loss limit warning.
- **Calendar**: each day colored green or red by PnL, plus how many activities you finished.
- **Stats**: win rate, average RR, profit factor, and breakdowns by pair, session and side.

## Where the data lives

This repo only holds the app code. Your tasks, trades and screenshots are saved:

1. on your phone, so the app works offline, and
2. in your **private** repo `daily-tracking-data` (as `data.json` plus `shots/`), once you add a token in Settings.

## Connect GitHub sync

1. Create a fine-grained token at <https://github.com/settings/personal-access-tokens/new>
   - Repository access: **Only select repositories** → `daily-tracking-data`
   - Permissions → Repository → **Contents: Read and write**
2. In the app, open **Settings** (⚙️), paste the token and tap **Connect & sync**.
3. Do the same on every device you use.

Never share the token. If you lose a device, delete the token on GitHub and make a new one.

## Run it locally

No build step. Serve the folder with any static server, e.g.:

```
npx serve .
```

Then open the URL it prints. Opening `index.html` directly also works, but install/offline mode needs a server.

## Files

| Path | What it is |
|---|---|
| `index.html` | Page layout and dialogs |
| `css/app.css` | Styles (dark and light themes) |
| `js/util.js` | Dates, sessions, points/pips and RR math |
| `js/store.js` | Saving on the device and GitHub sync |
| `js/app.js` | Screens and buttons |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen install and offline support |
