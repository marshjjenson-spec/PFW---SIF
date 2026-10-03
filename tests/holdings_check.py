# Loads the live Holdings page against each fixture and reports what renders.
from playwright.sync_api import sync_playwright
import urllib.request, json
def mode(m): urllib.request.urlopen("http://localhost:8765/__mode/" + m).read()
with sync_playwright() as p:
    b = p.chromium.launch()
    for m in ["hx_full", "hx_nobm", "hx_allsold", "empty", "fail"]:
        mode(m); errs = []
        for w in (1300, 400):
            pg = b.new_page(viewport={"width": w, "height": 900})
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda c: errs.append(c.text) if c.type == "error" and "PFW-SIF holdings data" not in c.text and "fonts" not in c.text and "Failed to load resource" not in c.text else None)
            pg.goto("http://localhost:8765/holdings"); pg.wait_for_timeout(1200)
            if w == 1300:
                info = pg.evaluate("""() => ({
                  status: document.getElementById('data-status').textContent, source: document.getElementById('data-source').textContent,
                  nav: [...document.querySelectorAll('#site-nav a')].map(a=>a.textContent+(a.getAttribute('aria-current')?'*':'')).join(','),
                  noData: !document.getElementById('no-data').hidden ? document.getElementById('no-data-title').textContent : null,
                  summary: [...document.querySelectorAll('#hold-summary .v')].map(e=>e.textContent).join(' | '),
                  rows: document.querySelectorAll('#hold-t tr.pos-row').length, legendCols: document.querySelectorAll('#legend-t thead th').length,
                  conc: [...document.querySelectorAll('#conc .v')].map(e=>e.textContent).join(' | '),
                  policy: [...document.querySelectorAll('#policy-t tbody tr')].map(r=>r.innerText.replace(/\\s+/g,' ').slice(0,90)),
                  inc: [...document.querySelectorAll('#inc-cells .v')].map(e=>e.textContent).join(' | '), divRows: document.querySelectorAll('#div-t tbody tr').length,
                  tx: document.querySelectorAll('#act-t tr.tx-row').length, closed: document.querySelectorAll('#closed-t tbody tr').length, closedShown: !document.getElementById('closed-sec').hidden,
                  hint: document.getElementById('alloc-hint').textContent
                })""")
                print(m, json.dumps(info, indent=0))
                if m == "hx_full":
                    pg.click('#act-t tr.tx-row >> nth=0'); pg.wait_for_timeout(100)
                    print("tx note:", pg.locator('#act-t .txd').inner_text().replace("\n", " / ")[:300])
                    pg.click('#hold-t tr.pos-row >> nth=0'); pg.wait_for_timeout(100)
                    print("detail:", pg.locator('#hold-t tr.detail').inner_text().replace("\n", " / ")[:300])
                    with pg.expect_download() as dl: pg.click('#dl-csv')
                    print("csv:", open(dl.value.path()).read().splitlines()[:2])
                    pg.click('#alloc-view button[data-v=position]'); pg.wait_for_timeout(100)
                    pg.click('a[href="/"]'); pg.wait_for_timeout(1200)
                    print("clicked Performance tab ->", pg.url, [a.text_content()+('*' if a.get_attribute('aria-current') else '') for a in pg.query_selector_all('#site-nav a')])
                    pg.goto("http://localhost:8765/holdings"); pg.wait_for_timeout(1000)
                pg.screenshot(path=f"/tmp/hold_{m}.png", full_page=True)
            else:
                sw = pg.evaluate("document.documentElement.scrollWidth")
                if sw > 400: errs.append(f"phone overflow {sw}")
                if m == "hx_full": pg.screenshot(path=f"/tmp/hold_{m}_phone.png", full_page=False)
            pg.close()
        print("  errors:", errs)
    b.close()
