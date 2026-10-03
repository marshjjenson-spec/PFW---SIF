// Run: node --experimental-strip-types --test tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PriceBar } from "../supabase/functions/update-data/core.ts";
import { barOnOrBefore, buildResearch, researchTickers, type ResearchReport } from "../supabase/functions/update-data/research.ts";

const bar = (date: string, close: number, adjClose = close): PriceBar => ({ date, close, adjClose, divCash: 0, splitFactor: 1 });
const near = (a: unknown, b: number, tol = 1e-6) => assert.ok(typeof a === "number" && Math.abs(a - b) < tol, `${a} != ${b}`);
const SPY = [bar("2026-01-02", 500), bar("2026-02-02", 510), bar("2026-03-02", 520), bar("2026-04-01", 550)];
const rep = (o: Partial<ResearchReport>): ResearchReport => ({ id: 1, title: "T", report_type: "Initiation", published_date: "2026-01-02", ...o });

test("pitch price is the close on or before the publication date, within a week", () => {
  const bars = [bar("2026-01-02", 10), bar("2026-01-05", 11)];
  assert.equal(barOnOrBefore(bars, "2026-01-04")!.close, 10); // weekend -> Friday
  assert.equal(barOnOrBefore(bars, "2026-01-01"), null);       // before history
  assert.equal(barOnOrBefore(bars, "2026-01-20"), null);       // more than a week stale
});

test("return since pitch uses adjusted closes and is compared with the benchmark over the same dates", () => {
  const out = buildResearch({
    reports: [rep({ ticker: "abc", recommendation: "Buy", decision: "Approved", target_price: 15 })],
    pipeline: [], benchmarkTicker: "SPY", heldTickers: ["ABC"],
    prices: { SPY, ABC: [bar("2026-01-02", 10, 9), bar("2026-04-01", 12, 11.7)] },
  });
  const r = out.reports[0];
  near(r.price_at_pitch, 10); assert.equal(r.price_source, "close");
  near(r.return_since, 11.7 / 9 - 1); near(r.benchmark_return_since, 0.1); near(r.active_since, 11.7 / 9 - 1 - 0.1);
  near(r.upside_at_pitch, 0.5); assert.equal(r.held, true); assert.equal(r.ticker, "ABC"); near(r.last_price, 12);
});

test("an entered pitch price is shown but returns still use closing prices", () => {
  const out = buildResearch({ reports: [rep({ ticker: "X", price_at_pitch: 9.5, target_price: 19 })], pipeline: [], benchmarkTicker: "SPY", heldTickers: [],
    prices: { SPY, X: [bar("2026-01-02", 10), bar("2026-04-01", 11)] } });
  near(out.reports[0].price_at_pitch, 9.5); assert.equal(out.reports[0].price_source, "entered"); near(out.reports[0].upside_at_pitch, 1); near(out.reports[0].return_since, 0.1);
});

test("no prices, sector pieces and same-day pitches give N/A rather than a number", () => {
  const out = buildResearch({ reports: [
    rep({ id: 1, ticker: "NOPE" }), rep({ id: 2, report_type: "Sector review", sector: "Energy" }), rep({ id: 3, ticker: "NEW", published_date: "2026-04-01" }),
  ], pipeline: [], benchmarkTicker: "SPY", heldTickers: [], prices: { SPY, NEW: [bar("2026-04-01", 5)] } });
  for (const r of out.reports) { assert.equal(r.return_since, null); assert.equal(r.active_since, null); }
  assert.equal(out.reports.find(r => r.id === 2)!.ticker, null);
});

test("scorecard: approval rate, averages and beat rate over Buy-rated decided pitches only", () => {
  const prices = { SPY, A: [bar("2026-01-02", 10), bar("2026-04-01", 13)], B: [bar("2026-01-02", 10), bar("2026-04-01", 10.5)], C: [bar("2026-01-02", 10), bar("2026-04-01", 9)], D: [bar("2026-01-02", 10), bar("2026-04-01", 20)] };
  const out = buildResearch({ reports: [
    rep({ id: 1, ticker: "A", recommendation: "Buy", decision: "Approved" }),       // +30% vs +10%
    rep({ id: 2, ticker: "B", recommendation: "Buy", decision: "Approved" }),       // +5%
    rep({ id: 3, ticker: "C", recommendation: "Buy", decision: "Not approved" }),   // -10%
    rep({ id: 4, ticker: "D", recommendation: "Sell", decision: "Approved" }),      // excluded from scorecard averages
    rep({ id: 5, ticker: "A", recommendation: "Buy", decision: "Pending" }),
    rep({ id: 6, report_type: "Macro outlook", sector: "Macro" }),
  ], pipeline: [], benchmarkTicker: "SPY", heldTickers: [], prices });
  const s = out.scorecard;
  assert.equal(s.reports, 6); assert.equal(s.pitches, 5); assert.equal(s.approved, 3); assert.equal(s.not_approved, 1); assert.equal(s.pending, 1);
  near(s.approval_rate, 3 / 4);
  assert.equal(s.approved_ideas.count, 2); near(s.approved_ideas.avg_return, 0.175); near(s.approved_ideas.avg_active, 0.075); near(s.approved_ideas.beat_rate, 0.5);
  assert.equal(s.rejected_ideas.count, 1); near(s.rejected_ideas.avg_active, -0.2); near(s.rejected_ideas.beat_rate, 0);
});

test("empty input gives an empty, null-safe snapshot", () => {
  const out = buildResearch({ reports: [], pipeline: [], benchmarkTicker: "SPY", heldTickers: [], prices: {} });
  assert.equal(out.reports.length, 0); assert.equal(out.scorecard.approval_rate, null); assert.equal(out.scorecard.approved_ideas.avg_return, null); assert.equal(out.as_of, null);
});

test("reports sort newest first; coverage counts by sector; pipeline sorts by stage then date", () => {
  const out = buildResearch({ reports: [
    rep({ id: 1, sector: "Energy", published_date: "2026-01-02" }), rep({ id: 2, sector: "Energy", published_date: "2026-03-02" }), rep({ id: 3, sector: "Health Care", published_date: "2026-02-02" }),
  ], pipeline: [
    { id: 1, ticker: "wm", company: "Waste Management", stage: "Researching" },
    { id: 2, ticker: "TJX", company: "TJX", stage: "Pitch scheduled", pitch_date: "2026-10-29" },
    { id: 3, ticker: "ADBE", company: "Adobe", stage: "Committee vote", pitch_date: "2026-10-15" },
  ], benchmarkTicker: "SPY", heldTickers: [], prices: { SPY } });
  assert.deepEqual(out.reports.map(r => r.id), [2, 3, 1]);
  assert.deepEqual(out.coverage.map(c => [c.sector, c.reports, c.latest]), [["Energy", 2, "2026-03-02"], ["Health Care", 1, "2026-02-02"]]);
  assert.deepEqual(out.pipeline.map(p => p.ticker), ["ADBE", "TJX", "WM"]);
});

test("researchTickers dedupes and uppercases", () => {
  assert.deepEqual(researchTickers([rep({ ticker: "msft" }), rep({ ticker: "MSFT" }), rep({ ticker: null }), rep({ ticker: "aapl " })]), ["AAPL", "MSFT"]);
});
