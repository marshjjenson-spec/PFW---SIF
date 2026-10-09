# PFW-SIF Site

The public website for the Purdue Fort Wayne Student Investment Fund, with live data. It has three tabs:

- **Performance** (`/performance`): returns, risk statistics, drawdowns and calendar history against the S&P 500 Total Return.
- **Holdings** (`/holdings`): every position, sector allocation, trade notes with research links, dividends, policy limits and closed positions.
- **Research** (`/research`): the report library, a featured report, the track record of every pitch against the S&P 500, coverage by sector, the pitch pipeline and the research process.

## How it works

```
Trade ledger (Supabase: trades)  +  Tiingo end-of-day prices
                │
   update-data edge function (runs every weekday at 9:30 pm ET)
                │
   daily_values → monthly_returns (Modified Dietz)  +  SPY total return
                └→ holdings snapshot (positions, lots, dividends, closed positions, trade notes)
                └→ research snapshot (reports, return since each pitch vs SPY, track record, pipeline)
                │
   Public, read-only: fund_profile, monthly_returns, public_snapshots
                │
   site/index.html (Home) + performance.html + holdings.html + research.html on Vercel → visitors
```

- **Nobody can change data from the website.** The pages only read three public tables. Trades, prices, company details, secrets and job logs are private.
- **What is entered by hand:** the trade ledger (with optional notes and report links), one row per company in `securities`, and research reports and pipeline ideas. Everything else is calculated.
- Returns, risk statistics, drawdowns and rolling figures are calculated in the browser from the published monthly series, using the formulas listed in the page's Methodology section.

## Folder layout

| Path | What it is |
|---|---|
| `site/index.html` | The interactive home page (`/`): live fund numbers, holdings ticker, growth-of-$10,000 chart, what-if calculator, portfolio donut, research highlights |
| `site/performance.html` | The Performance page (`/performance`) |
| `site/holdings.html` | The Holdings page (`/holdings`) |
| `site/research.html` | The Research page (`/research`) |
| `site/config.js` | Database address, read-only key, nav links, Apply link |
| `site/favicon.svg` | Browser tab icon |
| `vercel.json` | Hosting settings and security headers |
| `supabase/migrations/` | Database tables, permissions, and the nightly schedule (already applied) |
| `supabase/functions/update-data/` | The nightly data job (already deployed) |
| `tests/` | Calculation tests (`core.test.ts`, `holdings.test.ts`, `research.test.ts`) and page tests |

## Supabase project

- Project: `xiexkzzmntcojnsorbyd` (us-west-2)
- Free-tier projects pause after a week with no activity. The nightly job keeps this one active.

## Recording trades

Add rows to the `trades` table (Supabase → Table Editor → trades), or ask Claude to do it.

| type | Fill in | Example |
|---|---|---|
| `DEPOSIT` | `trade_date`, `amount` | Starting capital: 2026-01-02, 100000 |
| `BUY` | `trade_date`, `ticker`, `shares`, `price`, optional `fees` | 2026-01-02, MSFT, 20, 425.10 |
| `SELL` | `trade_date`, `ticker`, `shares`, `price`, optional `fees` | 2026-03-14, MSFT, 5, 451.00 |
| `WITHDRAWAL` | `trade_date`, `amount` | Cash taken out of the fund |
| `FEE` | `trade_date`, `amount` | Fees not tied to a trade |

Do not enter dividends or splits; they are pulled from Tiingo automatically.

### Trade notes (shown when a visitor opens a transaction on the Holdings tab)

Optional columns on any `BUY` or `SELL` row:

