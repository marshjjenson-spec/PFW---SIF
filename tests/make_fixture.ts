// Builds realistic monthly_returns rows by running the real engine on a sample ledger.
import { valuePortfolio, monthlyReturns, type PriceBar, type Trade } from "../supabase/functions/update-data/core.ts";
import { writeFileSync } from "node:fs";
function rng(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const months = Number(process.argv[2] || 9);
const r = rng(42); const g = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const startMs = Date.UTC(2026, 9 - months, 1);
const cal: string[] = [];
for (let t = startMs; t <= Date.UTC(2026, 9, 2); t += 86400000) { const d = new Date(t); if (d.getUTCDay() % 6) cal.push(d.toISOString().slice(0, 10)); }
const spy: PriceBar[] = []; const aaa: PriceBar[] = [];
let s = 600, sa = 600, a = 100;
cal.forEach((d, i) => { const m = 0.0004 + 0.009 * g(); s *= 1 + m; sa *= 1 + m + (i % 63 === 40 ? 0.003 : 0); a *= 1 + 1.1 * m + 0.012 * g();
  spy.push({ date: d, close: s, adjClose: sa, divCash: 0, splitFactor: 1 }); aaa.push({ date: d, close: a, adjClose: a, divCash: i % 63 === 40 ? 0.5 : 0, splitFactor: 1 }); });
const trades: Trade[] = [
  { trade_date: cal[0], type: "DEPOSIT", amount: 100000 },
  { trade_date: cal[0], type: "BUY", ticker: "AAA", shares: 600, price: 100, fees: 0 },
  { trade_date: cal[0], type: "BUY", ticker: "SPY", shares: 50, price: 600, fees: 0 },
];
const daily = valuePortfolio(trades, { AAA: aaa, SPY: spy }, cal);
const monthly = monthlyReturns(daily, spy, "2026-10-03");
const rows = monthly.map(m => ({ month: m.month, period_start: m.periodStart, period_end: m.periodEnd, portfolio_return: m.portfolioReturn, benchmark_return: m.benchmarkReturn, is_partial: m.isPartial }));
writeFileSync(process.argv[3] || "fixture.json", JSON.stringify({ rows, profile: [{ id: 1, portfolio_name: "PFW-SIF Main Portfolio", benchmark_ticker: "SPY", performance_type: "simulated", risk_free_rate: 0.04, risk_free_source: "3-month U.S. Treasury bill", inception_date: cal[0], data_through: daily[daily.length - 1].date }] }));
console.log(months, "months ->", rows.length, "rows; last", rows[rows.length - 1]);
