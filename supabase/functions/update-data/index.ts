// PFW-SIF daily data job (Supabase Edge Function).
// 1. Reads the trade ledger.
// 2. Pulls end-of-day prices from Tiingo for every traded ticker and the benchmark.
// 3. Values the portfolio each trading day and computes monthly returns.
// 4. Publishes the monthly series (upsert, then remove stale rows).
// 5. Builds the holdings snapshot (positions, lots, dividends, closed positions, trade notes).
// 6. Builds the research snapshot (reports, returns since each pitch, scorecard, pipeline).
// Called by pg_cron after the US market close, or by hand with select public.run_data_job();
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildResearch, researchTickers, type PipelineIdea, type ResearchReport } from "./research.ts";
import { buildHoldings, type BenchmarkSector, type LedgerTrade, type Security } from "./holdings.ts";
import { LedgerError, monthlyReturns, requiredTickers, valuePortfolio, type DailyValue, type MonthlyReturn, type PriceBar } from "./core.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function fetchTiingo(ticker: string, startDate: string, token: string): Promise<PriceBar[]> {
  const symbol = ticker.replace(/\./g, "-"); // BRK.B -> BRK-B
  const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${startDate}&format=json&token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (res.status === 401 || res.status === 403) throw new Error("Tiingo rejected the API key. Check tiingo_api_key in app_secrets.");
  if (res.status === 404) throw new Error(`Tiingo has no price history for ${ticker}. Check the ticker in the trades table.`);
  if (res.status === 429) throw new Error("Tiingo request limit reached. The job will retry on its next run.");
  if (!res.ok) throw new Error(`Tiingo returned ${res.status} for ${ticker}.`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error(`Unexpected Tiingo response for ${ticker}.`);
  return rows.map((r: Record<string, number | string>) => ({
    date: String(r.date).slice(0, 10),
    close: Number(r.close),
    adjClose: Number(r.adjClose),
    divCash: Number(r.divCash) || 0,
    splitFactor: Number(r.splitFactor) || 1,
  })).filter(b => b.close > 0 && b.adjClose > 0);
}

async function publish(db: ReturnType<typeof createClient>, daily: DailyValue[], monthly: MonthlyReturn[]) {
  // Upsert first, then remove rows that no longer exist, so the public page never sees an empty table.
  const dRows = daily.map((d) => ({ date: d.date, value: d.value, cash: d.cash, invested: d.invested, net_flow: d.netFlow }));
  const mRows = monthly.map((m) => ({ month: m.month, period_start: m.periodStart, period_end: m.periodEnd, bmv: m.bmv, emv: m.emv, net_flow: m.netFlow, portfolio_return: m.portfolioReturn, benchmark_return: m.benchmarkReturn, is_partial: m.isPartial, trading_days: m.tradingDays }));
  for (let i = 0; i < dRows.length; i += 1000) {
    const { error } = await db.from("daily_values").upsert(dRows.slice(i, i + 1000));
    if (error) throw new Error("Could not save daily values: " + error.message);
  }
  if (mRows.length) {
    const { error } = await db.from("monthly_returns").upsert(mRows);
    if (error) throw new Error("Could not publish monthly returns: " + error.message);
  }
  const firstDay = daily[0]?.date, lastDay = daily[daily.length - 1]?.date;
  const months = mRows.map((m) => m.month);
  if (firstDay) {
    await db.from("daily_values").delete().lt("date", firstDay);
    await db.from("daily_values").delete().gt("date", lastDay!);
  } else {
    await db.from("daily_values").delete().gte("date", "1900-01-01");
  }
  if (months.length) await db.from("monthly_returns").delete().not("month", "in", `(${months.map((m) => `"${m}"`).join(",")})`);
  else await db.from("monthly_returns").delete().gte("month", "");
}