| column | What it is |
|---|---|
| `note` | One-line summary shown in the table, e.g. "Exited position: thesis broken". Left empty, the page says "Initiated / Added to / Trimmed / Exited position". |
| `rationale` | The full "Why we bought / Why we sold" note |
| `team` | Who recommended it, e.g. "Information Technology team" |
| `approved_date` | Investment committee approval date |
| `report_title` | e.g. "Equity research: Apple initiation" |
| `report_url` | Link to the research report (must start with https://) |

### Company details (`securities` table)

One row per ticker the fund has ever owned: `ticker`, `name`, `sector` (GICS), `industry`, `thesis` (one or two sentences), `thesis_url`. A ticker without a row still shows, labeled "Unclassified", and the nightly job reports a warning naming it.

### S&P 500 sector weights (`benchmark_sectors` table)

One row per sector: `sector`, `weight` (decimal), `as_of`, `source`. Until this is filled, the Holdings tab shows "S&P 500 sector weights not yet published" and the sector policy check reads N/A. Use one dated source, for example the S&P 500 factsheet from S&P Dow Jones Indices.

To refresh right away instead of waiting for the nightly run, run this in the Supabase SQL Editor:

```sql
select public.run_data_job();
-- then check the result:
select status, message from public.job_runs order by id desc limit 1;
```

## Research reports (`research_reports` table)

One row per report. Required: `title`, `report_type` (`Initiation`, `Update`, `Exit memo`, `Sector review` or `Macro outlook`) and `published_date`.

| column | What it is |
|---|---|
| `ticker`, `company`, `sector` | Leave `ticker` empty for sector reviews and macro pieces |
| `team`, `authors` | Who wrote it (authors are optional) |
| `summary` | Two or three sentences shown in the library |
| `recommendation` | `Buy`, `Hold` or `Sell` |
| `decision`, `decision_date` | `Approved`, `Not approved` or `Pending`; leave empty if it was not pitched |
| `price_at_pitch` | Optional; left empty, the close on the publication date is used |
| `target_price` | Optional price target |
| `report_url` | Link to the PDF or document (must start with https://) |
| `featured` | `true` to pin it at the top of the page; otherwise the newest report is shown |

Each report with a ticker gets its total return since publication, next to the S&P 500 Total Return over the same dates. The track record averages Buy-rated pitches with an Approved or Not approved decision, so the page shows how the ideas the fund bought did against the ones it passed on.

## Research report pages (`/reports`)

Each research report has its own page on the site, for example `/reports/amd-2024-initiation`, and `/reports/` lists them all. Each page has a one-page summary (rating, price target, key financials, peer comparison, performance chart, catalysts, risks, DCF and committee decision) and a second page with the full case for buying or holding, the price target build and performance since the report.

- Wording: `tools/reports-content.mjs`.
- Numbers: `tools/report-data.json`, made by `node tools/fetch-report-data.mjs <cache-folder>` from SEC EDGAR filings (only filings made on or before each report date) and Yahoo Finance prices.
- Rebuild the pages after editing either file: `node tools/build-reports.mjs`.
- The Research and Holdings tabs link to these pages (`report_url` and `thesis_url` hold paths like `/reports/aapl-2026-review`). `research-reports/` keeps Markdown copies of the same research.

## Other pages

| Page | What it shows | Where its content comes from |
|---|---|---|
| `/quarterly` | A review of every quarter: return vs the S&P 500 TR, contribution by position, quarter-end holdings, research published | Built live from `monthly_returns` and the `monthly_positions` and `research` snapshots |
| `/process` | Investment philosophy, the seven-step process, the investment policy and a live check of each policy limit | Text in `site/process.html`; limits from `fund_profile.policy` |
| `/team` | Officer roles, the 11 sector teams (with live report counts and holdings) and committee rules | Names in `site/data/team.json` (empty name = "Open") |
| `/about` | Mission, how the fund works, live fund facts and a timeline from the trade ledger | `fund_profile` and the `holdings` snapshot |
| `/join` | Membership, expectations and the application steps | Set `applyUrl` or `contactEmail` in `site/config.js` to show an Apply button |
| `/faq`, `/disclosures` | Common questions; simulated-performance, methodology, no-advice and privacy disclosures | Text in the page files |
| `/404` | Shown for any address that does not exist | |

Shared header, mobile menu and footer for these pages: `site/assets/site.css` and `site/assets/site.js`. The Holdings and Research pages also load `site/assets/mobile-nav.js` for a Menu button on phones.

**Month hover on the Performance page.** Hovering a month in the monthly returns table shows each position's month-end value and its gain or loss for that month. The nightly job publishes this as the `monthly_positions` snapshot (`monthEndPositions` in `core.ts`).

## Pitch pipeline (`research_pipeline` table)

`ticker`, `company`, `team`, `stage` (`Researching`, `Pitch scheduled` or `Committee vote`), `pitch_date`, `idea`. Delete the row once the company is pitched and add a research report instead.

## Settings

All settings are in the `fund_profile` row:

- `performance_type`: `simulated` (paper portfolio) or `live` / `actual` once real money is managed. This changes the page's disclosure label.
- `risk_free_rate`: annual, as a decimal (0.04 = 4%). `risk_free_source`: where the rate came from, shown on the page.
- `benchmark_ticker`: `SPY` by default.
- `policy`: investment policy limits checked on the Holdings tab, as decimals: `max_position` (largest single position), `max_sector_active` (sector distance from the S&P 500 weight), `cash_min`, `cash_max`, `min_positions`. Remove a key to stop checking that rule.

The Tiingo API key is stored in `app_secrets` under `tiingo_api_key`.

## Deploying to Vercel

1. Create a free GitHub account and a new repository (for example `pfw-sif-site`).
2. Upload everything in this folder to the repository (on github.com: **Add file → Upload files**, then drag in the folder contents).
3. Create a free account at vercel.com and sign in with GitHub.
4. Click **Add New → Project**, choose the repository, and click **Deploy**. No build settings are needed; `vercel.json` points Vercel at the `site` folder.
5. The site goes live at `your-project.vercel.app`.

## Custom domain

1. In Vercel, open the project → **Settings → Domains**.
2. Buy a domain there (about $10–15 a year), or enter one you already own.
3. If the domain was bought elsewhere, add the DNS records Vercel shows at your registrar. HTTPS is set up automatically.

## Tabs and other pages

The tabs across the top come from `nav` in `site/config.js`. The current page is highlighted automatically. To add a page, put its file in `site/` (for example `site/about.html`, served at `/about`) and add `{ label: "About", href: "/about" }`. Set `applyUrl` to show the Apply button.

## Tests

```bash
node --experimental-strip-types --test tests/*.test.ts   # performance + holdings engines
```
