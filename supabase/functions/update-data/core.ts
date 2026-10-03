// PFW-SIF performance core: values the portfolio from the trade ledger and
// produces monthly Modified Dietz returns plus a total-return benchmark series.
// Pure functions only, so the same file runs in the Supabase edge function
// (Deno) and in the Node test suite.

export type TradeType = "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL" | "FEE";

export interface Trade {
  trade_date: string; // YYYY-MM-DD
  type: TradeType;
  ticker?: string | null;
  shares?: number | null;
  price?: number | null;
  amount?: number | null; // cash amount for DEPOSIT / WITHDRAWAL / FEE
  fees?: number | null; // commission on BUY / SELL
}

export interface PriceBar {
  date: string; // YYYY-MM-DD
  close: number; // raw close
  adjClose: number; // split- and dividend-adjusted close
  divCash: number; // cash dividend per share, on the ex-date
  splitFactor: number; // 1 = no split; 4 = 4-for-1 on this date
}

export interface DailyValue {
  date: string;
  value: number;
  cash: number;
  invested: number;
  netFlow: number; // external flows (deposits positive, withdrawals negative)
  missingPrices: string[];
}

export interface MonthlyReturn {
  month: string; // YYYY-MM
  periodStart: string;
  periodEnd: string;
  bmv: number;
  emv: number;
  netFlow: number;
  portfolioReturn: number | null;
  benchmarkReturn: number | null;
  isPartial: boolean;
  tradingDays: number;
}

export class LedgerError extends Error {}

const DAY = 86400000;
const toDay = (d: string) => Math.floor(Date.parse(d + "T00:00:00Z") / DAY);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const round = (v: number, d = 10) => Math.round(v * 10 ** d) / 10 ** d;

export function validateTrades(trades: Trade[]): void {
  trades.forEach((t, i) => {
    const where = `trade ${i + 1} (${t.trade_date} ${t.type}${t.ticker ? " " + t.ticker : ""})`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.trade_date)) throw new LedgerError(`${where}: date must be YYYY-MM-DD`);
    if (t.type === "BUY" || t.type === "SELL") {
      if (!t.ticker) throw new LedgerError(`${where}: ticker is required`);
      if (!(Number(t.shares) > 0)) throw new LedgerError(`${where}: shares must be greater than 0`);
      if (!(Number(t.price) > 0)) throw new LedgerError(`${where}: price must be greater than 0`);
    } else if (t.type === "DEPOSIT" || t.type === "WITHDRAWAL" || t.type === "FEE") {
      if (!(Number(t.amount) > 0)) throw new LedgerError(`${where}: amount must be greater than 0`);
    } else {
      throw new LedgerError(`${where}: unknown type "${(t as Trade).type}"`);
    }
  });
}

/**
 * Values the portfolio at each close in `calendar` (the benchmark's trading days)
 * from the first ledger date onward.
 */
export function valuePortfolio(trades: Trade[], prices: Record<string, PriceBar[]>, calendar: string[]): DailyValue[] {
  validateTrades(trades);
  if (!trades.length) return [];
  const sorted = [...trades].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const start = sorted[0].trade_date;
  const byTicker: Record<string, Map<string, PriceBar>> = {};
  for (const [t, bars] of Object.entries(prices)) byTicker[t.toUpperCase()] = new Map(bars.map(b => [b.date, b]));
  const lastClose: Record<string, number> = {};
  const shares: Record<string, number> = {};
  let cash = 0;
  let ti = 0;
  const out: DailyValue[] = [];
  const days = calendar.filter(d => d >= start).sort();
  if (!days.length) return [];
  // Trades dated before the first trading day count toward the first trading day.
  for (const d of days) {
    // 1) Corporate actions on positions held coming into the day.
    for (const t of Object.keys(shares)) {
      const bar = byTicker[t]?.get(d);
      if (!bar || shares[t] === 0) continue;
      if (bar.splitFactor && bar.splitFactor !== 1) shares[t] = shares[t] * bar.splitFactor;
      if (bar.divCash) cash += shares[t] * bar.divCash;
    }
    // 2) Ledger entries up to and including this day.
    let netFlow = 0;
    while (ti < sorted.length && sorted[ti].trade_date <= d) {
      const t = sorted[ti++];
      const fees = Number(t.fees) || 0;
      if (t.type === "DEPOSIT") { cash += Number(t.amount); netFlow += Number(t.amount); }
      else if (t.type === "WITHDRAWAL") { cash -= Number(t.amount); netFlow -= Number(t.amount); }
      else if (t.type === "FEE") { cash -= Number(t.amount); }
      else {
        const tk = String(t.ticker).toUpperCase();
        const qty = Number(t.shares), px = Number(t.price);
        if (t.type === "BUY") { shares[tk] = (shares[tk] || 0) + qty; cash -= qty * px + fees; }
        else {
          const held = shares[tk] || 0;
          if (qty > held + 1e-9) throw new LedgerError(`SELL ${tk} on ${t.trade_date}: selling ${qty} shares but only ${held} are held`);
          shares[tk] = held - qty; cash += qty * px - fees;
        }
      }
    }
    // 3) Mark to market at the close.
    let invested = 0;
    const missing: string[] = [];
    for (const [t, q] of Object.entries(shares)) {
      if (Math.abs(q) < 1e-12) continue;
      const bar = byTicker[t]?.get(d);
      if (bar) lastClose[t] = bar.close;
      if (lastClose[t] === undefined) { missing.push(t); continue; }
      invested += q * lastClose[t];
    }
    out.push({ date: d, value: round(cash + invested, 6), cash: round(cash, 6), invested: round(invested, 6), netFlow: round(netFlow, 6), missingPrices: missing });
  }
  return out;
}

