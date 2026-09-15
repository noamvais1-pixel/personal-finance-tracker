# Personal Finance Tracker (Israel) — מעקב כספים

A small, local-first personal finance dashboard. It logs into Bank Hapoalim and Max the way you would,
pulls every transaction (including the itemized purchases behind the bank's daily "Direct" card totals),
sorts them into Hebrew categories, and shows a dashboard in your browser. Nothing leaves your computer
except the login to the bank and card sites themselves.

Built in a couple of evenings with Claude Code, as an alternative to paying a monthly fee to a
finance-aggregation service.

## What it does

- **Automatic sync** with Bank Hapoalim (account + Direct debit card) and Max, once a day, via
  [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers).
- **Passwords in the macOS Keychain**, never in a file. A one-time "approve this computer" step handles the
  bank's SMS code for new devices.
- **Categories** from Hebrew keyword rules for Israeli merchants, your own overrides ("apply to every
  transaction from this store"), and optional Gemini (free tier) for stores the rules don't know.
- **No double counting**: the monthly card bill and the bank's daily Direct totals are hidden once the
  itemized purchases are in.
- **Dashboard** (Hebrew, RTL): monthly overview, spending by category, six-month trend, top merchants,
  transactions with search and totals, recurring payments and installment plans, CSV export.
- **Runs locally** on a Mac: Node.js + SQLite + Express, plus a small native window app.

## Setup

```bash
npm install
npm start          # dashboard at http://localhost:3124
```

Then open *Settings* in the dashboard and enter your bank and card logins. See `קרא-אותי.md` for the
full Hebrew guide, and `app/build-app.sh` to build the Desktop window app.

## Notes

- Requires Node 22+ and Google Chrome installed (used headlessly for the bank sites).
- Bank websites change; if a sync fails, update the scraper library: `npm update israeli-bank-scrapers`.
- Everything is stored in `data/` (git-ignored).
