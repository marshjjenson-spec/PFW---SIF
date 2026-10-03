// Run: node --experimental-strip-types --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { valuePortfolio, monthlyReturns, requiredTickers, LedgerError, type PriceBar, type Trade } from "../supabase/functions/update-data/core.ts";

const bar = (date: string, close: number, adjClose = close, divCash = 0, splitFactor = 1): PriceBar => ({ date, close, adjClose, divCash, splitFactor });
const near = (a: number | null, b: number, tol = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < tol, `${a} != ${b}`);

test("cash only: value equals deposit, return 0", () => {
  const cal = ["2026-01-02", "2026-01-30"];
  const d = valuePortfolio([{ trade_date: "2026-01-02", type: "DEPOSIT", amount: 100000 }], { SPY: cal.map(x => bar(x, 500)) }, cal);
  assert.equal(d[1].value, 100000);
  const m = monthlyReturns(d, cal.map(x => bar(x, 500)));
  near(m[0].portfolioReturn, 0);
  near(m[0].benchmarkReturn, 0);
});

test("buy and hold: return follows the stock, net of commission", () => {
  const cal = ["2026-01-02", "2026-01-30", "2026-02-27"];
  const trades: Trade[] = [
    { trade_date: "2026-01-02", type: "DEPOSIT", amount: 10000 },
    { trade_date: "2026-01-02", type: "BUY", ticker: "abc", shares: 100, price: 100, fees: 0 },
  ];
  const prices = { ABC: [bar("2026-01-02", 100), bar("2026-01-30", 110), bar("2026-02-27", 99)], SPY: cal.map(x => bar(x, 500)) };
  const d = valuePortfolio(trades, prices, cal);
  assert.deepEqual(d.map(x => x.value), [10000, 11000, 9900]);
  const m = monthlyReturns(d, prices.SPY);
  near(m[0].portfolioReturn, 0.10); // Jan: (11000 - 0 - 10000) / 10000
  near(m[1].portfolioReturn, -0.10); // Feb: 9900 / 11000 - 1
});

test("Modified Dietz weights a mid-month deposit by days invested", () => {
  // Jan ends at 100,000. Feb (28 days): 50,000 deposited on Feb 15 (day index 14), EMV 155,000.
  const cal = ["2026-01-30", "2026-02-13", "2026-02-15", "2026-02-27"];
  const trades: Trade[] = [
    { trade_date: "2026-01-30", type: "DEPOSIT", amount: 100000 },
    { trade_date: "2026-01-30", type: "BUY", ticker: "X", shares: 1000, price: 100 },
    { trade_date: "2026-02-15", type: "DEPOSIT", amount: 50000 },
  ];
  const prices = { X: [bar("2026-01-30", 100), bar("2026-02-13", 102), bar("2026-02-15", 103), bar("2026-02-27", 105)], SPY: cal.map(x => bar(x, 1)) };
  const d = valuePortfolio(trades, prices, cal);
  assert.equal(d[3].value, 155000); // 1000 x 105 + 50,000 cash
  const m = monthlyReturns(d, prices.SPY);
  // Period is Feb 1 - Feb 27 (27 days); flow on day index 14 -> weight (27-14)/27
  const w = (27 - 14) / 27;
  near(m[1].portfolioReturn, (155000 - 100000 - 50000) / (100000 + 50000 * w));
});

test("withdrawal is an external flow, fee is a loss", () => {
  const cal = ["2026-03-02", "2026-03-31"];
  const trades: Trade[] = [
    { trade_date: "2026-03-02", type: "DEPOSIT", amount: 1000 },
    { trade_date: "2026-03-31", type: "WITHDRAWAL", amount: 200 },
    { trade_date: "2026-03-31", type: "FEE", amount: 10 },
  ];
  const d = valuePortfolio(trades, { SPY: cal.map(x => bar(x, 1)) }, cal);
  assert.equal(d[1].value, 790);
  const m = monthlyReturns(d, cal.map(x => bar(x, 1)));
  // CF = 1000 (w=1) - 200 (w=1/30); EMV - CF = 790 - 800 = -10
  near(m[0].portfolioReturn, -10 / (1000 - 200 * (1 / 30)));
});

