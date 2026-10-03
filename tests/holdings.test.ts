// Run: node --experimental-strip-types --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { valuePortfolio, type PriceBar } from "../supabase/functions/update-data/core.ts";
import { buildHoldings, trailingBeta, trailingDividends, type LedgerTrade } from "../supabase/functions/update-data/holdings.ts";

const bar = (date: string, close: number, adjClose = close, divCash = 0, splitFactor = 1): PriceBar => ({ date, close, adjClose, divCash, splitFactor });
const near = (a: unknown, b: number, tol = 1e-6) => assert.ok(typeof a === "number" && Math.abs(a - b) < tol, `${a} != ${b}`);

function run(trades: LedgerTrade[], prices: Record<string, PriceBar[]>, securities = [] as { ticker: string; name: string; sector: string }[]) {
  const calendar = prices.SPY.map(b => b.date);
  const daily = valuePortfolio(trades, prices, calendar);
  return buildHoldings({ trades, prices, calendar, benchmarkTicker: "SPY", daily, monthlyReturns: [], securities, benchmarkSectors: [], policy: null });
}

const CAL = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"];
const SPY = CAL.map(d => bar(d, 500));

test("single position: shares, average cost with commission, market value, gain, weight", () => {
  const h = run([
    { trade_date: "2026-01-02", type: "DEPOSIT", amount: 10000 },
    { trade_date: "2026-01-02", type: "BUY", ticker: "abc", shares: 10, price: 100, fees: 5 },
  ], { SPY, ABC: [bar("2026-01-02", 100), bar("2026-01-05", 105), bar("2026-01-06", 110), bar("2026-01-07", 120)] },
  [{ ticker: "ABC", name: "Abc Corp", sector: "Industrials" }]);
  const p = h.positions[0];
  assert.equal(p.t, "ABC"); assert.equal(p.name, "Abc Corp"); assert.equal(p.sector, "Industrials");
  near(p.shares, 10); near(p.avg_cost, 100.5); near(p.mv, 1200); near(p.gain, 195); near(p.gain_pct, 1200 / 1005 - 1);
  near(h.nav, 10000 - 1005 + 1200); near(h.cash, 8995); near(p.weight, 1200 / 10195);
  near(p.day_pnl, 100); // 10 shares x (120 - 110)
  assert.equal(h.as_of, "2026-01-07");
  assert.equal(h.transactions[0].note, "Initiated position");
});

test("unknown ticker falls back to the ticker as name and Unclassified sector", () => {
  const h = run([{ trade_date: "2026-01-02", type: "DEPOSIT", amount: 1000 }, { trade_date: "2026-01-02", type: "BUY", ticker: "ZZZ", shares: 1, price: 10 }],
    { SPY, ZZZ: CAL.map(d => bar(d, 10)) });
  assert.equal(h.positions[0].name, "ZZZ"); assert.equal(h.positions[0].sector, "Unclassified");
});

test("FIFO partial sale: realized gain uses the oldest lot, remaining lots keep their cost", () => {
  const h = run([
    { trade_date: "2026-01-02", type: "DEPOSIT", amount: 10000 },
    { trade_date: "2026-01-02", type: "BUY", ticker: "X", shares: 10, price: 50 },
    { trade_date: "2026-01-05", type: "BUY", ticker: "X", shares: 10, price: 60 },
    { trade_date: "2026-01-06", type: "SELL", ticker: "X", shares: 15, price: 70 },
  ], { SPY, X: [bar("2026-01-02", 50), bar("2026-01-05", 60), bar("2026-01-06", 70), bar("2026-01-07", 70)] });
  const p = h.positions[0];
  near(p.shares, 5); near(p.avg_cost, 60); assert.equal(p.lots.length, 1); assert.equal(p.lots[0].date, "2026-01-05");
  near(h.realized_total, 15 * 70 - (10 * 50 + 5 * 60)); // 1050 - 800 = 250
  assert.equal(h.closed.length, 0);
  assert.equal(h.transactions[0].note, "Trimmed position");
  assert.equal(h.transactions[1].note, "Added to position");
});

test("full exit creates a closed position with holding period, realized gain and note", () => {
  const h = run([
    { trade_date: "2026-01-02", type: "DEPOSIT", amount: 10000 },
    { trade_date: "2026-01-02", type: "BUY", ticker: "X", shares: 10, price: 50, fees: 1 },
    { trade_date: "2026-01-07", type: "SELL", ticker: "X", shares: 10, price: 40, fees: 1, note: "Thesis broken", report_url: "https://example.org/memo" },
  ], { SPY, X: [bar("2026-01-02", 50), bar("2026-01-05", 45), bar("2026-01-06", 42), bar("2026-01-07", 40)] });
  assert.equal(h.positions.length, 0);
  const c = h.closed[0] as Record<string, number | string>;
  assert.equal(c.t, "X"); assert.equal(c.opened, "2026-01-02"); assert.equal(c.closed, "2026-01-07"); assert.equal(c.days, 5);
  near(c.realized, 399 - 501); near(c.return, 399 / 501 - 1); near(c.avg_cost, 50.1); near(c.avg_sale, 39.9);
  assert.equal(c.reason, "Thesis broken"); assert.equal(c.report_url, "https://example.org/memo");
  assert.equal(h.transactions[0].note, "Thesis broken");
  near(h.cash, 10000 - 501 + 399);
});

