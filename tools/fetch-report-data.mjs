// Gathers the numbers used by the research report pages and saves them to tools/report-data.json.
//
//   node tools/fetch-report-data.mjs <cache-folder>
//
// Sources, both free and public:
//   - SEC EDGAR company facts (financial statements exactly as filed), only filings made on or
//     before each report date, so a 2016 report never sees 2017 numbers.
//   - Yahoo Finance daily prices (closes adjusted for splits; "adjclose" also for dividends).
// Downloads are cached in <cache-folder> so the script can be re-run offline.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { reports } from "./reports-content.mjs";

// Peer group for each report. Market data is taken on the report's date
// (the publication date for pitches, the review price date for hold reviews).
const PEERS = {
  "aapl-2015-initiation": ["MSFT", "GOOGL", "IBM"],
  "googl-2016-initiation": ["META", "MSFT", "AAPL"],
  "intc-2016-pitch": ["QCOM", "TXN", "NVDA"],
  "amzn-2018-initiation": ["WMT", "MSFT", "GOOGL"],
  "ge-2018-pitch": ["HON", "MMM", "EMR"],
  "amd-2024-initiation": ["NVDA", "INTC", "AVGO"],
  "aapl-2026-review": ["MSFT", "GOOGL", "META"],
  "googl-2026-review": ["META", "MSFT", "AMZN"],
  "amzn-2026-review": ["WMT", "MSFT", "GOOGL"],
  "amd-2026-review": ["NVDA", "AVGO", "INTC"],
};
const REPORTS = reports.map((r) => ({ slug: r.slug, ticker: r.ticker, published: r.date, peers: PEERS[r.slug], heldSince: r.heldSince }));

const CACHE = process.argv[2] || "./.report-cache";
mkdirSync(CACHE, { recursive: true });
const UA = "PFW-SIF student research tool contact@pfw-sif.example";

// SEC central index keys. Alphabet's pre-October-2015 filings are under Google Inc.
const CIK = {
  AAPL: [320193], GOOGL: [1652044, 1288776], AMZN: [1018724], AMD: [2488], INTC: [50863], GE: [40545],
  MSFT: [789019], IBM: [51143], META: [1326801], NVDA: [1045810], QCOM: [804328], TXN: [97476],
  WMT: [104169], HON: [773840], MMM: [66740], EMR: [32604], AVGO: [1730168],
};

async function cached(file, url) {
  const p = join(CACHE, file);
  if (!existsSync(p)) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    writeFileSync(p, await res.text());
    await new Promise((r) => setTimeout(r, 300));
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

const day = (s) => Date.parse(s + "T00:00:00Z") / 864e5;
const iso = (d) => new Date(d * 864e5).toISOString().slice(0, 10);

/* ---------------- Prices ---------------- */
const priceCache = {};
async function prices(ticker) {
  if (priceCache[ticker]) return priceCache[ticker];
  const j = await cached(`y_${ticker}.json`, `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=1262304000&period2=1791100000&interval=1d&events=div%2Csplit`);
  const r = j.chart.result[0];
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose[0].adjclose;
  const splits = Object.values(r.events?.splits || {}).map((s) => ({ date: iso(Math.floor((s.date + r.meta.gmtoffset) / 86400)), f: s.numerator / s.denominator }));
  const rows = [];
  r.timestamp.forEach((t, i) => {
    if (q.close[i] == null) return;
    const date = iso(Math.floor((t + r.meta.gmtoffset) / 86400));
    rows.push({ date, close: q.close[i], adj: adj[i] });
  });
  // Close as actually traded that day: undo splits that happened later.
  for (const row of rows) row.raw = row.close * splits.filter((s) => s.date > row.date).reduce((a, s) => a * s.f, 1);
  const out = { rows, splits, exchange: r.meta.fullExchangeName, name: r.meta.longName };
  priceCache[ticker] = out;
  return out;
}
const onOrBefore = (rows, date) => { let lo = 0, hi = rows.length - 1, ans = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].date <= date) { ans = rows[m]; lo = m + 1; } else hi = m - 1; } return ans; };

function monthEnds(rows, from, to) {
  const out = []; let cur = null;
  for (const r of rows) { if (r.date < from || r.date > to) continue; const k = r.date.slice(0, 7); if (cur && cur.date.slice(0, 7) !== k) out.push(cur); cur = r; }
  if (cur) out.push(cur);
  return out;
}

