// Builds the research report pages in site/reports/ from:
//   tools/reports-content.mjs  the written research (thesis, catalysts, risks, committee notes)
//   tools/report-data.json     filed financials and market data (made by fetch-report-data.mjs)
//
//   node tools/build-reports.mjs
//
// Every page is static HTML with inline SVG charts, so it needs no scripts or database access.
// Page 1 is a one-page "PFW-SIF Investment Review"; page 2 is the full investment case.
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { reports } from "./reports-content.mjs";

const DATA = JSON.parse(readFileSync(new URL("./report-data.json", import.meta.url), "utf8"));
const OUT = new URL("../site/reports/", import.meta.url);
mkdirSync(OUT, { recursive: true });

// Shown as "Analyst" in the committee box on every report.
const ANALYST = "Marshall Jenson";

/* Five-year DCF assumptions by report (PFW-SIF estimates).
   The base year is the latest fiscal year in the company's filings on or before the report date.
     g      revenue growth in years 1–5
     m      operating (EBIT) margin reached in year 5, moving in a straight line from the base year
     capex  capital spending as % of revenue in year 5, moving in a straight line from the base year
     da     depreciation & amortization as % of revenue (base-year ratio unless set)
     nwc    change in net working capital as % of the change in revenue (negative = suppliers fund growth)
     tax    tax rate on operating income
     exit   EV/EBITDA multiple applied to year-5 EBITDA for the terminal value (the implied
            perpetual growth rate is shown as a check)
   Free cash flow = EBIT × (1 − tax) + D&A − capex − change in NWC.
   Discount rate = 10-year Treasury yield on the report date + beta × 5.0% equity risk premium
   (beta from 36 monthly returns vs SPY), kept between 8% and 12%.
   A null entry means operating income is not reported in a way a DCF can use. */
