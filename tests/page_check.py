# Loads the live page against each fixture and reports what renders.
from playwright.sync_api import sync_playwright
import urllib.request, json
def mode(m): urllib.request.urlopen("http://localhost:8765/__mode/" + m).read()
with sync_playwright() as p:
    b = p.chromium.launch()
    for m in ["fx70", "fx9", "fx1", "empty", "fail"]:
        mode(m); errs = []
        for w in (1300, 400):
            pg = b.new_page(viewport={"width": w, "height": 900})
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda c: errs.append(c.text) if c.type == "error" and "PFW-SIF performance data" not in c.text and "fonts" not in c.text and "Failed to load resource" not in c.text else None)
            pg.goto("http://localhost:8765/"); pg.wait_for_timeout(1500)
            if w == 1300:
                info = pg.evaluate("""() => ({
                  status: document.getElementById('data-status').textContent,
                  source: document.getElementById('data-source').textContent.slice(0,70),
                  noData: !document.getElementById('no-data').hidden ? document.getElementById('no-data-title').textContent : null,
                  cards: [...document.querySelectorAll('#cards .big')].map(e=>e.textContent).join(' | '),
                  sharpe: [...document.querySelectorAll('.metric')].map(e=>e.innerText.split('\\n').slice(0,2).join(':')).slice(2,3)[0],
                  win: [...document.querySelectorAll('#win button')].map(b=>b.textContent+(b.disabled?'(off)':'')+(b.getAttribute('aria-pressed')==='true'?'*':'')).join(' '),
                  nav: [...document.querySelectorAll('#site-nav a')].map(a=>a.textContent).join(','),
                  apply: !document.getElementById('apply-link').hidden,
                  dq: document.getElementById('dq-text').textContent.slice(0,110)
                })""")
                print(m, json.dumps(info, indent=0)); pg.screenshot(path=f"/tmp/live_{m}.png", full_page=True)
            else:
                sw = pg.evaluate("document.documentElement.scrollWidth")
                if sw > 400: errs.append(f"phone overflow {sw}")
            pg.close()
        print(m, "errors:", errs or "none"); print()
    b.close()
