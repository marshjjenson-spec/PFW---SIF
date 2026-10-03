// Builds the research report pages in site/reports/ from:
//   tools/reports-content.mjs  the written research (thesis, catalysts, risks, committee notes)
//   tools/report-data.json     filed financials and market data (made by fetch-report-data.mjs)
//
//   node tools/build-reports.mjs
//
// Every page is static HTML with inline SVG charts, so it needs no scripts or database access.
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { reports } from "./reports-content.mjs";

const DATA = JSON.parse(readFileSync(new URL("./report-data.json", import.meta.url), "utf8"));
const OUT = new URL("../site/reports/", import.meta.url);
mkdirSync(OUT, { recursive: true });

/* DCF assumptions by report. Free cash flow = operating cash flow − capital expenditures, trailing
   12 months from filings on or before the report date. Growth g1 applies in years 1–5, then fades in
   a straight line to the terminal rate gT by year 10. Discount rate = 10-year Treasury yield on the
   report date + beta × 5.0% equity risk premium (beta from 36 monthly returns vs SPY), kept between
   8% and 12% so one unusual beta does not dominate. A null entry means FCF was negative, so a DCF is not meaningful. */
const ERP = 0.05;
const DCF = {
  "aapl-2015-initiation": { g1: 0.06, gT: 0.025, why: "Mid-single-digit growth from Services and buybacks on a flat iPhone base." },
  "googl-2016-initiation": { g1: 0.15, gT: 0.03, why: "Revenue growing about 20% in constant currency, with capital spending growing more slowly." },
  "intc-2016-pitch": { g1: 0.04, gT: 0.02, why: "Data center growth offset by a shrinking PC business." },
  "amzn-2018-initiation": { g1: 0.35, gT: 0.03, why: "Free cash flow from a low base as AWS scales; reinvestment keeps reported cash flow far below earning power." },
  "ge-2018-pitch": null,
  "amd-2024-initiation": { g1: 0.45, gT: 0.03, why: "Data center GPU revenue ramping from a small base, with margins rising as the mix shifts." },
  "aapl-2026-review": { g1: 0.07, gT: 0.03, why: "Services growth and buybacks on a mature device base." },
  "googl-2026-review": { g1: 0.15, gT: 0.03, why: "Cloud and AI growth; free cash flow is depressed today by data center spending." },
  "amzn-2026-review": null,
  "amd-2026-review": { g1: 0.35, gT: 0.03, why: "Multi-year accelerator agreements shipping in volume from a still-small cash flow base." },
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
  const m = d.main, fy = m.fundamentals.fy, last = fy[fy.length - 1];
  if (!cfg || !(m.fcfTtm > 0)) return { na: true, reason: m.fcfTtm != null && m.fcfTtm <= 0 ? `Trailing free cash flow was negative (${bn(m.fcfTtm)}), so a discounted cash flow value is not meaningful. The target is based on the valuation method below.` : "Not enough cash flow data in filings for a DCF." };
  const beta = m.beta ?? 1;
  const run = (wacc, gT) => {
    let f = m.fcfTtm, pv = 0; const years = [];
    for (let y = 1; y <= 10; y++) {
      const g = y <= 5 ? cfg.g1 : cfg.g1 + ((gT - cfg.g1) * (y - 5)) / 5;
      f *= 1 + g; const p = f / (1 + wacc) ** y; pv += p; years.push({ y, g, f, p });
    }
    const tv = (f * (1 + gT)) / (wacc - gT), pvTv = tv / (1 + wacc) ** 10;
    const netCash = (last.cashInv ?? 0) - (last.debt ?? 0);
    const equity = pv + pvTv + netCash;
    return { years, pv, tv, pvTv, netCash, equity, perShare: equity / m.shares };
  };
  const capm = d.riskFree + beta * ERP;
  const wacc = Math.min(0.12, Math.max(0.08, capm));
  const base = run(wacc, cfg.gT);
  const grid = [-0.01, 0, 0.01].map((dw) => [-0.005, 0, 0.005].map((dg) => run(wacc + dw, cfg.gT + dg).perShare));
  return { ...cfg, beta, wacc, capm, base, grid, fcf0: m.fcfTtm, rf: d.riskFree };
}

