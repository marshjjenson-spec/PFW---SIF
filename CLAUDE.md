# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack
- Static site: plain HTML/CSS/vanilla JS in `site/`, no framework, no bundler, no package.json. Hosted on Vercel (`vercel.json`: `outputDirectory: site`, `cleanUrls`).
- Data: Supabase Postgres (project `xiexkzzmntcojnsorbyd`) + Deno edge function `update-data` (`npm:@supabase/supabase-js@2`), run nightly by pg_cron; prices from Tiingo.
- Tests: Node 22 built-in runner with `--experimental-strip-types` (TS run directly, no tsc). Page checks: Python + Playwright.

## Commands
- All unit tests: `node --experimental-strip-types --test tests/*.test.ts` (baseline 36 pass)
- One file: `node --experimental-strip-types --test tests/core.test.ts`
- One test: add `--test-name-pattern "buy and hold"`
- Local site with fake Supabase: `python3 tests/mock_server.py` (port 8765, serves `site/`, fixtures from `/tmp/<name>.json`)
- Make fixture: `node --experimental-strip-types tests/make_fixture.ts <months> /tmp/fx9.json`
- Page checks (server running, needs `pip install playwright`): `python3 tests/page_check.py` / `holdings_check.py` / `research_check.py`
- Rebuild report pages: `node tools/build-reports.mjs`; refresh their numbers: `node tools/fetch-report-data.mjs <cache-folder>`
- Run data job now (Supabase SQL): `select public.run_data_job();` then `select status, message from public.job_runs order by id desc limit 1;`

## Folder map
- `site/` – one self-contained HTML file per page (`index`=Home `/`, `performance`, `holdings`, `research`, `quarterly`, …)
- `site/config.js` – public Supabase URL + publishable key, nav tabs, applyUrl
- `site/assets/` – shared header/footer/mobile menu (`site.css`, `site.js`, `mobile-nav.js`)
- `site/reports/` – GENERATED report pages; `site/data/team.json` – officer names
- `supabase/functions/update-data/` – `core.ts` (valuation, Modified Dietz monthly returns), `holdings.ts`, `research.ts`, `index.ts` (job entry)
- `supabase/migrations/` – schema, RLS, cron (already applied to prod)
- `tools/` – report generator: `reports-content.mjs` (wording), `report-data.json` (numbers)
- `tests/` – `*.test.ts` engine tests; `*_check.py` + `mock_server.py` browser checks
- `research-reports/` – Markdown copies of the research

## Conventions
- Pages read only three public tables: `fund_profile`, `monthly_returns`, `public_snapshots` (ids `holdings`, `research`, `monthly_positions`). Everything else (trades, prices, secrets, job logs) is private; never expose it.
- Ledger types: DEPOSIT, BUY, SELL, WITHDRAWAL, FEE. Dividends/splits come from Tiingo, never entered by hand.
- Settings live in the single `fund_profile` row (`performance_type`, `risk_free_rate`, `risk_free_source`, `benchmark_ticker`, `policy`).
- Benchmark is "S&P 500 Total Return" (SPY adj close); never label it just "S&P 500".
- `performance_type` drives the Simulated/Live label; never present simulated results as actual.
- Missing data shows N/A; never fill, interpolate or substitute a shorter period silently.
- Edge function imports use explicit `.ts` extensions so Node tests can import them directly.

## Gotchas
- Performance risk stats (Sharpe, beta, drawdown, rolling) are computed in the browser in `site/performance.html` from `monthly_returns`, not in the edge function.
- Do not hand-edit `site/reports/*.html`; edit `tools/` sources and rebuild.
- CSP in `vercel.json` blocks external scripts and any host but `*.supabase.co`; inline JS only, fonts only from Google Fonts.
- `tests/page_check.py` loads `/`, which is now the Home page (Performance moved to `/performance`); point it at `/performance` when checking that page.
- Editing `supabase/` locally does not deploy it; migrations and the function must be applied/deployed to the Supabase project.