async function publishSnapshot(db: ReturnType<typeof createClient>, holdings: unknown, id = "holdings") {
  const { error } = await db.from("public_snapshots").upsert({ id, data: holdings, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not publish ${id}: ` + error.message);
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Only the scheduled job (which sends the shared secret) may run this.
  const { data: secretRows, error: secretErr } = await db.from("app_secrets").select("key, value");
  if (secretErr) return json({ ok: false, error: "Could not read configuration." }, 500);
  const secrets = Object.fromEntries((secretRows ?? []).map((r) => [r.key, r.value]));
  if (!secrets.job_secret || req.headers.get("x-job-secret") !== secrets.job_secret) {
    return json({ ok: false, error: "Not authorized." }, 401);
  }

  const { data: run } = await db.from("job_runs").insert({ status: "running" }).select("id").single();
  const finish = async (status: "ok" | "warning" | "error", message: string) => {
    if (run) await db.from("job_runs").update({ status, message, finished_at: new Date().toISOString() }).eq("id", run.id);
    await db.from("fund_profile").update({ last_status: status, last_message: message, last_updated: new Date().toISOString() }).eq("id", 1);
    return json({ ok: status !== "error", status, message }, status === "error" ? 500 : 200);
  };

  try {
    const { data: profile, error: pErr } = await db.from("fund_profile").select("*").eq("id", 1).single();
    if (pErr || !profile) throw new Error("fund_profile row is missing.");
    const { data: tradeRows, error: tErr } = await db.from("trades").select("*").order("trade_date").order("id");
    if (tErr) throw new Error("Could not read the trades table.");

    const trades: LedgerTrade[] = (tradeRows ?? []).map((t) => ({
      trade_date: String(t.trade_date), type: t.type, ticker: t.ticker, shares: t.shares,
      price: t.price, amount: t.amount, fees: t.fees,
      note: t.note, rationale: t.rationale, team: t.team, approved_date: t.approved_date,
      report_title: t.report_title, report_url: t.report_url,
    }));
    const { data: secRows, error: sErr } = await db.from("securities").select("*");
    if (sErr) throw new Error("Could not read the securities table.");
    const { data: bsRows, error: bErr } = await db.from("benchmark_sectors").select("*");
    if (bErr) throw new Error("Could not read the benchmark_sectors table.");
    const securities = (secRows ?? []) as Security[];
    const benchmarkSectors = (bsRows ?? []).map((b) => ({ ...b, weight: Number(b.weight), as_of: String(b.as_of) })) as BenchmarkSector[];

    const { data: repRows, error: rErr } = await db.from("research_reports").select("*");
    if (rErr) throw new Error("Could not read the research_reports table.");
    const { data: pipeRows, error: piErr } = await db.from("research_pipeline").select("*");
    if (piErr) throw new Error("Could not read the research_pipeline table.");
    const reports = (repRows ?? []).map((r) => ({ ...r, published_date: String(r.published_date), price_at_pitch: r.price_at_pitch === null ? null : Number(r.price_at_pitch), target_price: r.target_price === null ? null : Number(r.target_price) })) as ResearchReport[];
    const pipeline = (pipeRows ?? []) as PipelineIdea[];

    const bench = String(profile.benchmark_ticker || "SPY").toUpperCase();
    const token = (secrets.tiingo_api_key || "").trim();
    const resTickers = researchTickers(reports);
    const prices: Record<string, PriceBar[]> = {};
    const researchWarnings: string[] = [];
    const day = (d: string, back: number) => isoDay(new Date(Date.parse(d + "T00:00:00Z") - back * 86400000));

    // Research prices: fetched on their own so one bad research ticker never stops the job.
    const fetchResearch = async (have: Set<string>) => {
      if (!token || !reports.length) return;
      const earliest = reports.reduce((a, r) => (r.published_date < a ? r.published_date : a), reports[0].published_date);
      const start = day(earliest, 10);
      if (!prices[bench]) prices[bench] = await fetchTiingo(bench, start, token);
      for (const t of resTickers) {
        if (have.has(t)) continue;
        try { prices[t] = await fetchTiingo(t, start, token); }
        catch (e) { if (/API key|request limit/.test(String(e))) throw e; researchWarnings.push(t); }
      }
    };
    const publishResearch = async (held: string[]) => {
      await publishSnapshot(db, buildResearch({ reports, pipeline, prices, benchmarkTicker: bench, heldTickers: held }), "research");
    };

    if (!trades.length) {
      await publish(db, [], []);
      await publishSnapshot(db, buildHoldings({ trades: [], prices: {}, calendar: [], benchmarkTicker: "SPY", daily: [], monthlyReturns: [], securities, benchmarkSectors, policy: profile.policy ?? null }));
      await db.from("fund_profile").update({ data_through: null }).eq("id", 1);
      await fetchResearch(new Set());
      await publishResearch([]);
      if (resTickers.length && !token) return await finish("warning", "No trades recorded yet. Research returns need the Tiingo API key in app_secrets.");
      if (researchWarnings.length) return await finish("warning", `No trades recorded yet. Tiingo has no prices for these research tickers: ${researchWarnings.join(", ")}.`);
      return await finish("ok", "No trades recorded yet. Add the opening DEPOSIT to the trades table." + (reports.length ? ` Research: ${reports.length} reports published.` : ""));
    }

    if (!token) throw new Error("Add your Tiingo API key to app_secrets (key: tiingo_api_key).");

    const first = trades[0].trade_date;
    // A year of history before inception, for trailing beta and trailing dividends.
    // Reach back further if a research report predates that window.
    const earliestReport = reports.reduce((a, r) => (r.published_date < a ? r.published_date : a), "9999-12-31");
    const start = [day(first, 400), day(earliestReport, 10)].sort()[0];
    const tickers = requiredTickers(trades, bench);

    // Full history each run, so adjusted closes stay consistent after new dividends.
    for (const t of tickers) prices[t] = await fetchTiingo(t, start, token);
    // Research tickers the fund never traded.
    await fetchResearch(new Set(tickers));

    const priceRows = Object.entries(prices).flatMap(([ticker, bars]) =>
      bars.map((b) => ({ ticker, date: b.date, close: b.close, adj_close: b.adjClose, div_cash: b.divCash, split_factor: b.splitFactor })));
    for (let i = 0; i < priceRows.length; i += 1000) {
      const { error } = await db.from("prices").upsert(priceRows.slice(i, i + 1000));
      if (error) throw new Error("Could not save prices: " + error.message);
    }

    const calendar = prices[bench].map((b) => b.date);
    if (!calendar.length) throw new Error(`No ${bench} prices returned for the period since ${first}.`);

    const daily = valuePortfolio(trades, prices, calendar);
    const monthly = monthlyReturns(daily, prices[bench], isoDay(new Date()));
    await publish(db, daily, monthly);
    const holdings = buildHoldings({
      trades, prices, calendar, benchmarkTicker: bench, daily,
      monthlyReturns: monthly.map((m) => m.portfolioReturn), securities, benchmarkSectors, policy: profile.policy ?? null,
    });
    await publishSnapshot(db, holdings);
    await publishResearch(holdings.positions.map((p) => p.t));

    const last = daily[daily.length - 1];
    await db.from("fund_profile").update({
      data_through: last?.date ?? null,
      inception_date: first,
    }).eq("id", 1);

    const negative = daily.find((d) => d.cash < -0.01);
    const unclassified = [...new Set(trades.filter((t) => t.ticker).map((t) => String(t.ticker).toUpperCase()))].filter((t) => !securities.some((s) => s.ticker.toUpperCase() === t));
    if (last?.missingPrices.length) return await finish("warning", `Updated through ${last.date}, but no price was found for: ${last.missingPrices.join(", ")}.`);
    if (negative) return await finish("warning", `Updated through ${last.date}, but cash went negative on ${negative.date}. Check for a missing DEPOSIT.`);
    if (researchWarnings.length) return await finish("warning", `Updated through ${last.date}, but Tiingo has no prices for these research tickers: ${researchWarnings.join(", ")}.`);
    if (unclassified.length) return await finish("warning", `Updated through ${last.date}, but these tickers have no row in securities (name and sector): ${unclassified.join(", ")}.`);
    return await finish("ok", `Updated through ${last.date}: ${monthly.length} months, ${tickers.length} tickers.`);
  } catch (e) {
    const msg = e instanceof LedgerError ? "Trade ledger problem: " + e.message : (e instanceof Error ? e.message : String(e));
    return await finish("error", msg);
  }
});
