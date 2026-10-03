// Adds a "Menu" button on narrow screens to the Performance, Holdings and Research pages,
// whose top tabs are hidden below 980px. It copies the tabs those pages already render.
(function () {
  const css = document.createElement("style");
  css.textContent =
    ".pfw-menu{display:none;margin-left:auto;background:none;border:1px solid #3A3F44;color:#fff;border-radius:4px;padding:7px 12px;font:600 11px 'IBM Plex Sans',system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;cursor:pointer}" +
    ".pfw-mnav{display:none;background:#14171A;border-bottom:1px solid #3A3F44;position:sticky;top:60px;z-index:29}" +
    ".pfw-mnav a{display:block;color:#9AA1A8;text-decoration:none;padding:12px 16px;border-top:1px solid rgba(255,255,255,.06);font:500 14px 'IBM Plex Sans',system-ui,sans-serif}" +
    ".pfw-mnav a[aria-current]{color:#fff;box-shadow:inset 3px 0 0 #CFB991}" +
    "@media (max-width:980px){.pfw-menu{display:inline-block}.pfw-mnav.open{display:block}.site .apply{margin-left:12px!important}}";
  document.head.appendChild(css);
  function build() {
    const nav = document.getElementById("site-nav");
    const header = document.querySelector("header.site");
    if (!nav || !header || header.querySelector(".pfw-menu")) return;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "pfw-menu"; btn.textContent = "Menu";
    btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "pfw-mnav");
    nav.after(btn);
    const mob = document.createElement("nav");
    mob.className = "pfw-mnav"; mob.id = "pfw-mnav"; mob.setAttribute("aria-label", "Site");
    header.after(mob);
    const sync = () => { mob.innerHTML = nav.innerHTML; };
    sync();
    new MutationObserver(sync).observe(nav, { childList: true, subtree: true, attributes: true });
    btn.addEventListener("click", () => { const open = mob.classList.toggle("open"); btn.setAttribute("aria-expanded", String(open)); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