/* ---------------- Page pieces ---------------- */
const SIM = "Simulated, retrospective case study for the PFW-SIF student investment fund. The research is written as of the report date using information public at that time; the committee vote is part of the simulation and no real money was invested. Educational only; not investment advice.";

function keyFinancials(d) {
  const f = d.main.fundamentals, fy = f.fy.slice(-3), t = f.ttm;
  const cols = fy.map((x) => fyLabel(x.end));
  const hasTtm = t.through && t.revenue != null;
  if (hasTtm) cols.push("TTM to " + MON[+t.through.slice(5, 7) - 1] + " " + t.through.slice(0, 4));
  const all = d.main.fundamentals.fy;
  const growth = (x) => { const i = all.indexOf(x); return i > 0 ? x.revenue / all[i - 1].revenue - 1 : null; };
  const row = (label, fn, tfn) => `<tr><td>${label}</td>${fy.map((x) => `<td>${fn(x)}</td>`).join("")}${hasTtm ? `<td>${tfn ? tfn() : "—"}</td>` : ""}</tr>`;
  const tFcf = t.ocf != null && t.capex != null ? t.ocf - t.capex : null;
  return `<table class="tbl"><thead><tr><th>$ billions</th>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>
${row("Revenue", (x) => bn(x.revenue).replace("B", ""), () => bn(t.revenue).replace("B", ""))}
${row("Revenue growth", (x) => pct(growth(x)))}
${row("Gross margin", (x) => pct(x.gross != null ? x.gross / x.revenue : null))}
${row("Operating margin", (x) => pct(x.opInc != null ? x.opInc / x.revenue : null), () => pct(t.opInc != null ? t.opInc / t.revenue : null))}
${row("Net income", (x) => bn(x.netInc).replace("B", ""), () => bn(t.netInc).replace("B", ""))}
${row("Diluted EPS ($)", (x) => (x.eps != null ? x.eps.toFixed(2) : "—"), () => (d.main.epsTtm != null ? d.main.epsTtm.toFixed(2) : "—"))}
${row("Free cash flow", (x) => (x.ocf != null && x.capex != null ? bn(x.ocf - x.capex).replace("B", "") : "—"), () => bn(tFcf).replace("B", ""))}
</tbody></table><p class="src">From the company's 10-K and 10-Q filings with the SEC made on or before ${fmtDate(d.asOf)}. EPS as reported, not restated for later splits; TTM EPS is trailing net income over current diluted shares.</p>`;
}

function peerTable(d, r) {
  const cos = [d.main, ...d.peers];
  const rows = [
    ["Market cap", (c) => capFmt(c.marketCap)],
    ["P/E (trailing, GAAP)", (c) => mult(c.pe)],
    ["Revenue growth (last FY)", (c) => pct(c.revGrowth)],
    ["Gross margin", (c) => pct(c.grossMargin)],
    ["Operating margin", (c) => pct(c.opMargin)],
    ["Net margin", (c) => pct(c.netMargin)],
    ["Return on equity", (c) => pct(c.roe)],
    ["FCF yield", (c) => pct(c.fcfYield)],
    ["Debt / equity", (c) => (c.debtToEquity == null ? "—" : c.debtToEquity.toFixed(2))],
    ["Beta (3Y monthly)", (c) => (c.beta == null ? "—" : c.beta.toFixed(2))],
  ];
  return `<table class="tbl peers"><thead><tr><th>Metric</th>${cos.map((c, i) => `<th${i === 0 ? ' class="hl"' : ""}>${esc(c.ticker)}</th>`).join("")}</tr></thead><tbody>
${rows.map(([l, fn]) => `<tr><td>${l}</td>${cos.map((c, i) => `<td${i === 0 ? ' class="hl"' : ""}>${fn(c)}</td>`).join("")}</tr>`).join("\n")}
</tbody></table><p class="src">Prices on ${fmtDate(d.main.date)}; financials from each company's latest SEC filings as of that date. "n/m" = not meaningful (negative earnings or cash flow).</p>`;
}