/** Monthly Modified Dietz returns for the portfolio and simple total returns for the benchmark. */
export function monthlyReturns(daily: DailyValue[], benchmark: PriceBar[], today?: string): MonthlyReturn[] {
  if (!daily.length) return [];
  const bmByDate = new Map(benchmark.map(b => [b.date, b]));
  const groups = new Map<string, DailyValue[]>();
  for (const d of daily) {
    const k = d.date.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(d);
  }
  const months = [...groups.keys()].sort();
  const out: MonthlyReturn[] = [];
  let prevEnd: DailyValue | null = null;
  const inception = daily[0].date;
  const lastDate = daily[daily.length - 1].date;
  for (const k of months) {
    const days = groups.get(k)!;
    const [y, m] = k.split("-").map(Number);
    const first = prevEnd === null; // inception month
    const periodStart = first ? inception : `${k}-01`;
    const end = days[days.length - 1];
    const monthEnd = `${k}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
    const isPartial = end.date === lastDate && (today ? today < monthEnd : false) && end.date < monthEnd;
    const cd = toDay(end.date) - toDay(periodStart) + 1;
    const bmv = prevEnd ? prevEnd.value : 0;
    let flow = 0, weighted = 0;
    for (const d of days) {
      if (!d.netFlow) continue;
      flow += d.netFlow;
      const di = toDay(d.date) - toDay(periodStart);
      weighted += d.netFlow * ((cd - di) / cd);
    }
    const denom = bmv + weighted;
    const pr = denom > 0 ? (end.value - bmv - flow) / denom : null;
    // Benchmark: adjusted close at the end of the period over the prior period end
    // (for the inception month, over the close on the inception date).
    const baseDate = first ? inception : prevEnd!.date;
    const b0 = bmByDate.get(baseDate), b1 = bmByDate.get(end.date);
    const br = b0 && b1 && b0.adjClose > 0 ? b1.adjClose / b0.adjClose - 1 : null;
    out.push({ month: k, periodStart, periodEnd: end.date, bmv: round(bmv, 6), emv: round(end.value, 6), netFlow: round(flow, 6), portfolioReturn: pr === null ? null : round(pr), benchmarkReturn: br === null ? null : round(br), isPartial, tradingDays: days.length });
    prevEnd = end;
  }
  return out;
}

/** All tickers that need prices: everything ever traded plus the benchmark. */
export function requiredTickers(trades: Trade[], benchmarkTicker: string): string[] {
  const s = new Set<string>([benchmarkTicker.toUpperCase()]);
  for (const t of trades) if (t.ticker && (t.type === "BUY" || t.type === "SELL")) s.add(String(t.ticker).toUpperCase());
  return [...s].sort();
}

export interface MonthPosition {
  t: string;
  shares: number;      // held at the month-end close (0 if sold out during the month)
  close: number | null; // month-end close
  value: number;       // shares × close
  startValue: number;  // value at the prior month-end close (0 if first bought this month)
  bought: number;      // cash spent on buys this month, commissions included
  sold: number;        // cash received from sales this month, after commissions
  dividends: number;   // cash dividends received this month
  change: number;      // value − startValue − bought + sold + dividends
  changePct: number | null; // change ÷ (startValue + bought)
}

export interface MonthEnd {
  month: string; // YYYY-MM
  date: string;  // last trading day in the month
  cash: number;
  value: number; // total portfolio value at the close
  positions: MonthPosition[];
}

/**
 * Each position's value at every month-end close, with its gain or loss for the month.
 * Replays the ledger with the same rules as valuePortfolio (splits and dividends on the
 * ex-date, then trades, then the close), so month-end totals match daily_values.
 */
export function monthEndPositions(trades: Trade[], prices: Record<string, PriceBar[]>, calendar: string[]): MonthEnd[] {
  validateTrades(trades);
  if (!trades.length) return [];
  const sorted = [...trades].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const byTicker: Record<string, Map<string, PriceBar>> = {};
  for (const [t, bars] of Object.entries(prices)) byTicker[t.toUpperCase()] = new Map(bars.map(b => [b.date, b]));
  const days = calendar.filter(d => d >= sorted[0].trade_date).sort();
  const shares: Record<string, number> = {}, lastClose: Record<string, number> = {}, startValue: Record<string, number> = {};
  type Flow = { bought: number; sold: number; dividends: number };
  let flows: Record<string, Flow> = {};
  const flow = (t: string) => (flows[t] ||= { bought: 0, sold: 0, dividends: 0 });
  let cash = 0, ti = 0;
  const out: MonthEnd[] = [];
  days.forEach((d, i) => {
    for (const t of Object.keys(shares)) {
      const bar = byTicker[t]?.get(d);
      if (!bar || shares[t] === 0) continue;
      if (bar.splitFactor && bar.splitFactor !== 1) shares[t] *= bar.splitFactor;
      if (bar.divCash) { cash += shares[t] * bar.divCash; flow(t).dividends += shares[t] * bar.divCash; }
    }
    while (ti < sorted.length && sorted[ti].trade_date <= d) {
      const t = sorted[ti++];
      const fees = Number(t.fees) || 0;
      if (t.type === "DEPOSIT") cash += Number(t.amount);
      else if (t.type === "WITHDRAWAL" || t.type === "FEE") cash -= Number(t.amount);
      else {
        const tk = String(t.ticker).toUpperCase(), qty = Number(t.shares), px = Number(t.price);
        if (t.type === "BUY") { shares[tk] = (shares[tk] || 0) + qty; cash -= qty * px + fees; flow(tk).bought += qty * px + fees; }
        else {
          const held = shares[tk] || 0;
          if (qty > held + 1e-9) throw new LedgerError(`SELL ${tk} on ${t.trade_date}: selling ${qty} shares but only ${held} are held`);
          shares[tk] = held - qty; cash += qty * px - fees; flow(tk).sold += qty * px - fees;
        }
      }
    }
    for (const t of Object.keys(shares)) { const bar = byTicker[t]?.get(d); if (bar) lastClose[t] = bar.close; }
    const next = days[i + 1];
    if (next && next.slice(0, 7) === d.slice(0, 7)) return; // not the last trading day of the month
    const positions: MonthPosition[] = [];
    let invested = 0;
    for (const t of Object.keys(shares).sort()) {
      const q = shares[t], f = flows[t] || { bought: 0, sold: 0, dividends: 0 };
      const sv = startValue[t] || 0;
      if (Math.abs(q) < 1e-12 && !f.bought && !f.sold && !sv) continue;
      const close = lastClose[t] ?? null;
      const value = close === null ? 0 : q * close;
      invested += value;
      const change = value - sv - f.bought + f.sold + f.dividends;
      const base = sv + f.bought;
      positions.push({
        t, shares: round(q, 6), close, value: round(value, 2), startValue: round(sv, 2),
        bought: round(f.bought, 2), sold: round(f.sold, 2), dividends: round(f.dividends, 2),
        change: round(change, 2), changePct: base > 0 ? round(change / base, 6) : null,
      });
      startValue[t] = value;
    }
    positions.sort((a, b) => b.value - a.value);
    out.push({ month: d.slice(0, 7), date: d, cash: round(cash, 2), value: round(cash + invested, 2), positions });
    flows = {};
  });
  return out;
}