test("dividends are credited on the ex-date to shares held coming into the day", () => {
  const cal = ["2026-04-01", "2026-04-15", "2026-04-30"];
  const trades: Trade[] = [
    { trade_date: "2026-04-01", type: "DEPOSIT", amount: 1000 },
    { trade_date: "2026-04-01", type: "BUY", ticker: "D", shares: 10, price: 100 },
  ];
  const prices = { D: [bar("2026-04-01", 100), bar("2026-04-15", 99, 99, 1.0), bar("2026-04-30", 99)], SPY: cal.map(x => bar(x, 1)) };
  const d = valuePortfolio(trades, prices, cal);
  assert.equal(d[1].cash, 10); // 10 shares x $1
  assert.equal(d[2].value, 1000); // 990 + 10 cash: dividend offsets the price drop
});

test("splits multiply shares and keep value continuous", () => {
  const cal = ["2026-05-01", "2026-05-15"];
  const trades: Trade[] = [
    { trade_date: "2026-05-01", type: "DEPOSIT", amount: 1000 },
    { trade_date: "2026-05-01", type: "BUY", ticker: "S", shares: 10, price: 100 },
  ];
  const prices = { S: [bar("2026-05-01", 100), bar("2026-05-15", 25, 25, 0, 4)], SPY: cal.map(x => bar(x, 1)) };
  const d = valuePortfolio(trades, prices, cal);
  assert.equal(d[1].value, 1000);
});

test("benchmark uses adjusted closes, inception month measured from inception close", () => {
  const cal = ["2026-01-15", "2026-01-30", "2026-02-27"];
  const spy = [bar("2026-01-15", 600, 590), bar("2026-01-30", 612, 601.8), bar("2026-02-27", 600, 595.782)];
  const d = valuePortfolio([{ trade_date: "2026-01-15", type: "DEPOSIT", amount: 1 }], { SPY: spy }, cal);
  const m = monthlyReturns(d, spy);
  near(m[0].benchmarkReturn, 601.8 / 590 - 1);
  near(m[1].benchmarkReturn, 595.782 / 601.8 - 1);
  assert.equal(m[0].periodStart, "2026-01-15");
});

test("selling more than held is rejected", () => {
  const cal = ["2026-01-02"];
  assert.throws(() => valuePortfolio([
    { trade_date: "2026-01-02", type: "DEPOSIT", amount: 100 },
    { trade_date: "2026-01-02", type: "SELL", ticker: "Z", shares: 1, price: 1 },
  ], { SPY: [bar("2026-01-02", 1)] }, cal), LedgerError);
});

test("bad rows give a readable error", () => {
  assert.throws(() => valuePortfolio([{ trade_date: "2026-1-2", type: "DEPOSIT", amount: 1 }], {}, []), /YYYY-MM-DD/);
  assert.throws(() => valuePortfolio([{ trade_date: "2026-01-02", type: "BUY", ticker: "A", shares: 0, price: 1 }], {}, []), /shares/);
});

test("current month is flagged partial until month end", () => {
  const cal = ["2026-09-01", "2026-09-30", "2026-10-02"];
  const d = valuePortfolio([{ trade_date: "2026-09-01", type: "DEPOSIT", amount: 1 }], { SPY: cal.map(x => bar(x, 1)) }, cal);
  const m = monthlyReturns(d, cal.map(x => bar(x, 1)), "2026-10-03");
  assert.equal(m[0].isPartial, false);
  assert.equal(m[1].isPartial, true);
});

test("price gaps carry the last close; unpriced tickers are reported", () => {
  const cal = ["2026-06-01", "2026-06-02"];
  const trades: Trade[] = [
    { trade_date: "2026-06-01", type: "DEPOSIT", amount: 1000 },
    { trade_date: "2026-06-01", type: "BUY", ticker: "G", shares: 1, price: 10 },
    { trade_date: "2026-06-01", type: "BUY", ticker: "NOPE", shares: 1, price: 10 },
  ];
  const d = valuePortfolio(trades, { G: [bar("2026-06-01", 10)], SPY: cal.map(x => bar(x, 1)) }, cal);
  assert.equal(d[1].invested, 10); // G carried forward
  assert.deepEqual(d[1].missingPrices, ["NOPE"]);
});

test("required tickers include benchmark and traded symbols only", () => {
  assert.deepEqual(requiredTickers([{ trade_date: "2026-01-01", type: "BUY", ticker: "msft", shares: 1, price: 1 }, { trade_date: "2026-01-01", type: "DEPOSIT", amount: 1 }], "spy"), ["MSFT", "SPY"]);
});