function dcfBlock(v, r, price) {
  if (v.na) return `<p class="muted">${esc(v.reason)}</p>`;
  const b = v.base;
  return `<table class="tbl dcf"><thead><tr><th>$ billions</th>${b.years.slice(0, 5).map((y) => `<th>Y${y.y}</th>`).join("")}<th>Y6–10</th></tr></thead><tbody>
<tr><td>FCF growth</td>${b.years.slice(0, 5).map((y) => `<td>${pct(y.g, 0)}</td>`).join("")}<td>fades to ${pct(v.gT, 1)}</td></tr>
<tr><td>Free cash flow</td>${b.years.slice(0, 5).map((y) => `<td>${(y.f / 1e9).toFixed(1)}</td>`).join("")}<td>${(b.years[9].f / 1e9).toFixed(1)} in Y10</td></tr>
<tr><td>Present value</td>${b.years.slice(0, 5).map((y) => `<td>${(y.p / 1e9).toFixed(1)}</td>`).join("")}<td>${(b.years.slice(5).reduce((s, y) => s + y.p, 0) / 1e9).toFixed(1)}</td></tr>
</tbody></table>
<div class="dcf-sum">
<dl><div><dt>Trailing FCF</dt><dd>${bn(v.fcf0)}</dd></div><div><dt>Discount rate</dt><dd>${pct(v.wacc)}</dd></div><div><dt>Terminal growth</dt><dd>${pct(v.gT)}</dd></div>
<div><dt>PV of 10-year FCF</dt><dd>${bn(b.pv)}</dd></div><div><dt>PV of terminal value</dt><dd>${bn(b.pvTv)}</dd></div><div><dt>Net cash (debt)</dt><dd>${bn(b.netCash)}</dd></div>
<div><dt>Equity value</dt><dd>${capFmt(b.equity)}</dd></div><div><dt>DCF value per share</dt><dd class="hl">${money(b.perShare, b.perShare >= 100 ? 0 : 2)}</dd></div><div><dt>vs. price</dt><dd>${pct(b.perShare / price - 1, 0, true)}</dd></div></dl>
</div>`;
}

function dcfComment(v, r, price) {
  const gap = v.base.perShare / price - 1;
  const head = `On base-case assumptions (${v.why.replace(/.$/, "").replace(/^./, (c) => c.toLowerCase())}), the DCF gives ${money(v.base.perShare, v.base.perShare >= 100 ? 0 : 2)} per share, ${pct(Math.abs(gap), 0)} ${gap >= 0 ? "above" : "below"} the ${money(price)} price.`;
  let tail;
  if (gap > 0.15) tail = r.type === "Update" ? " Cash flow still supports the current price." : " Cash flow alone supports the purchase; our target is deliberately more conservative.";
  else if (gap > -0.15) tail = " The price is close to what current cash flow supports.";
  else tail = r.type === "Update"
    ? " The market price assumes faster or longer growth than our base case. That gap is a main reason we hold rather than add."
    : " Trailing free cash flow understates this business's earning power because so much is being reinvested, so the target rests on the valuation method at left rather than the DCF.";
  return head + tail + " A DCF is sensitive to its inputs, so we use it as a check on the target, not the target itself.";
}

function sensitivity(v) {
  if (v.na) return "";
  return `<table class="tbl sens"><thead><tr><th>Discount rate ↓ / terminal growth →</th>${[-0.005, 0, 0.005].map((g) => `<th>${pct(v.gT + g)}</th>`).join("")}</tr></thead><tbody>
${v.grid.map((row, i) => `<tr><td>${pct(v.wacc + [-0.01, 0, 0.01][i])}</td>${row.map((x, j) => `<td${i === 1 && j === 1 ? ' class="hl"' : ""}>${money(x, 0)}</td>`).join("")}</tr>`).join("")}
</tbody></table>`;
}

