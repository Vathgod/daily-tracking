# Daily Tracking

A phone-first web app for planning your day and tracking trades. Install it on your phone's home screen.

- **Plan**: write tonight what you'll do tomorrow, then tick each activity off. Anything left unticked turns red as *Missed*, and you can move it to today.
- **Trades**: log trades on your own list of pairs (starts with NAS100, XAUUSD and EURUSD; add, rename or hide pairs, each with its $ per point for 1.00 lot). Points/pips, RR, session (Asia / London / London-NY overlap / New York, in Cambodia time) and Win/Loss are calculated for you. Includes a daily loss limit warning. Tag each trade with a **setup** (Breakout, Pullback…) and any **mistakes** (FOMO, Moved SL…); tap ✏️ Edit to add, rename, hide or delete tags. Under the trades, write a **day recap**: what happened in the trading day as a whole ("no displacement", "didn't check the news"), with day tags (tap 🏷 Tags to pick, add, rename or delete them) and a 1–5 ⭐ rating of how well you followed your rules. Tap **Save** to keep it and **✏️ Edit** to change it later; past days' recaps show in the trade list and on the Calendar (📝); tap the 📝 next to a day's PnL in the trade list to write one for a past day.
- **Money**: each week (Sunday to Saturday) enter the money you have to spend, then log what you spend in riel (៛) or dollars, with a category (add, rename or delete your own) and Cash, Bank or Card. See how much is left in your wallet, today's spending against the daily limit (the week's money ÷ 5), where your money went, and a history of past weeks. Use the ‹ › arrows on the wallet to go back and set the money for any past week; on Sunday and Monday a recap shows what you spent last week. For a trip or event, switch to **🎒 Budget** at the top and make a budget: money for any dates (say $100 for 3 days), kept apart from the week's money and the daily limit. **👛 Week money** shows only week-money spending, and the Calendar's Money view has the same switch. Expenses on those days are paid from the budget unless you pick Week's money, and its card shows what's left and today's share (what's left ÷ days left). Totals are in dollars at 4,100៛ = $1, or pick **NZ$** in Settings to track money in New Zealand dollars.
- **Calendar**: each day colored green or red by PnL, plus how many activities you finished. Switch to **Money** to see how much you spent each day, or **News** for this week's economic calendar (from Forex Factory, in Cambodia time): red and orange days for high and medium impact news, a countdown to the next red news, and each day's events with forecast and previous. Filter to high impact only, or to the currencies of your pairs (NAS100 and XAUUSD count as USD).
- **Stats**: a balance curve for the account you pick (with the fail line and profit target for funded accounts, or total PnL for all accounts); drag across it to see each trade. Win rate, average RR, profit factor, and breakdowns by pair, setup, session and side, plus a **Mistakes** table that compares clean trades with each mistake. The **Money** section compares your last 8 weeks: spent per week against the week's money, this week against last week, best and worst weeks, categories against a usual week, spending by day of the week, and Cash / Bank / Card.

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
| `js/news.js` | Calendar → News: loads and filters the economic calendar |
| `.github/workflows/news.yml` | Saves this week's news to `news.json` on the `news` branch every hour (Actions tab → News → Run workflow to fetch it now) |
| `js/app.js` | Screens and buttons |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen install and offline support |
