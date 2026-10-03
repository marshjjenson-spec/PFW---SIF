// Run: node --experimental-strip-types --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { monthEndPositions, valuePortfolio, type PriceBar, type Trade } from "../supabase/functions/update-data/core.ts";

const bar = (date: string, close: number, divCash = 0, splitFactor = 1): PriceBar => ({ date, close, adjClose: close, divCash, splitFactor });

test("month-end positions: value, monthly change and percent for each holding", () => {
  const cal = ["2026-01-02", "2026-01-30", "2026-02-02", "2026-02-27"];
  const trades: Trade[] = [
    { trade_date: "2026-01-02", type: "DEPOSIT", amount: 10000 },
    { trade_date: "2026-01-02", type: "BUY", ticker: "abc", shares: 50, price: 100, fees: 0 },
    { trade_date: "2026-02-02", type: "BUY", ticker: "XYZ", shares: 10, price: 200 },
  ];
  const prices = {
    ABC: [bar("2026-01-02", 100), bar("2026-01-30", 110), bar("2026-02-02", 108), bar("2026-02-27", 99)],
    XYZ: [bar("2026-02-02", 200), bar("2026-02-27", 210)],
    SPY: cal.map(x => bar(x, 500)),
  };
  const m = monthEndPositions(trades, prices, cal);
  assert.deepEqual(m.map(x => x.month), ["2026-01", "2026-02"]);
  const jan = m[0].positions.find(p => p.t === "ABC")!;
  assert.equal(jan.value, 5500); assert.equal(jan.change, 500); assert.equal(jan.changePct, 0.1);
  const feb = Object.fromEntries(m[1].positions.map(p => [p.t, p]));
  assert.equal(feb.ABC.startValue, 5500); assert.equal(feb.ABC.value, 4950); assert.equal(feb.ABC.change, -550); assert.equal(feb.ABC.changePct, -0.1);
  assert.equal(feb.XYZ.startValue, 0); assert.equal(feb.XYZ.bought, 2000); assert.equal(feb.XYZ.change, 100); assert.equal(feb.XYZ.changePct, 0.05);
  // Totals match the daily valuation on the same close.
  const daily = valuePortfolio(trades, prices, cal);
  assert.equal(m[1].value, daily[daily.length - 1].value);
  assert.equal(m[1].cash, 3000); // 10,000 − 5,000 − 2,000
});

test("month-end positions: dividends count toward the change; splits rescale shares", () => {
  const cal = ["2026-03-02", "2026-03-31", "2026-04-15", "2026-04-30"];
  const trades: Trade[] = [
    { trade_date: "2026-03-02", type: "DEPOSIT", amount: 1000 },
    { trade_date: "2026-03-02", type: "BUY", ticker: "D", shares: 10, price: 100 },
  ];
  const prices = { D: [bar("2026-03-02", 100), bar("2026-03-31", 100), bar("2026-04-15", 50, 1, 2), bar("2026-04-30", 51)], SPY: cal.map(x => bar(x, 1)) };
  const apr = monthEndPositions(trades, prices, cal)[1].positions[0];
  assert.equal(apr.shares, 20);
  assert.equal(apr.dividends, 20);         // $1 on 20 post-split shares
  assert.equal(apr.change, 20 * 51 - 1000 + 20);
});

test("month-end positions: a position sold during the month shows its realized change", () => {
  const cal = ["2026-05-01", "2026-05-29", "2026-06-10", "2026-06-30"];
  const trades: Trade[] = [
    { trade_date: "2026-05-01", type: "DEPOSIT", amount: 1000 },
    { trade_date: "2026-05-01", type: "BUY", ticker: "S", shares: 10, price: 100 },
    { trade_date: "2026-06-10", type: "SELL", ticker: "S", shares: 10, price: 90 },
  ];
  const prices = { S: [bar("2026-05-01", 100), bar("2026-05-29", 95), bar("2026-06-10", 90), bar("2026-06-30", 92)], SPY: cal.map(x => bar(x, 1)) };
  const jun = monthEndPositions(trades, prices, cal)[1].positions[0];
  assert.equal(jun.shares, 0); assert.equal(jun.value, 0); assert.equal(jun.sold, 900); assert.equal(jun.change, -50);
});