function page(r) {
  const d = DATA[r.slug];
  const m = d.main;
  const price = m.price;
  const review = r.type === "Update";
  const declined = r.decision === "Not approved";
  const implied = r.target / price - 1;
  const lastFy = m.fundamentals.fy[m.fundamentals.fy.length - 1];
  const v = dcf(r.slug, d);
  const exchange = /nasdaq/i.test(m.exchange) ? "NASDAQ" : /nyse/i.test(m.exchange) ? "NYSE" : r.exchange;
  const asOfLabel = fmtDate(d.asOf);
  const ratingNote = declined ? "Team rating · not approved" : review ? "Position review" : "Initiation";

  const perfTitle = review ? `Performance since purchase (${fmtDate(r.heldSince)})` : `Performance of ${r.ticker}: five years to the report date`;
  const perf = review
    ? growthChart(d.since, r.ticker, [{ date: r.heldSince, label: "Bought" }])
    : growthChart(d.before, r.ticker);

  const after = d.since;
  const afterLast = after[after.length - 1];
  const page2Chart = review
    ? lineChart(d.since, {
        lines: [{ get: (p) => p[4], cls: "ln-s", endLabel: (x) => "$" + x.toFixed(0) }],
        refs: [{ value: d.since[0][4], label: `Cost ${money(d.since[0][4])} (split-adjusted)`, cls: "cost" }, { value: r.target, label: `Target ${money(r.target, 0)}`, cls: "tgt" }],
        yFmt: (x) => "$" + x.toFixed(0), legend: [["k-s", `${r.ticker} share price (adjusted for splits)`], ["k-t", "12-month target"], ["k-c", "Cost basis"]],
      })
    : growthChart(after, r.ticker, r.executed ? [{ date: r.executed.date, label: "Bought" }] : [{ date: r.date, label: "Pitched" }]);

  const committee = review
    ? `<div class="row"><span>Committee action</span><b>${esc(r.vote)}</b></div>`
    : `<div class="row"><span>Committee decision</span><b>${esc(r.decision)} · ${esc(r.vote.replace(/^(Approved|Not approved)\s*/, ""))}</b></div><div class="row"><span>Decision date</span><b>${fmtDate(r.decisionDate)}</b></div>${r.executed ? `<div class="row"><span>Executed</span><b>${fmtDate(r.executed.date)} at ${money(r.executed.price)}</b></div>` : ""}`;

  const statCards = [
    ["Current price", money(price), `As of ${asOfLabel}`],
    ["12-month target", money(r.target, 0), "PFW-SIF target"],
    ["Implied return", pct(implied, 1, true), "To 12-month target"],
    ["Revenue growth", pct(m.revGrowth, 1, true), fyLabel(lastFy.end) + " vs prior year"],
    ["Earnings per share", m.epsTtm != null ? money(m.epsTtm) : "—", "Diluted, trailing 12 months"],
  ];

  const returnsTable = review
    ? `<table class="tbl"><thead><tr><th>Since ${fmtDate(r.heldSince)}</th><th>${r.ticker}</th><th>S&amp;P 500 TR</th><th>Difference</th></tr></thead><tbody><tr><td>Total return</td><td>${pct(afterLast[1] / 100 - 1, 0, true)}</td><td>${pct(afterLast[2] / 100 - 1, 0, true)}</td><td>${pct((afterLast[1] - afterLast[2]) / 100, 0, true)} pts</td></tr><tr><td>Purchase price</td><td>${money(r.costPrice)}</td><td colspan="2">Split-adjusted: ${money(d.since[0][4])}</td></tr></tbody></table>`
    : `<table class="tbl"><thead><tr><th>Since the pitch</th><th>${r.ticker}</th><th>S&amp;P 500 TR</th><th>Difference</th></tr></thead><tbody><tr><td>${fmtDate(d.sinceFrom)} – ${fmtDate(d.latest)}</td><td>${pct(afterLast[1] / 100 - 1, 0, true)}</td><td>${pct(afterLast[2] / 100 - 1, 0, true)}</td><td>${pct((afterLast[1] - afterLast[2]) / 100, 0, true)} pts</td></tr></tbody></table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.company)} ${review ? "Position Review" : "Investment Review"} | PFW-SIF</title>
<meta name="description" content="${esc(r.headline)}. PFW-SIF ${review ? "position review" : "pitch"}, ${fmtDate(r.date, true)}.">
<meta name="theme-color" content="#1F2328">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Cormorant+Garamond:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/reports/report.css">
</head>
<body>
<nav class="crumbs"><a href="/research">← Research</a><a href="/reports/">All reports</a><a href="/reports/${esc(r.slug)}" onclick="window.print();return false">Print / save as PDF</a></nav>

<article class="sheet">
<header class="mast">
  <div class="logo"><span class="mk">PFW-<b>SIF</b></span><span class="sub">Purdue Fort Wayne<br>Student Investment Fund</span></div>
  <div class="mid">PFW-SIF ${review ? "Position Review" : "Investment Review"}</div>
  <div class="asof">As of ${asOfLabel}</div>
</header>

<section class="title">
  <div>
    <h1>${esc(r.company)}</h1>
    <p class="tick">${esc(r.ticker)} <span>|</span> ${esc(exchange)}</p>
    <p class="ind">${esc(r.sector)} <span>|</span> ${esc(r.industry)}</p>
  </div>
  <div class="rating ${declined ? "declined" : ""}"><span>Rating</span><b>${esc(r.rating)}</b><em>${esc(ratingNote)}</em></div>
</section>

<section class="stats">${statCards.map(([k, val, s]) => `<div><dt>${k}</dt><dd>${val}</dd><small>${esc(s)}</small></div>`).join("")}</section>

<p class="sim">${esc(SIM)}</p>

<div class="cols">
<div class="col">
  <h2>Investment thesis</h2>
  <p class="hd">${esc(r.headline)}</p>
  ${r.thesis.map((p) => `<p>${esc(p)}</p>`).join("")}

  <h2>Key financials</h2>
  ${keyFinancials(d)}

  <h2>${esc(perfTitle)}</h2>
  ${perf}
  <p class="src">Growth of $100 with dividends reinvested, weekly closes. Prices from Yahoo Finance.</p>

  <h2>Industry comparison</h2>
  ${peerTable(d, r)}
</div>

<div class="col">
  <h2>Catalysts</h2>
  <ol class="pts">${r.catalysts.map(([h, t]) => `<li><b>${esc(h)}</b>${esc(t)}</li>`).join("")}</ol>

  <h2>Risks to the thesis</h2>
  <ol class="pts">${r.risks.map(([h, t]) => `<li><b>${esc(h)}</b>${esc(t)}</li>`).join("")}</ol>

  <h2>DCF model valuation</h2>
  ${dcfBlock(v, r, price)}

  <h2>Investment committee recommendation</h2>
  <div class="ic">
    <div class="row"><span>PFW-SIF rating</span><b>${esc(r.rating)}</b></div>
    <div class="row"><span>Report published</span><b>${fmtDate(r.file.slice(0, 10))}</b></div>
    <div class="row"><span>Price on ${asOfLabel}</span><b>${money(price)}</b></div>
    <div class="row"><span>12-month target</span><b>${money(r.target, 0)} (${pct(implied, 1, true)})</b></div>
    <div class="row"><span>Analyst</span><b>${esc(r.team)}</b></div>
    <div class="row"><span>Reviewed by</span><b>Investment Committee</b></div>
    ${committee}
    <p class="rat"><b>Committee rationale.</b> ${esc(r.icRationale)}</p>
  </div>
</div>
</div>
</article>

<article class="sheet page2">
<header class="mast slim"><div class="logo"><span class="mk">PFW-<b>SIF</b></span></div><div class="mid">${esc(r.company)} (${esc(r.ticker)}) · ${review ? "Position review" : "Investment case"}</div><div class="asof">Page 2</div></header>

<h2 class="big">${esc(r.caseTitle)}</h2>
${r.caseSections.map(([h, t]) => `<h3>${esc(h)}</h3><p>${esc(t)}</p>`).join("")}

<h2>Price target: ${money(r.target, 0)}</h2>
<div class="cols tight">
<div class="col">
  <p class="lbl">${esc(r.valuation.method)}</p>
  <table class="tbl"><tbody>${r.valuation.rows.map(([k, val]) => `<tr><td>${esc(k)}</td><td>${esc(val)}</td></tr>`).join("")}</tbody></table>
  <p>${esc(r.valuation.text)}</p>
</div>
<div class="col">
  <p class="lbl">DCF cross-check</p>
  ${v.na ? `<p class="muted">${esc(v.reason)}</p>` : `<p>${esc(dcfComment(v, r, price))}</p>${sensitivity(v)}<p class="src">Discount rate: 10-year Treasury ${pct(v.rf, 2)} on ${asOfLabel} + beta ${v.beta.toFixed(2)} × ${pct(ERP)} equity risk premium = ${pct(v.capm)}${Math.abs(v.capm - v.wacc) > 1e-9 ? `, held to the model's 8%–12% range (${pct(v.wacc)})` : ""}.</p>`}
</div>
</div>

${r.financials ? `<h2>Operating detail from the report</h2><table class="tbl"><thead><tr><th></th>${r.financials.cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${r.financials.rows.map(([k, ...vals]) => `<tr><td>${esc(k)}</td>${vals.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table><p class="src">${esc(r.financials.note)} Segment figures from company earnings releases.</p>` : ""}

<h2>${review ? "Share price since purchase" : "How the pitch has done since"}</h2>
${page2Chart}
${returnsTable}
<p class="src">${review ? `Weekly closes from ${fmtDate(r.heldSince)} to ${fmtDate(d.latest)}, adjusted for stock splits.` : `Added after publication so the committee's decision can be judged. Total returns with dividends reinvested from ${fmtDate(d.sinceFrom)} to ${fmtDate(d.latest)}.`}</p>

<h2>Methodology and sources</h2>
<ul class="meth">
<li>Financial statements: SEC EDGAR company filings (10-K and 10-Q) filed on or before ${asOfLabel}.</li>
<li>Prices and total returns: Yahoo Finance daily closes; dividends reinvested for total return. Benchmark: S&amp;P 500 Total Return, measured with SPY.</li>
<li>Risk-free rate: 10-year US Treasury yield on ${asOfLabel}. Beta: 36 monthly returns against SPY.</li>
<li>Written research: PFW-SIF ${esc(r.team)}. Full text also at <a href="https://github.com/marshjjenson-spec/PFW---SIF/blob/main/research-reports/${esc(r.file)}">research-reports/${esc(r.file)}</a>.</li>
</ul>
<p class="sim">${esc(SIM)}</p>
</article>
<footer class="foot">PFW-SIF · Purdue Fort Wayne Student Investment Fund · Simulated portfolio · Not investment advice</footer>
</body>
</html>
`;
}

function indexPage() {
  const rows = [...reports].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.ticker.localeCompare(b.ticker))).map((r) => {
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Cormorant+Garamond:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/reports/report.css">
</head>
<body>
<nav class="crumbs"><a href="/research">← Research</a></nav>
<article class="sheet">
<header class="mast"><div class="logo"><span class="mk">PFW-<b>SIF</b></span><span class="sub">Purdue Fort Wayne<br>Student Investment Fund</span></div><div class="mid">Research reports</div><div class="asof">${reports.length} reports</div></header>
<h1 class="idx">Every pitch, every review</h1>
<p>Each report has a one-page summary and a full investment case with the price target, valuation and performance. Declined pitches are kept so the committee's decisions can be judged over time.</p>
<div class="scroll"><table class="tbl list"><thead><tr><th>Date</th><th>Company</th><th>Type</th><th>Rating</th><th>Price</th><th>Target</th><th>Committee</th></tr></thead><tbody>
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
for (const r of reports) { const v = dcf(r.slug, DATA[r.slug]); console.log(r.slug.padEnd(24), "price", DATA[r.slug].main.price.toFixed(2), "target", r.target, "DCF", v.na ? "n/m" : v.base.perShare.toFixed(0), v.na ? "" : "wacc " + (v.wacc * 100).toFixed(1)); }
console.log(`Wrote ${reports.length} report pages and an index to site/reports/`);
