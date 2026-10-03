// PFW-SIF holdings core: builds everything the public Holdings page shows from the
// trade ledger and end-of-day prices. Pure functions only (runs in Deno and Node).
//
// Cost basis is FIFO by purchase lot. Commissions are added to the cost of the lot
// bought and subtracted from sale proceeds. Splits rescale open lots; cash dividends
// are credited on the ex-date (matching valuePortfolio in core.ts).
import { validateTrades, type DailyValue, type PriceBar, type Trade } from "./core.ts";

export interface LedgerTrade extends Trade {
  note?: string | null;
  rationale?: string | null;
  team?: string | null;
  approved_date?: string | null;
  report_title?: string | null;
  report_url?: string | null;
}

export interface Security {
  ticker: string;
  name: string;
  sector: string;
  industry?: string | null;
  thesis?: string | null;
  thesis_url?: string | null;
}

export interface BenchmarkSector { sector: string; weight: number; as_of: string; source: string }

export interface Policy {
  max_position?: number;
  max_sector_active?: number;
  cash_min?: number;
  cash_max?: number;
  min_positions?: number;
}

interface Lot { date: string; shares: number; price: number; cost: number }

const DAY = 86400000;
const toDay = (d: string) => Math.floor(Date.parse(d + "T00:00:00Z") / DAY);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const EPS = 1e-9;

/** Beta of daily adjusted-close returns against the benchmark over the trailing `days` sessions. */
export function trailingBeta(stock: PriceBar[], bench: PriceBar[], asOf: string, days = 252, minObs = 60): number | null {
  const s = new Map(stock.map(b => [b.date, b.adjClose]));
  const dates = bench.filter(b => b.date <= asOf && s.has(b.date)).map(b => b.date);
  const bm = new Map(bench.map(b => [b.date, b.adjClose]));
  const use = dates.slice(-(days + 1));
  const x: number[] = [], y: number[] = [];
  for (let i = 1; i < use.length; i++) {
    const b0 = bm.get(use[i - 1])!, b1 = bm.get(use[i])!, s0 = s.get(use[i - 1])!, s1 = s.get(use[i])!;
    if (b0 > 0 && s0 > 0) { x.push(b1 / b0 - 1); y.push(s1 / s0 - 1); }
  }
  if (x.length < minObs) return null;
  const mx = x.reduce((a, v) => a + v, 0) / x.length, my = y.reduce((a, v) => a + v, 0) / y.length;
  let cov = 0, vx = 0;
  for (let i = 0; i < x.length; i++) { cov += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; }
  return vx > 0 ? r4(cov / vx) : null;
}

/** Cash dividends per current share over the 365 days to `asOf`, adjusted for later splits. */
export function trailingDividends(bars: PriceBar[], asOf: string): number {
  const from = toDay(asOf) - 365;
  let factor = 1, total = 0;
  const sorted = [...bars].filter(b => b.date <= asOf).sort((a, b) => b.date.localeCompare(a.date));
  for (const b of sorted) {
    if (toDay(b.date) <= from) break;
    if (b.divCash) total += b.divCash / factor;
    if (b.splitFactor && b.splitFactor !== 1) factor *= b.splitFactor; // earlier dividends were on fewer shares
  }
  return r6(total);
}

export interface HoldingsInput {
  trades: LedgerTrade[];
  prices: Record<string, PriceBar[]>;
  calendar: string[];          // benchmark trading days
  benchmarkTicker: string;
  daily: DailyValue[];         // from valuePortfolio
  monthlyReturns: (number | null)[]; // portfolio returns, oldest first
  securities: Security[];
  benchmarkSectors: BenchmarkSector[];
  policy: Policy | null;
}

