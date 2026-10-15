# Daily Tracking

A phone-first web app for planning your day and tracking trades. Install it on your phone's home screen.

- **Plan**: write tonight what you'll do tomorrow, then tick each activity off. Anything left unticked turns red as *Missed*, and you can move it to today.
- **Trades**: log trades on your own list of pairs (starts with NAS100, XAUUSD and EURUSD; add, rename or hide pairs, each with its $ per point for 1.00 lot). Points/pips, RR, session (Asia / London / London-NY overlap / New York, in Cambodia time) and Win/Loss are calculated for you. Includes a daily loss limit warning.
- **Money**: each week (Sunday to Saturday) enter the money you have to spend, then log what you spend in riel (៛) or dollars, with a category (add, rename or delete your own) and Cash, Bank or Card. See how much is left in your wallet, today's spending against the daily limit (the week's money ÷ 5), where your money went, and a history of past weeks. Totals are in dollars at 4,100៛ = $1, or pick **NZ$** in Settings to track money in New Zealand dollars.
- **Calendar**: each day colored green or red by PnL, plus how many activities you finished. Switch to **Money** to see how much you spent each day.
- **Stats**: win rate, average RR, profit factor, and breakdowns by pair, session and side.

## Where the data lives

This repo only holds the app code. Your tasks, trades, spending and screenshots are saved:

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
| `js/pairs.js` | Your trading pairs: points or pips, $ per point, colors |
| `js/money.js` | Spending: riel/dollar conversion, categories and totals |
| `js/app.js` | Screens and buttons |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen install and offline support |