async function beta(ticker, asOf) {
  const from = iso(day(asOf) - 3 * 365 - 31);
  const a = monthEnds((await prices(ticker)).rows, from, asOf), b = monthEnds((await prices("SPY")).rows, from, asOf);
  const bm = new Map(b.map((r) => [r.date.slice(0, 7), r.adj]));
  const pairs = [];
  for (let i = 1; i < a.length; i++) { const k0 = a[i - 1].date.slice(0, 7), k1 = a[i].date.slice(0, 7); if (bm.has(k0) && bm.has(k1)) pairs.push([a[i].adj / a[i - 1].adj - 1, bm.get(k1) / bm.get(k0) - 1]); }
  if (pairs.length < 24) return null;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length, my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let cov = 0, vy = 0; for (const [x, y] of pairs) { cov += (x - mx) * (y - my); vy += (y - my) ** 2; }
  return cov / vy;
}

/* ---------------- SEC filings ---------------- */
const TAGS = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet"],
  cost: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization"],
  gross: ["GrossProfit"],
  opInc: ["OperatingIncomeLoss"],
  netInc: ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"],
  eps: ["EarningsPerShareDiluted"],
  ocf: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForProceedsFromProductiveAssets"],
  dilShares: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
};
const INSTANT = {
  cash: [["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]],
  stInv: [["MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "AvailableForSaleSecuritiesCurrent", "ShortTermInvestments"]],
  ltInv: [["MarketableSecuritiesNoncurrent", "AvailableForSaleSecuritiesDebtSecuritiesNoncurrent", "AvailableForSaleSecuritiesNoncurrent"]],
  debt: [["LongTermDebt", "LongTermDebtNoncurrent"], ["CommercialPaper"]],
  equity: [["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]],
};

const factCache = {};
async function facts(ticker) {
  if (factCache[ticker]) return factCache[ticker];
  const all = [];
  for (const c of CIK[ticker]) {
    const f = `CIK${String(c).padStart(10, "0")}.json`;
    all.push(await cached(f, `https://data.sec.gov/api/xbrl/companyfacts/${f}`));
  }
  return (factCache[ticker] = all);
}
function series(all, tag, asOf, { unit, instant = false, forms = /^10-K/ } = {}) {
  const out = [];
  for (const cf of all) {
    for (const ns of ["us-gaap", "dei"]) {
      const t = cf.facts?.[ns]?.[tag]; if (!t) continue;
      for (const [u, arr] of Object.entries(t.units)) {
        if (unit && u !== unit) continue;
        for (const f of arr) if (forms.test(f.form) && f.filed <= asOf) out.push({ ...f, unit: u, instant });
      }
    }
  }
  return out;
}
// Annual values: one per fiscal-year end, the latest version filed on or before asOf.
// Companies change tags over time (Apple moved from Revenues to RevenueFromContract... in 2018),
// so every tag is read and, for each year, the first tag in the list that has it wins.
function annual(all, tags, asOf, unit) {
  const merged = new Map();
  for (const tag of tags) {
    const fs = series(all, tag, asOf, { unit }).filter((f) => f.start && day(f.end) - day(f.start) > 350 && day(f.end) - day(f.start) < 380);
    const byEnd = new Map();
    for (const f of fs) { const p = byEnd.get(f.end); if (!p || f.filed > p.filed) byEnd.set(f.end, f); }
    for (const [k, f] of byEnd) if (!merged.has(k)) merged.set(k, f.val);
  }
  return merged;
}
function instantAt(all, groups, asOf, end) {
  let total = 0, found = false;
  for (const tags of groups) {
    for (const tag of tags) {
      const fs = series(all, tag, asOf, { unit: "USD", forms: /^10-[KQ]/ }).filter((f) => !f.start && Math.abs(day(f.end) - day(end)) <= 5);
      if (fs.length) { fs.sort((a, b) => (a.filed < b.filed ? 1 : -1)); total += fs[0].val; found = true; break; }
    }
  }
  return found ? total : null;
}
// Trailing twelve months from the latest 10-Q on or before asOf: FY + current YTD − prior-year YTD.
function ttm(all, tags, asOf, fyEnd, fyVal, unit) {
  for (const tag of tags) {
    const q = series(all, tag, asOf, { unit, forms: /^10-Q/ }).filter((f) => f.start && f.end > fyEnd && Math.abs(day(f.start) - day(fyEnd) - 1) <= 10);
    if (!q.length) continue;
    q.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : a.filed < b.filed ? 1 : -1));
    const cur = q[0];
    const prior = series(all, tag, asOf, { unit, forms: /^10-[QK]/ }).filter((f) => f.start && Math.abs(day(f.end) - day(cur.end) + 365) <= 10 && Math.abs(day(f.start) - day(cur.start) + 365) <= 10);
    if (!prior.length) continue;
    prior.sort((a, b) => (a.filed < b.filed ? 1 : -1));
    return { val: fyVal + cur.val - prior[0].val, through: cur.end };
  }
  return null;
}
async function sharesOut(ticker, asOf) {
  // Diluted weighted-average shares from the latest filing. (The cover-page share count is
  // split by share class for some companies, such as Alphabet, so it is not used.)
  const all = await facts(ticker);
  const fs = series(all, "WeightedAverageNumberOfDilutedSharesOutstanding", asOf, { unit: "shares", forms: /^10-[KQ]/ });
  if (!fs.length) return null;
  const latest = fs.reduce((a, f) => (f.end > a.end || (f.end === a.end && f.filed > a.filed) ? f : a));
  // Restate for stock splits between that filing's period end and asOf (for example NVIDIA's
  // 10-for-1 split in June 2024), so the count matches the price on asOf.
  const splits = (await prices(ticker)).splits.filter((s) => s.date > latest.end && s.date <= asOf);
  return latest.val * splits.reduce((a, s) => a * s.f, 1);
}

async function fundamentals(ticker, asOf, years = 4) {
  const all = await facts(ticker);
  const rev = annual(all, TAGS.revenue, asOf, "USD");
  const ends = [...rev.keys()].sort().slice(-years);
  const get = (k, unit = "USD") => annual(all, TAGS[k], asOf, unit);
  const m = { cost: get("cost"), gross: get("gross"), opInc: get("opInc"), netInc: get("netInc"), eps: get("eps", "USD/shares"), ocf: get("ocf"), capex: get("capex"), dilShares: get("dilShares", "shares") };
  const fy = ends.map((end) => {
    const r = rev.get(end);
    // GE's filings tag product costs and service costs separately and include GE Capital
    // revenue, so revenue minus the tagged cost would overstate its gross margin.
    const gross = ticker === "GE" ? null : m.gross.get(end) ?? (m.cost.has(end) ? r - m.cost.get(end) : null);
    const cash = instantAt(all, INSTANT.cash, asOf, end), st = instantAt(all, INSTANT.stInv, asOf, end), lt = instantAt(all, INSTANT.ltInv, asOf, end);
    return {
      end, revenue: r, gross, opInc: m.opInc.get(end) ?? null, netInc: m.netInc.get(end) ?? null, eps: m.eps.get(end) ?? null,
      ocf: m.ocf.get(end) ?? null, capex: m.capex.get(end) ?? null, dilShares: m.dilShares.get(end) ?? null,
      cashInv: cash == null ? null : cash + (st || 0) + (lt || 0), debt: instantAt(all, INSTANT.debt, asOf, end), equity: instantAt(all, INSTANT.equity, asOf, end),
    };
  });
  const last = fy[fy.length - 1];
  const t = {};
  if (last) for (const k of ["revenue", "netInc", "eps", "ocf", "capex", "opInc"]) {
    const tags = k === "revenue" ? TAGS.revenue : TAGS[k];
    const r = ttm(all, tags, asOf, last.end, last[k], k === "eps" ? "USD/shares" : "USD");
    if (r && last[k] != null) { t[k] = r.val; t.through = r.through; }
  }
  return { fy, ttm: t };
}

async function snapshot(ticker, asOf) {
  const p = await prices(ticker);
  const row = onOrBefore(p.rows, asOf);
  const yr = p.rows.filter((r) => r.date > iso(day(asOf) - 365) && r.date <= asOf);
  const f = await fundamentals(ticker, asOf);
  const shares = await sharesOut(ticker, asOf);
  const lastFy = f.fy[f.fy.length - 1] || {};
  const prevFy = f.fy[f.fy.length - 2] || {};
  // Per-share earnings from trailing net income over current shares. Adding up reported EPS
  // breaks across a stock split, and some companies (Alphabet) only report EPS by share class.
  const netInc = f.ttm.netInc ?? lastFy.netInc;
  const eps = netInc != null && shares ? netInc / shares : null;
  const rev = f.ttm.revenue ?? lastFy.revenue;
  const ocf = f.ttm.ocf ?? lastFy.ocf, capex = f.ttm.capex ?? lastFy.capex;
  const fcf = ocf != null && capex != null ? ocf - capex : NaN;
  return {
    ticker, exchange: p.exchange, date: row.date, price: row.raw,
    hi52: Math.max(...yr.map((r) => r.raw)), lo52: Math.min(...yr.map((r) => r.raw)),
    shares, marketCap: shares ? shares * row.raw : null,
    epsTtm: eps, pe: eps > 0 ? row.raw / eps : null,
    revenueTtm: rev, revGrowth: lastFy.revenue && prevFy.revenue ? lastFy.revenue / prevFy.revenue - 1 : null,
    grossMargin: lastFy.gross != null ? lastFy.gross / lastFy.revenue : null,
    opMargin: lastFy.opInc != null ? lastFy.opInc / lastFy.revenue : null,
    netMargin: lastFy.netInc != null ? lastFy.netInc / lastFy.revenue : null,
    roe: lastFy.netInc != null && lastFy.equity > 0 ? lastFy.netInc / lastFy.equity : null,
    fcfTtm: Number.isFinite(fcf) ? fcf : null, fcfYield: Number.isFinite(fcf) && shares ? fcf / (shares * row.raw) : null,
    debtToEquity: lastFy.debt != null && lastFy.equity > 0 ? lastFy.debt / lastFy.equity : null,
    beta: await beta(ticker, asOf),
    ttmThrough: f.ttm.through || null,
    fundamentals: f,
  };
}

// Total-return path of a stock and SPY between two dates, rebased to 100, sampled weekly.
async function path(ticker, from, to) {
  const a = (await prices(ticker)).rows.filter((r) => r.date >= from && r.date <= to);
  const b = (await prices("SPY")).rows;
  if (!a.length) return [];
  const b0 = onOrBefore(b, a[0].date);
  const out = [];
  a.forEach((r, i) => { if (i % 5 === 0 || i === a.length - 1) { const br = onOrBefore(b, r.date); out.push([r.date, +(100 * r.adj / a[0].adj).toFixed(2), +(100 * br.adj / b0.adj).toFixed(2), +r.raw.toFixed(2), +r.close.toFixed(2)]); } });
  return out;
}

// 10-year US Treasury yield (Yahoo ^TNX), the risk-free rate in each DCF.
const tnx = await (async () => {
  const j = await cached("y_TNX.json", "https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?period1=1420070400&period2=1791100000&interval=1d");
  const r = j.chart.result[0], q = r.indicators.quote[0], rows = [];
  r.timestamp.forEach((t, i) => { if (q.close[i] != null) rows.push({ date: iso(Math.floor((t + r.meta.gmtoffset) / 86400)), y: q.close[i] / 100 }); });
  return rows;
})();

const out = {};
const latest = (await prices("SPY")).rows.at(-1).date;
for (const r of REPORTS) {
  const asOf = r.published;
  const main = await snapshot(r.ticker, asOf);
  const peers = [];
  for (const t of r.peers) peers.push(await snapshot(t, asOf));
  const before = await path(r.ticker, iso(day(asOf) - 5 * 365), asOf);
  const sinceFrom = r.heldSince || asOf;
  const since = await path(r.ticker, sinceFrom, latest);
  out[r.slug] = { asOf, latest, main, peers, before, since, sinceFrom, riskFree: +onOrBefore(tnx, asOf).y.toFixed(4) };
  console.log(r.slug, main.date, main.price.toFixed(2), "P/E", main.pe?.toFixed(1), "rev", (main.revenueTtm / 1e9).toFixed(1), "ttm", main.ttmThrough);
}
writeFileSync(new URL("./report-data.json", import.meta.url), JSON.stringify(out));
console.log("Saved tools/report-data.json");