export function buildHoldings(inp: HoldingsInput) {
  validateTrades(inp.trades);
  const bench = inp.benchmarkTicker.toUpperCase();
  const sec = new Map(inp.securities.map(s => [s.ticker.toUpperCase(), s]));
  const info = (t: string) => sec.get(t) || { ticker: t, name: t, sector: "Unclassified" } as Security;
  const bars: Record<string, Map<string, PriceBar>> = {};
  for (const [t, b] of Object.entries(inp.prices)) bars[t.toUpperCase()] = new Map(b.map(x => [x.date, x]));

  const sorted = [...inp.trades].map((t, i) => ({ ...t, _i: i })).sort((a, b) => a.trade_date.localeCompare(b.trade_date) || a._i - b._i);
  const days = sorted.length ? inp.calendar.filter(d => d >= sorted[0].trade_date).sort() : [];
  const asOf = days[days.length - 1] ?? null;

  const lots: Record<string, Lot[]> = {};
  const periodOpen: Record<string, string> = {};        // first buy date of the current holding period
  const periodSold: Record<string, { shares: number; proceeds: number; cost: number }> = {};
  const lastClose: Record<string, number> = {};
  const prevClose: Record<string, number> = {};
  const dividends: { date: string; ticker: string; perShare: number; shares: number; amount: number }[] = [];
  const closed: Record<string, unknown>[] = [];
  const transactions: Record<string, unknown>[] = [];
  let realizedTotal = 0;
  let ti = 0;
  const held = (t: string) => (lots[t] || []).reduce((a, l) => a + l.shares, 0);

  for (const d of days) {
    // Corporate actions on positions held coming into the day.
    for (const t of Object.keys(lots)) {
      const q = held(t);
      if (q < EPS) continue;
      const bar = bars[t]?.get(d);
      if (!bar) continue;
      if (bar.splitFactor && bar.splitFactor !== 1) {
        for (const l of lots[t]) { l.shares *= bar.splitFactor; l.price /= bar.splitFactor; }
        if (lastClose[t] !== undefined) lastClose[t] /= bar.splitFactor; // keep the day change on a per-new-share basis
      }
      if (bar.divCash) dividends.push({ date: d, ticker: t, perShare: bar.divCash, shares: r6(held(t)), amount: r6(held(t) * bar.divCash) });
    }
    while (ti < sorted.length && sorted[ti].trade_date <= d) {
      const t = sorted[ti++];
      if (t.type !== "BUY" && t.type !== "SELL") continue;
      const tk = String(t.ticker).toUpperCase();
      const qty = Number(t.shares), px = Number(t.price), fees = Number(t.fees) || 0;
      const before = held(tk);
      let label: string;
      if (t.type === "BUY") {
        if (before < EPS) { lots[tk] = []; periodOpen[tk] = t.trade_date; periodSold[tk] = { shares: 0, proceeds: 0, cost: 0 }; }
        lots[tk].push({ date: t.trade_date, shares: qty, price: px, cost: qty * px + fees });
        label = before < EPS ? "Initiated position" : "Added to position";
      } else {
        if (qty > before + 1e-9) throw new Error(`SELL ${tk} on ${t.trade_date}: selling ${qty} shares but only ${before} are held`);
        let left = qty, costOut = 0;
        while (left > EPS && lots[tk].length) {
          const l = lots[tk][0];
          const take = Math.min(left, l.shares);
          const c = l.cost * (take / l.shares);
          costOut += c; l.cost -= c; l.shares -= take; left -= take;
          if (l.shares < EPS) lots[tk].shift();
        }
        const proceeds = qty * px - fees;
        realizedTotal += proceeds - costOut;
        const ps = periodSold[tk]; ps.shares += qty; ps.proceeds += proceeds; ps.cost += costOut;
        const exited = held(tk) < EPS;
        label = exited ? "Exited position" : "Trimmed position";
        if (exited) {
          const s = info(tk);
          closed.push({
            t: tk, name: s.name, sector: s.sector, opened: periodOpen[tk], closed: t.trade_date,
            days: toDay(t.trade_date) - toDay(periodOpen[tk]),
            shares: r6(ps.shares), avg_cost: r6(ps.cost / ps.shares), avg_sale: r6(ps.proceeds / ps.shares),
            realized: r6(ps.proceeds - ps.cost), return: ps.cost > 0 ? r6(ps.proceeds / ps.cost - 1) : null,
            reason: t.note || null, report_title: t.report_title || null, report_url: t.report_url || null,
          });
          lots[tk] = [];
        }
      }
      const s = info(tk);
      transactions.push({
        date: t.trade_date, type: t.type, t: tk, name: s.name, sector: s.sector, shares: qty, price: px, fees,
        value: r6(qty * px), note: t.note || label, rationale: t.rationale || null, team: t.team || null,
        approved: t.approved_date || null, report_title: t.report_title || null, report_url: t.report_url || null,
      });
    }
    for (const t of Object.keys(lots)) {
      const bar = bars[t]?.get(d);
      if (bar) { if (lastClose[t] !== undefined) prevClose[t] = lastClose[t]; lastClose[t] = bar.close; }
    }
  }

  const lastDaily = inp.daily[inp.daily.length - 1];
  const nav = lastDaily ? lastDaily.value : 0;
  const cash = lastDaily ? lastDaily.cash : 0;
  const lastBar = (t: string) => bars[t]?.get(asOf ?? "");
  const benchBars = inp.prices[bench] || [];

  const positions = Object.keys(lots).filter(t => held(t) > EPS).map(t => {
    const s = info(t);
    const shares = held(t);
    const cost = lots[t].reduce((a, l) => a + l.cost, 0);
    const last = lastClose[t];
    const stale = !lastBar(t);
    const mv = last !== undefined ? shares * last : null;
    // Day change: shares held at the prior close move from that close; shares bought today move from the price paid.
    let dayPnl: number | null = null;
    if (last !== undefined && !stale) {
      dayPnl = 0;
      for (const l of lots[t]) {
        const base = l.date === asOf ? l.cost / l.shares : prevClose[t];
        if (base === undefined) { dayPnl = null; break; }
        dayPnl += l.shares * (last - base);
      }
    }
    const ttm = trailingDividends(inp.prices[t] || [], asOf ?? "");
    return {
      t, name: s.name, sector: s.sector, industry: s.industry || null, thesis: s.thesis || null, thesis_url: s.thesis_url || null,
      shares: r6(shares), avg_cost: r6(cost / shares), cost: r6(cost), last: last ?? null, prev_close: prevClose[t] ?? null,
      price_date: stale ? null : asOf, mv: mv === null ? null : r6(mv), weight: mv !== null && nav > 0 ? r6(mv / nav) : null,
      gain: mv === null ? null : r6(mv - cost), gain_pct: mv === null || cost <= 0 ? null : r6(mv / cost - 1),
      day_pnl: dayPnl === null ? null : r6(dayPnl), first: periodOpen[t],
      lots: lots[t].map(l => ({ date: l.date, shares: r6(l.shares), price: r6(l.cost / l.shares) })),
      beta: trailingBeta(inp.prices[t] || [], benchBars, asOf ?? ""),
      ttm_dps: ttm, est_income: r6(ttm * shares),
    };
  }).sort((a, b) => (b.mv ?? 0) - (a.mv ?? 0));

  const mrs = inp.monthlyReturns.filter((r): r is number => r !== null);
  const sinceInception = mrs.length ? r6(mrs.reduce((x, r) => x * (1 + r), 1) - 1) : null;
  const bs = inp.benchmarkSectors.filter(b => b.weight > 0);

  return {
    as_of: asOf,
    nav: r6(nav),
    cash: r6(cash),
    invested: r6(nav - cash),
    since_inception: sinceInception,
    realized_total: r6(realizedTotal),
    income_received: r6(dividends.reduce((a, d) => a + d.amount, 0)),
    positions,
    dividends: dividends.slice(-12).reverse(),
    closed: closed.reverse(),
    transactions: transactions.slice(-25).reverse(),
    benchmark_sectors: bs.length ? { as_of: bs.reduce((a, b) => (a > b.as_of ? a : b.as_of), ""), source: bs[0].source, weights: Object.fromEntries(bs.map(b => [b.sector, Number(b.weight)])) } : null,
    policy: inp.policy || null,
    methodology: { cost_basis: "FIFO by lot, commissions included", beta: "Daily returns vs " + bench + ", trailing 252 sessions, minimum 60", dividends: "Credited on ex-date; trailing 12-month dividends per share" },
  };
}