test("re-buying after an exit starts a new holding period", () => {
  const h = run([
    { trade_date: "2026-01-02", type: "DEPOSIT", amount: 10000 },
    { trade_date: "2026-01-02", type: "BUY", ticker: "X", shares: 10, price: 50 },
    { trade_date: "2026-01-05", type: "SELL", ticker: "X", shares: 10, price: 55 },
    { trade_date: "2026-01-06", type: "BUY", ticker: "X", shares: 4, price: 52 },
  ], { SPY, X: [bar("2026-01-02", 50), bar("2026-01-05", 55), bar("2026-01-06", 52), bar("2026-01-07", 53)] });
  assert.equal(h.positions[0].first, "2026-01-06"); near(h.positions[0].avg_cost, 52); assert.equal(h.closed.length, 1);
  assert.equal(h.transactions[0].note, "Initiated position");
});

test("split rescales lots without changing cost, and dividends are recorded on the ex-date", () => {
  const h = run([
    { trade_date: "2026-01-02", type: "DEPOSIT", amount: 10000 },
    { trade_date: "2026-01-02", type: "BUY", ticker: "S", shares: 10, price: 400 },
  ], { SPY, S: [bar("2026-01-02", 400), bar("2026-01-05", 410, 410, 2), bar("2026-01-06", 102, 102, 0, 4), bar("2026-01-07", 104)] });
  const p = h.positions[0];
  near(p.shares, 40); near(p.avg_cost, 100); near(p.cost, 4000); near(p.mv, 4160);
  near(p.day_pnl, 40 * 2); // 104 vs 102
  assert.equal(h.dividends.length, 1); near(h.dividends[0].amount, 20); near(h.income_received, 20);
  near(h.cash, 6020);
});

test("day change on a split day is measured per new share", () => {
  const h = run([
    { trade_date: "2026-01-02", type: "DEPOSIT", amount: 10000 },
    { trade_date: "2026-01-02", type: "BUY", ticker: "S", shares: 10, price: 400 },
  ], { SPY, S: [bar("2026-01-02", 400), bar("2026-01-05", 400), bar("2026-01-06", 400), bar("2026-01-07", 101, 101, 0, 4)] });
  near(h.positions[0].day_pnl, 40 * 1); // 101 vs 400/4
});

test("shares bought on the last day move from the price paid", () => {
  const h = run([
    { trade_date: "2026-01-02", type: "DEPOSIT", amount: 10000 },
    { trade_date: "2026-01-07", type: "BUY", ticker: "N", shares: 10, price: 20 },
  ], { SPY, N: [bar("2026-01-06", 19), bar("2026-01-07", 21)] });
  near(h.positions[0].day_pnl, 10);
});

test("selling more than held is rejected", () => {
  assert.throws(() => run([
    { trade_date: "2026-01-02", type: "DEPOSIT", amount: 10000 },
    { trade_date: "2026-01-02", type: "BUY", ticker: "X", shares: 1, price: 50 },
    { trade_date: "2026-01-05", type: "SELL", ticker: "X", shares: 2, price: 50 },
  ], { SPY, X: CAL.map(d => bar(d, 50)) }));
});

test("transaction notes and research links are passed through", () => {
  const h = run([
    { trade_date: "2026-01-02", type: "DEPOSIT", amount: 10000 },
    { trade_date: "2026-01-02", type: "BUY", ticker: "X", shares: 1, price: 50, rationale: "Long reason", team: "Tech team", approved_date: "2025-12-30", report_title: "Initiation", report_url: "https://example.org/r" },
  ], { SPY, X: CAL.map(d => bar(d, 50)) });
  const t = h.transactions[0];
  assert.equal(t.rationale, "Long reason"); assert.equal(t.team, "Tech team"); assert.equal(t.approved, "2025-12-30");
  assert.equal(t.report_title, "Initiation"); assert.equal(t.report_url, "https://example.org/r"); near(t.value, 50);
});

test("empty ledger gives an empty snapshot", () => {
  const h = buildHoldings({ trades: [], prices: { SPY }, calendar: CAL, benchmarkTicker: "SPY", daily: [], monthlyReturns: [], securities: [], benchmarkSectors: [], policy: null });
  assert.equal(h.positions.length, 0); assert.equal(h.as_of, null); assert.equal(h.nav, 0);
});

test("trailing beta: a stock that moves twice the benchmark has beta 2; too few observations gives null", () => {
  const dates: string[] = []; for (let i = 0; i < 100; i++) dates.push(new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10));
  let b = 100, s = 100; const bb: PriceBar[] = [], sb: PriceBar[] = [];
  dates.forEach((d, i) => { const r = Math.sin(i) * 0.01; b *= 1 + r; s *= 1 + 2 * r; bb.push(bar(d, b)); sb.push(bar(d, s)); });
  near(trailingBeta(sb, bb, dates[99]), 2, 1e-3);
  assert.equal(trailingBeta(sb.slice(0, 30), bb, dates[99]), null);
});

test("trailing dividends: last 365 days only, adjusted for a later split", () => {
  const bars = [bar("2025-04-01", 100, 100, 1), bar("2025-12-01", 100, 100, 1), bar("2026-03-01", 50, 50, 0, 2), bar("2026-04-01", 50, 50, 0.5)];
  near(trailingDividends(bars, "2026-05-01"), 1 / 2 + 0.5); // April 2025 is outside the window
});