const ERP = 0.05;
const DCF = {
  "aapl-2015-initiation": { g: [-0.03, 0.05, 0.05, 0.04, 0.04], m: 0.28, capex: 0.05, nwc: 0, tax: 0.25, exit: 9, why: "A small iPhone decline next year, then mid-single-digit growth led by Services, with margins easing slightly" },
  "googl-2016-initiation": { g: [0.15, 0.14, 0.13, 0.12, 0.11], m: 0.28, capex: 0.12, nwc: 0.02, tax: 0.19, exit: 14, da: 0.07, why: "Mid-teens revenue growth from mobile search and YouTube, with capital spending falling as a share of revenue" },
  "intc-2016-pitch": { g: [0.02, 0.03, 0.03, 0.03, 0.03], m: 0.26, capex: 0.14, nwc: 0.02, tax: 0.22, exit: 8, why: "Low growth as data center gains offset the PC decline, with steady margins" },
  "amzn-2018-initiation": { g: [0.3, 0.25, 0.22, 0.2, 0.18], m: 0.06, capex: 0.07, nwc: -0.05, tax: 0.21, exit: 18, why: "Revenue growth slowing from 30%, with AWS and advertising lifting the operating margin to 6%" },
  "ge-2018-pitch": null,
  "amd-2024-initiation": { g: [0.15, 0.3, 0.25, 0.2, 0.18], m: 0.22, capex: 0.03, nwc: 0.05, tax: 0.13, exit: 20, why: "AI accelerators driving 20%+ growth and a GAAP operating margin rising toward 22% as acquisition amortization fades" },
  "aapl-2026-review": { g: [0.06, 0.05, 0.05, 0.05, 0.04], m: 0.33, capex: 0.03, nwc: 0, tax: 0.16, exit: 20, why: "Mid-single-digit growth led by Services, with stable margins" },
  "googl-2026-review": { g: [0.12, 0.11, 0.1, 0.09, 0.08], m: 0.33, capex: 0.18, nwc: 0.02, tax: 0.17, exit: 16, why: "Low-double-digit growth from Search, Cloud and YouTube, with AI capital spending easing from today's peak" },
  "amzn-2026-review": { g: [0.1, 0.1, 0.09, 0.09, 0.08], m: 0.14, capex: 0.13, nwc: -0.03, tax: 0.17, exit: 14, why: "About 10% growth with AWS and advertising lifting margins, and AI capital spending easing from today's peak" },
  "amd-2026-review": { g: [0.35, 0.3, 0.25, 0.2, 0.15], m: 0.3, capex: 0.04, nwc: 0.05, tax: 0.13, exit: 24, why: "Multi-year accelerator agreements shipping in volume, with the operating margin rising to 30%" },
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtDate = (d, long) => { const [y, m, dd] = d.split("-").map(Number); return `${(long ? MONTHS : MON)[m - 1]} ${dd}, ${y}`; };
const money = (v, d = 2) => (v == null ? "—" : (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const bn = (v) => (v == null ? "—" : (v < 0 ? "−" : "") + "$" + (Math.abs(v) / 1e9).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "B");
const capFmt = (v) => (v == null ? "—" : v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : "$" + Math.round(v / 1e9) + "B");
const pct = (v, d = 1, sign = false) => (v == null || !Number.isFinite(v) ? "—" : (v < 0 ? "−" : sign && v > 0 ? "+" : "") + Math.abs(v * 100).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%");
const mult = (v) => (v == null || !Number.isFinite(v) || v <= 0 ? "n/m" : v.toFixed(1) + "x");
const fyLabel = (end) => "FY" + end.slice(0, 4);

/* ---------------- Charts (inline SVG) ---------------- */
function lineChart(points, { lines, refs = [], markers = [], height = 230, yFmt = (v) => v.toFixed(0), legend }) {
  const W = 640, H = height, L = 44, R = 12, T = 14, B = 26;
  const xs = points.map((p) => Date.parse(p[0]));
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const vals = lines.flatMap((l) => points.map(l.get)).concat(refs.map((r) => r.value));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const X = (t) => L + ((t - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  // Gridlines at round steps.
  const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  let grid = "";
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="g"/><text x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" class="ya">${esc(yFmt(v))}</text>`;
  // Year ticks.
  const y0 = new Date(x0).getUTCFullYear(), y1 = new Date(x1).getUTCFullYear();
  const every = Math.max(1, Math.ceil((y1 - y0 + 1) / 7));
  let ticks = "";
  if (y1 - y0 >= 1) { for (let y = y0 + 1; y <= y1; y += every) { const t = Date.UTC(y, 0, 1); if (t > x0 && t < x1) ticks += `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${H - B}" y2="${H - B + 4}" class="ax"/><text x="${X(t).toFixed(1)}" y="${H - 8}" class="xa">${y}</text>`; } }
  else { for (let i = 0; i < points.length; i += Math.ceil(points.length / 6)) { const [yy, mm] = points[i][0].split("-").map(Number); ticks += `<text x="${X(xs[i]).toFixed(1)}" y="${H - 8}" class="xa">${MON[mm - 1]} ${String(yy).slice(2)}</text>`; } }
  const paths = lines.map((l) => `<path d="${points.map((p, i) => (i ? "L" : "M") + X(xs[i]).toFixed(1) + " " + Y(l.get(p)).toFixed(1)).join("")}" class="${l.cls}"/>`).join("");
  const refLines = refs.map((r) => `<line x1="${L}" x2="${W - R}" y1="${Y(r.value).toFixed(1)}" y2="${Y(r.value).toFixed(1)}" class="ref ${r.cls || ""}"/><text x="${W - R - 4}" y="${(Y(r.value) - 5).toFixed(1)}" class="rl">${esc(r.label)}</text>`).join("");
  const marks = markers.map((m) => { const t = Date.parse(m.date); if (t < x0 || t > x1) return ""; const p = points.reduce((a, q, i) => (Math.abs(xs[i] - t) < Math.abs(Date.parse(a[0]) - t) ? q : a)); return `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${T}" y2="${H - B}" class="mk"/><circle cx="${X(t).toFixed(1)}" cy="${Y(lines[0].get(p)).toFixed(1)}" r="3.5" class="dot"/><text x="${(X(t) + 5).toFixed(1)}" y="${T + 10}" class="ml">${esc(m.label)}</text>`; }).join("");
  // End-of-line value labels, pushed apart when the lines finish close together.
  const endY = lines.map((l) => Y(l.get(points[points.length - 1])) - 6);
  if (endY.length === 2 && Math.abs(endY[0] - endY[1]) < 13) { const mid = (endY[0] + endY[1]) / 2, up = endY[0] <= endY[1] ? -1 : 1; endY[0] = mid + up * 7; endY[1] = mid - up * 7; }
  const ends = lines.map((l, i) => { const v = l.get(points[points.length - 1]); return `<text x="${W - R}" y="${Math.max(T + 8, endY[i]).toFixed(1)}" class="el ${l.cls}-t">${esc(l.endLabel ? l.endLabel(v) : yFmt(v))}</text>`; }).join("");
  const leg = legend ? `<div class="legend">${legend.map(([cls, t]) => `<span><i class="${cls}"></i>${esc(t)}</span>`).join("")}</div>` : "";
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(legend ? legend.map((x) => x[1]).join(" vs ") : "chart")}">${grid}<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="ax"/>${ticks}${refLines}${paths}${marks}${ends}</svg>${leg}</figure>`;
}
const growthChart = (pts, ticker, markers = []) =>
  lineChart(pts, {
    lines: [{ get: (p) => p[1], cls: "ln-s", endLabel: (v) => "$" + v.toFixed(0) }, { get: (p) => p[2], cls: "ln-b", endLabel: (v) => "$" + v.toFixed(0) }],
    markers, yFmt: (v) => "$" + v.toFixed(0),
    legend: [["k-s", `${ticker} total return`], ["k-b", "S&P 500 Total Return (SPY)"]],
  });

/* ---------------- DCF ---------------- */
function dcf(slug, d) {
  const cfg = DCF[slug];
  const m = d.main, fy = m.fundamentals.fy, b = fy[fy.length - 1];
  if (!cfg || b.opInc == null || !b.revenue) return { na: true, reason: "GE does not report a company-wide operating income line (its results combine industrial businesses with GE Capital), so a five-year DCF on operating income is not meaningful. The target is based on the earnings multiple on page 2." };
  const beta = m.beta ?? 1;
  const capm = d.riskFree + beta * ERP;
  const wacc = Math.min(0.12, Math.max(0.08, capm));
  const m0 = b.opInc / b.revenue, c0 = b.capex / b.revenue;
  const daPct = cfg.da ?? (b.da != null ? b.da / b.revenue : c0 * 0.6);
  const cash = b.cashInv ?? 0, debt = b.debt ?? 0;
  const run = (r, exit) => {
    let rev = b.revenue; const years = [];
    for (let t = 1; t <= 5; t++) {
      const prev = rev; rev *= 1 + cfg.g[t - 1];
      const margin = m0 + ((cfg.m - m0) * t) / 5, capexPct = c0 + ((cfg.capex - c0) * t) / 5;
      const ebit = rev * margin, taxes = ebit * cfg.tax, da = rev * daPct, capex = rev * capexPct, dnwc = cfg.nwc * (rev - prev);
      const fcf = ebit - taxes + da - capex - dnwc;
      years.push({ t, rev, g: cfg.g[t - 1], ebit, margin, taxes, da, capex, dnwc, fcf, pv: fcf / (1 + r) ** t });
    }
    const y5 = years[4], tv = (y5.ebit + y5.da) * exit, pvTv = tv / (1 + r) ** 5;
    const impliedG = (tv * r - y5.fcf) / (tv + y5.fcf);
    const ev = years.reduce((s, y) => s + y.pv, 0) + pvTv;
    const equity = ev + cash - debt;
    return { years, tv, pvTv, ev, equity, impliedG, perShare: equity / m.shares };
  };
  const base = run(wacc, cfg.exit);
  const grid = [-0.01, 0, 0.01].map((dw) => [-2, 0, 2].map((dx) => run(wacc + dw, cfg.exit + dx).perShare));
  return { ...cfg, beta, capm, wacc, base, grid, b, m0, c0, daPct, cash, debt, shares: m.shares, rf: d.riskFree };
}

/* ---------------- Page 1 pieces ---------------- */
const SIM = "Simulated, retrospective case study for the PFW-SIF student investment fund. The research is written as of the report date using information public at that time; the committee vote is part of the simulation and no real money was invested. Educational only; not investment advice.";
const signCls = (v) => (v == null || !Number.isFinite(v) ? "" : v > 0 ? "up" : v < 0 ? "dn" : "");

function keyDrivers(d) {
  const fy = d.main.fundamentals.fy, l = fy[fy.length - 1], p = fy[fy.length - 2] || {}, pp = fy[fy.length - 3] || {};
  const fcf = (x) => (x.ocf != null && x.capex != null ? x.ocf - x.capex : null);
  const gr = (a, b) => (a != null && b > 0 ? a / b - 1 : null);
  const g1 = gr(l.revenue, p.revenue), g0 = gr(p.revenue, pp.revenue);
  const o1 = gr(l.opInc, p.opInc), o0 = gr(p.opInc, pp.opInc);
  const m1 = l.opInc != null ? l.opInc / l.revenue : null, m0 = p.opInc != null && p.revenue ? p.opInc / p.revenue : null;
  const f1 = gr(fcf(l), fcf(p));
  // Outlook: direction of the latest year against the year before. View follows the outlook.
  const dir = (cur, prev, band) => (cur == null || prev == null ? null : cur > prev + band ? "Improving" : cur < prev - band ? "Declining" : "Steady");
  const rows = [
    ["Revenue", bn(l.revenue), g1 == null ? null : g1 > 0.03 ? "Improving" : g1 < -0.02 ? "Declining" : "Steady"],
    ["Revenue growth", pct(g1), dir(g1, g0, 0.02)],
    ["Operating income", bn(l.opInc), o1 == null ? null : o1 > 0.03 ? "Improving" : o1 < -0.03 ? "Declining" : "Steady"],
    ["Operating income growth", pct(o1), dir(o1, o0, 0.03)],
    ["Operating margin", pct(m1), dir(m1, m0, 0.01)],
    ["Free cash flow growth", pct(f1), f1 == null ? null : f1 > 0.05 ? "Improving" : f1 < -0.05 ? "Declining" : "Steady"],
  ];
  const view = { Improving: "Positive", Steady: "Neutral", Declining: "Negative" };
  return `<table class="tbl drv"><thead><tr><th>Investment drivers</th><th>${fyLabel(l.end)}</th><th>Outlook</th><th>PFW-SIF view</th></tr></thead><tbody>
${rows.map(([k, v, o]) => `<tr><td>${k}</td><td>${v}</td><td>${o || "—"}</td><td class="v-${(view[o] || "na").toLowerCase()}">${view[o] || "—"}</td></tr>`).join("\n")}
</tbody></table><p class="src">$ billions, from SEC filings made on or before ${fmtDate(d.asOf)}. Outlook compares ${fyLabel(l.end)} with the prior year; the view follows the outlook.</p>`;
}

function peerTable(d) {
  const cos = [d.main, ...d.peers];
  // [label, value, formatter, higher is better?]
  const rows = [
    ["Market cap", (c) => c.marketCap, capFmt, null],
    ["P/E ratio (trailing)", (c) => (c.pe > 0 ? c.pe : null), mult, false],
    ["Earnings per share", (c) => c.epsTtm, (v) => (v == null ? "—" : v.toFixed(2)), null],
    ["EPS growth (last FY)", (c) => c.epsGrowth, (v) => pct(v), true],
    ["ROIC", (c) => c.roic, (v) => (v == null ? "n/m" : v > 1 ? ">100%" : pct(v)), true],
    ["ROE", (c) => c.roe, (v) => (v == null ? "n/m" : v > 1 ? ">100%" : pct(v)), true],
    ["Gross margin", (c) => c.grossMargin, (v) => pct(v), true],
    ["Operating margin", (c) => c.opMargin, (v) => pct(v), true],
    ["Revenue growth", (c) => c.revGrowth, (v) => pct(v), true],
    ["EV / EBITDA", (c) => (c.evEbitda > 0 ? c.evEbitda : null), mult, false],
    ["Free cash flow growth", (c) => c.fcfGrowth, (v) => pct(v), true],
    ["Debt / equity", (c) => c.debtToEquity, (v) => (v == null ? "—" : v.toFixed(2)), false],
    ["Beta", (c) => c.beta, (v) => (v == null ? "—" : v.toFixed(2)), null],
    ["FCF yield", (c) => c.fcfYield, (v) => pct(v), true],
  ];
  const median = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
  const body = rows.map(([label, get, f, higher]) => {
    const vals = cos.map(get), med = median(vals);
    const cells = vals.map((v, i) => {
      let cls = i === 0 ? "hl" : "";
      if (higher != null && v != null && med != null && cos.length > 2 && Math.abs(v - med) > Math.abs(med) * 0.02) cls += (v > med) === higher ? " up" : " dn";
      return `<td class="${cls.trim()}">${f(v)}</td>`;
    }).join("");
    return `<tr><td>${label}</td>${cells}</tr>`;
  }).join("\n");
  return `<table class="tbl peers"><thead><tr><th>Investment drivers</th>${cos.map((c, i) => `<th${i === 0 ? ' class="hl"' : ""}>${esc(c.ticker)}</th>`).join("")}</tr></thead><tbody>
${body}
</tbody></table><p class="src">Prices on ${fmtDate(d.main.date)}; financials from each company's latest SEC filings as of that date. Green and red mark values better or worse than the group median. "n/m" = not meaningful.</p>`;
}

function dcfTable(v) {
  if (v.na) return `<p class="muted">${esc(v.reason)}</p>`;
  const y0 = +v.b.end.slice(0, 4), B = v.base, b = v.b;
  const f1 = (x) => (x / 1e9).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const neg = (x) => (x < 0 ? "−" + f1(-x) : f1(x));
  const cols = [`${y0}A`, ...B.years.map((y) => `${y0 + y.t}E`)];
  const baseFcf = b.ocf != null && b.capex != null ? b.ocf - b.capex : null;
  const row = (label, base, fn, cls = "") => `<tr class="${cls}"><td>${label}</td><td>${base}</td>${B.years.map((y) => `<td>${fn(y)}</td>`).join("")}</tr>`;
  const table = `<table class="tbl dcf"><thead><tr><th>$ billions</th>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>
${row("Revenue", f1(b.revenue), (y) => f1(y.rev), "strong")}
${row("% growth", pct(d0(v)), (y) => pct(y.g, 0), "sub")}
${row("EBIT", neg(b.opInc), (y) => neg(y.ebit))}
${row("% of revenue", pct(v.m0), (y) => pct(y.margin), "sub")}
${row("Taxes", "", (y) => neg(-y.taxes))}
${row("D&amp;A", b.da != null ? f1(b.da) : "—", (y) => f1(y.da))}
${row("CapEx", b.capex != null ? neg(-b.capex) : "—", (y) => neg(-y.capex))}
${row("Change in NWC", "", (y) => neg(-y.dnwc))}
${row("Free cash flow", baseFcf != null ? neg(baseFcf) : "—", (y) => neg(y.fcf), "strong")}
${row("PV of FCF", "", (y) => neg(y.pv))}
</tbody></table>`;
  const up = B.perShare / v.price - 1;
  const side = `<table class="tbl side"><tbody>
<tr><td>Discount rate</td><td>${pct(v.wacc)}</td></tr>
<tr><td>Exit EV / EBITDA</td><td>${v.exit}x</td></tr>
<tr><td>Implied perpetual growth</td><td>${pct(B.impliedG)}</td></tr>
<tr><td>PV of terminal value</td><td>${bn(B.pvTv)}</td></tr>
<tr><td>Enterprise value</td><td>${capFmt(B.ev)}</td></tr>
<tr><td>+ Cash &amp; investments</td><td>${bn(v.cash)}</td></tr>
<tr><td>− Debt</td><td>${bn(v.debt)}</td></tr>
<tr><td>Equity value</td><td>${capFmt(B.equity)}</td></tr>
<tr><td>Diluted shares</td><td>${(v.shares / 1e9).toFixed(2)}B</td></tr>
<tr class="strong"><td>Implied share price</td><td>${money(B.perShare)}</td></tr>
<tr><td>Current price</td><td>${money(v.price)}</td></tr>
<tr class="strong"><td>Upside / downside</td><td class="${signCls(up)}">${pct(up, 1, true)}</td></tr>
</tbody></table>`;
  return `<div class="dcfwrap">${table}${side}</div><p class="src">PFW-SIF assumptions: ${esc(v.why.charAt(0).toLowerCase() + v.why.slice(1))}. Tax rate ${pct(v.tax, 0)}. ${y0}A = actual from filings.</p>`;
}
const d0 = (v) => { return v.prevRev ? v.b.revenue / v.prevRev - 1 : null; };

/* ---------------- Page ---------------- */
function page(r) {
  const d = DATA[r.slug];
  const m = d.main;
  const price = m.price;
  const review = r.type === "Update";
  const declined = r.decision === "Not approved";
  const implied = r.target / price - 1;
  const fy = m.fundamentals.fy, lastFy = fy[fy.length - 1];
  const v = dcf(r.slug, d);
  if (!v.na) { v.price = price; v.prevRev = (fy[fy.length - 2] || {}).revenue; }
  const exchange = /nasdaq/i.test(m.exchange) ? "NASDAQ" : /nyse/i.test(m.exchange) ? "NYSE" : r.exchange;
  const asOfLabel = fmtDate(d.asOf).toUpperCase();
  const published = r.file.slice(0, 10);
  const company = r.company.replace(/,? Inc\.$|,? Inc$/, (s) => s);
  const shortName = r.company.replace(/,? (Inc\.|Corporation|Company)$/, "").replace(/\.com$/, "");

  const perfTitle = review ? `Performance of ${shortName} since purchase` : `Performance of ${shortName}`;
  const perf = review ? growthChart(d.since, r.ticker, [{ date: r.heldSince, label: "Bought" }]) : growthChart(d.before, r.ticker);
  const perfNote = review
    ? `Growth of $100 invested on ${fmtDate(r.heldSince)}, dividends reinvested, against the S&amp;P 500 Total Return.`
    : `Growth of $100 over the five years to ${fmtDate(d.asOf)}, dividends reinvested, against the S&amp;P 500 Total Return.`;

  const after = d.since, afterLast = after[after.length - 1];
  const page2Chart = review
    ? lineChart(d.since, {
        lines: [{ get: (p) => p[4], cls: "ln-s", endLabel: (x) => "$" + x.toFixed(0) }],
        refs: [{ value: d.since[0][4], label: `Cost ${money(d.since[0][4])} (split-adjusted)`, cls: "cost" }, { value: r.target, label: `Target ${money(r.target, 0)}`, cls: "tgt" }],
        yFmt: (x) => "$" + x.toFixed(0), legend: [["k-s", `${r.ticker} share price (adjusted for splits)`], ["k-t", "12-month target"], ["k-c", "Cost basis"]],
      })
    : growthChart(after, r.ticker, r.executed ? [{ date: r.executed.date, label: "Bought" }] : [{ date: r.date, label: "Pitched" }]);

  const epsG = m.epsGrowth;
  const stats = [
    ["Current price", money(price), `As of ${fmtDate(d.asOf)}`, ""],
    ["12-month target", money(r.target, 0), "PFW-SIF target", ""],
    ["Implied return", pct(implied, 2, true), "12-month expected", ""],
    ["Revenue growth", pct(m.revGrowth, 1, true), `${fyLabel(lastFy.end)} YoY`, signCls(m.revGrowth)],
    ["Earnings per share", m.epsTtm != null ? money(m.epsTtm) : "—", epsG != null ? `${pct(epsG, 0, true)} YoY (${fyLabel(lastFy.end)})` : "Trailing 12 months", signCls(epsG)],
  ];

  const decisionLine = review
    ? esc(r.vote)
    : `${esc(r.decision)}${r.vote.replace(/^(Approved|Not approved)\s*/, "") ? " · vote " + esc(r.vote.replace(/^(Approved|Not approved)\s*/, "")) : ""}, ${fmtDate(r.decisionDate)}${r.executed ? ` · bought ${fmtDate(r.executed.date)} at ${money(r.executed.price)}` : ""}`;

  const returnsTable = review
    ? `<table class="tbl"><thead><tr><th>Since ${fmtDate(r.heldSince)}</th><th>${r.ticker}</th><th>S&amp;P 500 TR</th><th>Difference</th></tr></thead><tbody><tr><td>Total return</td><td>${pct(afterLast[1] / 100 - 1, 0, true)}</td><td>${pct(afterLast[2] / 100 - 1, 0, true)}</td><td>${pct((afterLast[1] - afterLast[2]) / 100, 0, true)} pts</td></tr><tr><td>Purchase price</td><td>${money(r.costPrice)}</td><td colspan="2">Split-adjusted: ${money(d.since[0][4])}</td></tr></tbody></table>`
    : `<table class="tbl"><thead><tr><th>Since the pitch</th><th>${r.ticker}</th><th>S&amp;P 500 TR</th><th>Difference</th></tr></thead><tbody><tr><td>${fmtDate(d.sinceFrom)} – ${fmtDate(d.latest)}</td><td>${pct(afterLast[1] / 100 - 1, 0, true)}</td><td>${pct(afterLast[2] / 100 - 1, 0, true)}</td><td>${pct((afterLast[1] - afterLast[2]) / 100, 0, true)} pts</td></tr></tbody></table>`;

  const dcfComment = v.na ? v.reason : (() => {
    const gap = v.base.perShare / price - 1;
    let tail;
    if (gap > 0.15) tail = review ? "Cash flow still supports the current price." : "Cash flow alone supports the purchase; our target is deliberately more conservative.";
    else if (gap > -0.15) tail = "The price is close to what our cash flow forecast supports.";
    else tail = review ? "The market price assumes faster or longer growth than our base case. That gap is a main reason we hold rather than add." : "The market is paying for growth beyond our five-year forecast, so the target rests on the valuation method at left rather than the DCF.";
    return `Our five-year DCF gives ${money(v.base.perShare, 2)} per share, ${pct(Math.abs(gap), 0)} ${gap >= 0 ? "above" : "below"} the ${money(price)} price. ${tail} A DCF is sensitive to its inputs, so we use it as a check on the target, not the target itself.`;
  })();

  const sens = v.na ? "" : `<table class="tbl sens"><thead><tr><th>Discount rate ↓ / exit EV/EBITDA →</th>${[-2, 0, 2].map((x) => `<th>${v.exit + x}x</th>`).join("")}</tr></thead><tbody>
${v.grid.map((row, i) => `<tr><td>${pct(v.wacc + [-0.01, 0, 0.01][i])}</td>${row.map((x, j) => `<td${i === 1 && j === 1 ? ' class="hl"' : ""}>${money(x, 0)}</td>`).join("")}</tr>`).join("")}
</tbody></table><p class="src">Discount rate: 10-year Treasury ${pct(v.rf, 2)} on ${fmtDate(d.asOf)} + beta ${v.beta.toFixed(2)} × ${pct(ERP)} equity risk premium = ${pct(v.capm)}${Math.abs(v.capm - v.wacc) > 1e-9 ? `, held to the model's 8%–12% range (${pct(v.wacc)})` : ""}.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.company)} ${review ? "Position Review" : "Investment Review"} | PFW-SIF</title>
<meta name="description" content="${esc(r.headline)}. PFW-SIF ${review ? "position review" : "pitch"}, ${fmtDate(published, true)}.">
<meta name="theme-color" content="#1F2328">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&family=Cormorant+Garamond:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/reports/report.css">
</head>
<body>
<nav class="crumbs"><a href="/research">← Research</a><a href="/reports/">All reports</a><a href="/reports/${esc(r.slug)}" onclick="window.print();return false">Print / save as PDF</a></nav>

<article class="sheet">
<header class="mast">
  <div class="logo"><span class="emb" aria-hidden="true">SIF</span><span class="lt"><span class="mk">PFW-SIF</span><span class="sub">Purdue Fort Wayne<br>Student Investment Fund</span></span></div>
  <div class="mid">PFW-SIF ${review ? "Position Review" : "Investment Review"}</div>
  <div class="asof">As of ${asOfLabel}</div>
</header>

<section class="title">
  <div>
    <h1>${esc(company)}</h1>
    <p class="tick">${esc(r.ticker)} <span>|</span> ${esc(exchange)}</p>
    <p class="ind">${esc(r.sector)} <span>|</span> ${esc(r.industry)}</p>
  </div>
  <div class="rating${declined ? " declined" : ""}"><span>Rating</span><b>${esc(r.rating)}</b>${declined ? "<em>Not approved by committee</em>" : review ? "<em>Position review</em>" : ""}</div>
</section>

<section class="stats">${stats.map(([k, val, s, c]) => `<div><dt>${k}</dt><dd>${val}</dd><small class="${c}">${esc(s)}</small></div>`).join("")}</section>

<div class="p1">
<div class="left">
  <h2>Investment Thesis</h2>
  <p class="hd">${esc(r.headline)}</p>
  ${r.thesis.map((p) => `<p>${esc(p)}</p>`).join("")}

  <h2>Key Financials</h2>
  ${keyDrivers(d)}

  <h2>${esc(perfTitle)}</h2>
  ${perf}
  <p class="src">${perfNote} Weekly closes from Yahoo Finance.</p>

  <h2>Industry Comparison</h2>
  ${peerTable(d)}
</div>

<div class="right">
  <div class="cr">
    <section><h3 class="caps">Catalysts</h3><ol class="pts">${r.catalysts.map(([h, t]) => `<li><b>${esc(h)}</b><span>${esc(t)}</span></li>`).join("")}</ol></section>
    <section><h3 class="caps">Risks to the Thesis</h3><ol class="pts">${r.risks.map(([h, t]) => `<li><b>${esc(h)}</b><span>${esc(t)}</span></li>`).join("")}</ol></section>
  </div>

  <h2 class="ctr">DCF Model Valuation</h2>
  ${dcfTable(v)}

  <h2>Investment Committee Recommendation</h2>
  <div class="ic">
    <div class="ic-grid">
      <dl>
        <div><dt>PFW-SIF rating</dt><dd><span class="pill${declined ? " declined" : ""}">${esc(r.rating)}</span></dd></div>
        <div><dt>Current price</dt><dd>${money(price)}</dd></div>
        <div><dt>12-month target</dt><dd>${money(r.target, 0)} (${pct(implied, 1, true)})</dd></div>
      </dl>
      <dl>
        <div><dt>Analyst</dt><dd>${esc(ANALYST)}</dd></div>
        <div><dt>Sector team</dt><dd>${esc(r.team.replace(/ team$/, ""))}</dd></div>
        <div><dt>Reviewed by</dt><dd>Investment Committee</dd></div>
        <div><dt>Date</dt><dd>${fmtDate(published, true)}</dd></div>
      </dl>
    </div>
    <div class="rat"><p class="caps">Committee rationale</p><p>${esc(r.icRationale)}</p><p class="dec">${decisionLine}</p></div>
  </div>
</div>
</div>
<p class="sim">${esc(SIM)}</p>
</article>

<article class="sheet page2">
<header class="mast slim"><div class="logo"><span class="lt"><span class="mk">PFW-SIF</span></span></div><div class="mid">${esc(r.company)} (${esc(r.ticker)}) · ${review ? "Position review" : "Investment case"}</div><div class="asof">Page 2</div></header>

<h2 class="big">${esc(r.caseTitle)}</h2>
${r.caseSections.map(([h, t]) => `<h3>${esc(h)}</h3><p>${esc(t)}</p>`).join("")}

<h2>Price Target: ${money(r.target, 0)} (${pct(implied, 1, true)})</h2>
<div class="cols">
<div class="col">
  <p class="lbl">${esc(r.valuation.method)}</p>
  <table class="tbl kv"><tbody>${r.valuation.rows.map(([k, val]) => `<tr><td>${esc(k)}</td><td>${esc(val)}</td></tr>`).join("")}</tbody></table>
  <p>${esc(r.valuation.text)}</p>
</div>
<div class="col">
  <p class="lbl">DCF cross-check</p>
  <p>${esc(dcfComment)}</p>
  ${sens}
</div>
</div>

${r.financials ? `<h2>Operating Detail</h2><table class="tbl"><thead><tr><th></th>${r.financials.cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${r.financials.rows.map(([k, ...vals]) => `<tr><td>${esc(k)}</td>${vals.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table><p class="src">${esc(r.financials.note)} Segment figures from company earnings releases.</p>` : ""}

<h2>${review ? "Share Price Since Purchase" : "How the Pitch Has Done Since"}</h2>
${page2Chart}
${returnsTable}
<p class="src">${review ? `Weekly closes from ${fmtDate(r.heldSince)} to ${fmtDate(d.latest)}, adjusted for stock splits.` : `Added after publication so the committee's decision can be judged. Total returns with dividends reinvested from ${fmtDate(d.sinceFrom)} to ${fmtDate(d.latest)}.`}</p>

<h2>Methodology and Sources</h2>
<ul class="meth">
<li>Financial statements: SEC EDGAR company filings (10-K and 10-Q) filed on or before ${fmtDate(d.asOf)}.</li>
<li>Prices and total returns: Yahoo Finance daily closes, dividends reinvested. Benchmark: S&amp;P 500 Total Return, measured with SPY.</li>
<li>Discount rate: 10-year US Treasury yield on ${fmtDate(d.asOf)} plus beta × 5% equity risk premium. Beta: 36 monthly returns against SPY.</li>
<li>Research: PFW-SIF ${esc(r.team)}. Published ${fmtDate(published, true)}.</li>
</ul>
<p class="sim">${esc(SIM)}</p>
</article>
<footer class="foot">PFW-SIF · Purdue Fort Wayne Student Investment Fund · Simulated portfolio · Not investment advice</footer>
</body>
</html>
`;
}

function indexPage() {
  const rows = [...reports].sort((a, b) => (a.file < b.file ? 1 : a.file > b.file ? -1 : 0)).map((r) => {
    const d = DATA[r.slug];
    const outcome = r.type === "Update" ? r.vote : `${r.decision}, ${fmtDate(r.decisionDate)}`;
    return `<tr><td>${fmtDate(r.file.slice(0, 10))}</td><td><a href="/reports/${esc(r.slug)}"><b>${esc(r.company)}</b> (${esc(r.ticker)})</a><br><span class="muted">${esc(r.headline)}</span></td><td>${r.type === "Update" ? "Position review" : "Initiation"}</td><td>${esc(r.rating)}</td><td>${money(d.main.price)}</td><td>${money(r.target, 0)}</td><td>${esc(outcome)}</td></tr>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Research Reports | PFW-SIF</title>
<meta name="description" content="Every PFW-SIF pitch and position review, with price targets, valuation and committee decisions.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&family=Cormorant+Garamond:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/reports/report.css">
</head>
<body>
<nav class="crumbs"><a href="/research">← Research</a></nav>
<article class="sheet">
<header class="mast"><div class="logo"><span class="emb" aria-hidden="true">SIF</span><span class="lt"><span class="mk">PFW-SIF</span><span class="sub">Purdue Fort Wayne<br>Student Investment Fund</span></span></div><div class="mid">Research Reports</div><div class="asof">${reports.length} reports</div></header>
<h1 class="idx">Every pitch, every review</h1>
<p>Each report has a one-page investment review and a full investment case with the price target, valuation and performance. Declined pitches are kept so the committee's decisions can be judged over time.</p>
<div class="scroll"><table class="tbl list"><thead><tr><th>Published</th><th>Company</th><th>Type</th><th>Rating</th><th>Price</th><th>Target</th><th>Committee</th></tr></thead><tbody>
${rows}
</tbody></table></div>
<p class="sim">${esc(SIM)}</p>
</article>
</body>
</html>
`;
}

for (const r of reports) writeFileSync(new URL(`${r.slug}.html`, OUT), page(r));
writeFileSync(new URL("index.html", OUT), indexPage());
for (const r of reports) { const v = dcf(r.slug, DATA[r.slug]); console.log(r.slug.padEnd(24), "price", DATA[r.slug].main.price.toFixed(2), "target", r.target, "DCF", v.na ? "n/m" : v.base.perShare.toFixed(0), v.na ? "" : "r " + (v.wacc * 100).toFixed(1)); }
console.log(`Wrote ${reports.length} report pages and an index to site/reports/`);
