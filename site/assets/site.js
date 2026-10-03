// PFW-SIF shared page script: navigation from config.js, the mobile menu, the footer,
// and read-only data access for the informational pages.
(function () {
  const c = window.PFW_CONFIG || {};
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const $ = (id) => document.getElementById(id);
  const DEFAULT_NAV = [{ label: "Performance", href: "/" }, { label: "Holdings", href: "/holdings" }, { label: "Research", href: "/research" }];
  const nav = Array.isArray(c.nav) && c.nav.length ? c.nav : DEFAULT_NAV;
  const clean = (p) => p.replace(/\.html$/, "").replace(/\/index$/, "/").replace(/(.)\/$/, "$1");
  const here = clean(location.pathname);
  const norm = (h) => { try { const u = new URL(h, location.href); return u.origin === location.origin ? clean(u.pathname) : null; } catch (e) { return null; } };
  const links = nav.map((n) => '<a href="' + esc(n.href) + '"' + (norm(n.href) === here ? ' aria-current="page"' : "") + ">" + esc(n.label) + "</a>").join("");

  const header = document.querySelector("header.site .wrap");
  if (header) {
    header.innerHTML =
      '<a class="mark" href="' + esc(c.homeUrl || "/") + '"><b>PFW-SIF</b><span>Student Investment Fund</span></a>' +
      '<nav class="nav" aria-label="Site">' + links + "</nav>" +
      '<button class="menu-btn" type="button" aria-expanded="false" aria-controls="mobile-nav">Menu</button>' +
      (c.applyUrl ? '<a class="apply" href="' + esc(c.applyUrl) + '">Apply</a>' : "");
    const mob = document.createElement("nav");
    mob.className = "mobile-nav"; mob.id = "mobile-nav"; mob.setAttribute("aria-label", "Site");
    mob.innerHTML = links;
    document.querySelector("header.site").after(mob);
    const btn = header.querySelector(".menu-btn");
    btn.addEventListener("click", () => { const open = mob.classList.toggle("open"); btn.setAttribute("aria-expanded", String(open)); });
  }

  const foot = document.querySelector("footer.site-foot");
  if (foot) {
    const extra = [
      { label: "All research reports", href: "/reports/" }, { label: "Investment process", href: "/process" }, { label: "Team", href: "/team" },
      { label: "About", href: "/about" }, { label: "Join the fund", href: "/join" }, { label: "FAQ", href: "/faq" }, { label: "Disclosures", href: "/disclosures" },
    ];
    const seen = new Set(), all = [];
    for (const n of nav.concat(extra)) { const k = norm(n.href) || n.href; if (!seen.has(k)) { seen.add(k); all.push(n); } }
    foot.innerHTML = '<div class="wrap"><div class="foot-links">' + all.map((n) => '<a href="' + esc(n.href) + '">' + esc(n.label) + "</a>").join("") + "</div>" +
      '<div class="foot-meta"><span>Purdue Fort Wayne Student Investment Fund · Doermer School of Business</span>' +
      "<span>Simulated portfolio for education. Not investment advice. " + '<a href="/disclosures" style="color:inherit">Disclosures</a></span></div></div>';
  }

  // Read-only Supabase access (the same public key and tables as the data pages).
  async function get(path) {
    if (!c.supabaseUrl || !c.supabaseKey) throw new Error("config.js is missing supabaseUrl or supabaseKey.");
    const headers = { apikey: c.supabaseKey, Accept: "application/json" };
    if (!String(c.supabaseKey).startsWith("sb_")) headers.Authorization = "Bearer " + c.supabaseKey;
    const res = await fetch(c.supabaseUrl.replace(/\/$/, "") + "/rest/v1/" + path, { headers });
    if (!res.ok) throw new Error("The database returned " + res.status + ".");
    return res.json();
  }
  const snapshot = async (id) => { const rows = await get("public_snapshots?select=data,updated_at&id=eq." + encodeURIComponent(id)); return rows[0] ? rows[0].data : null; };

  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = {
    esc,
    date: (iso) => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return MON[m - 1] + " " + d + ", " + y; },
    pct: (v, d = 1, sign = true) => { if (v === null || v === undefined || !isFinite(v)) return "N/A"; const t = Math.abs(v * 100).toFixed(d); if (+t === 0) return t + "%"; return (v < 0 ? "−" : sign ? "+" : "") + t + "%"; },
    money: (v, d = 0) => (v === null || v === undefined || !isFinite(v) ? "—" : (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })),
    cls: (v) => (v === null || v === undefined || !isFinite(v) || Math.abs(v) < 5e-4 ? "" : v > 0 ? "pos" : "neg"),
    MON,
  };
  window.PFW = { get, snapshot, fmt, $, config: c };
})();
