// PFW-SIF research core: publishes research reports and the pitch pipeline with
// each idea's total return since it was pitched, compared with the benchmark over
// the same dates. Pure functions only (runs in Deno and Node).
import type { PriceBar } from "./core.ts";

export interface ResearchReport {
  id: number;
  title: string;
  report_type: string;
  ticker?: string | null;
  company?: string | null;
  sector?: string | null;
  published_date: string;
  team?: string | null;
  authors?: string | null;
  summary?: string | null;
  recommendation?: string | null;
  decision?: string | null;
  decision_date?: string | null;
  price_at_pitch?: number | null;
  target_price?: number | null;
  report_url?: string | null;
  featured?: boolean | null;
}

export interface PipelineIdea {
  id: number;
  ticker: string;
  company: string;
  team?: string | null;
  stage: string;
  pitch_date?: string | null;
  idea?: string | null;
}

const DAY = 86400000;
const toDay = (d: string) => Math.floor(Date.parse(d + "T00:00:00Z") / DAY);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const STALE_DAYS = 7; // a pitch-date price must be within a week of the pitch

/** The last bar on or before `date`, if it is no more than a week earlier. */
export function barOnOrBefore(bars: PriceBar[], date: string): PriceBar | null {
  let best: PriceBar | null = null;
  for (const b of bars) if (b.date <= date && (!best || b.date > best.date)) best = b;
  if (!best || toDay(date) - toDay(best.date) > STALE_DAYS) return null;
  return best;
}

const lastBar = (bars: PriceBar[]) => bars.reduce<PriceBar | null>((a, b) => (!a || b.date > a.date ? b : a), null);
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export interface ResearchInput {
  reports: ResearchReport[];
  pipeline: PipelineIdea[];
  prices: Record<string, PriceBar[]>;
  benchmarkTicker: string;
  heldTickers: string[];
}

export function buildResearch(inp: ResearchInput) {
  const P: Record<string, PriceBar[]> = {};
  for (const [t, b] of Object.entries(inp.prices)) P[t.toUpperCase()] = b;
  const bench = P[inp.benchmarkTicker.toUpperCase()] || [];
  const benchLast = lastBar(bench);
  const held = new Set(inp.heldTickers.map(t => t.toUpperCase()));

  const reports = [...inp.reports].sort((a, b) => b.published_date.localeCompare(a.published_date) || b.id - a.id).map(r => {
    const t = r.ticker ? String(r.ticker).toUpperCase().trim() : null;
    const bars = t ? P[t] || [] : [];
    const at = t ? barOnOrBefore(bars, r.published_date) : null;
    const now = t ? lastBar(bars) : null;
    const bAt = barOnOrBefore(bench, r.published_date);
    const entered = r.price_at_pitch !== null && r.price_at_pitch !== undefined && Number(r.price_at_pitch) > 0 ? Number(r.price_at_pitch) : null;
    const pitchPrice = entered ?? (at ? at.close : null);
    const canMeasure = !!(at && now && now.date > at.date && at.adjClose > 0);
    const ret = canMeasure ? r6(now!.adjClose / at!.adjClose - 1) : null;
    const benchRet = canMeasure && bAt && benchLast && bAt.adjClose > 0 ? r6(benchLast.adjClose / bAt.adjClose - 1) : null;
    const target = r.target_price !== null && r.target_price !== undefined && Number(r.target_price) > 0 ? Number(r.target_price) : null;
    return {
      id: r.id, title: r.title, type: r.report_type, ticker: t, company: r.company || t, sector: r.sector || null,
      date: r.published_date, team: r.team || null, authors: r.authors || null, summary: r.summary || null,
      recommendation: r.recommendation || null, decision: r.decision || null, decision_date: r.decision_date || null,
      price_at_pitch: pitchPrice === null ? null : r6(pitchPrice), price_source: entered !== null ? "entered" : pitchPrice !== null ? "close" : null,
      target_price: target, upside_at_pitch: target && pitchPrice ? r6(target / pitchPrice - 1) : null,
      last_price: now ? now.close : null, last_date: now ? now.date : null,
      return_since: ret, benchmark_return_since: benchRet, active_since: ret !== null && benchRet !== null ? r6(ret - benchRet) : null,
      held: t ? held.has(t) : false, url: r.report_url || null, featured: !!r.featured,
    };
  });

  // Scorecard: Buy-rated pitches with a committee decision and a measurable return.
  const scored = (d: string) => reports.filter(r => r.recommendation === "Buy" && r.decision === d && r.active_since !== null);
  const appr = scored("Approved"), rej = scored("Not approved");
  const pitches = reports.filter(r => r.decision);
  const decided = pitches.filter(r => r.decision === "Approved" || r.decision === "Not approved");
  const nAppr = pitches.filter(r => r.decision === "Approved").length;
  const group = (g: typeof appr) => ({
    count: g.length,
    avg_return: g.length ? r6(mean(g.map(r => r.return_since!))!) : null,
    avg_benchmark: g.length ? r6(mean(g.map(r => r.benchmark_return_since!))!) : null,
    avg_active: g.length ? r6(mean(g.map(r => r.active_since!))!) : null,
    beat_rate: g.length ? r6(g.filter(r => r.active_since! > 0).length / g.length) : null,
  });

  const cov: Record<string, { sector: string; reports: number; latest: string }> = {};
  for (const r of reports) {
    if (!r.sector) continue;
    const c = cov[r.sector] ||= { sector: r.sector, reports: 0, latest: r.date };
    c.reports++; if (r.date > c.latest) c.latest = r.date;
  }

  const order = { "Committee vote": 0, "Pitch scheduled": 1, "Researching": 2 } as Record<string, number>;
  const pipeline = [...inp.pipeline].sort((a, b) => (order[a.stage] ?? 9) - (order[b.stage] ?? 9) || String(a.pitch_date || "9999").localeCompare(String(b.pitch_date || "9999")))
    .map(p => ({ ticker: String(p.ticker).toUpperCase(), company: p.company, team: p.team || null, stage: p.stage, pitch_date: p.pitch_date || null, idea: p.idea || null }));

  return {
    as_of: benchLast ? benchLast.date : null,
    reports,
    pipeline,
    scorecard: {
      reports: reports.length,
      pitches: pitches.length,
      approved: nAppr,
      not_approved: pitches.filter(r => r.decision === "Not approved").length,
      pending: pitches.filter(r => r.decision === "Pending").length,
      approval_rate: decided.length ? r6(nAppr / decided.length) : null,
      approved_ideas: group(appr),
      rejected_ideas: group(rej),
    },
    coverage: Object.values(cov).sort((a, b) => b.reports - a.reports || a.sector.localeCompare(b.sector)),
    methodology: {
      return_since: "Total return (dividends reinvested) from the close on or before the publication date to the latest close",
      benchmark: inp.benchmarkTicker.toUpperCase() + " total return over the same dates",
      scorecard: "Buy-rated pitches with a committee decision; simple averages",
    },
  };
}

/** Tickers that research needs prices for. */
export function researchTickers(reports: ResearchReport[]): string[] {
  return [...new Set(reports.map(r => (r.ticker ? String(r.ticker).toUpperCase().trim() : "")).filter(Boolean))].sort();
}
