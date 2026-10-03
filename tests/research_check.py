# Loads the live Research page against each fixture and reports what renders.
from playwright.sync_api import sync_playwright
import urllib.request, json
def mode(m): urllib.request.urlopen("http://localhost:8765/__mode/" + m).read()
with sync_playwright() as p:
    b = p.chromium.launch()
    for m in ["hx_full", "hx_notrades", "rx_one", "rx_none", "empty", "fail"]:
        mode(m); errs = []
        for w in (1300, 400):
            pg = b.new_page(viewport={"width": w, "height": 900})
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda c: errs.append(c.text) if c.type == "error" and "PFW-SIF research data" not in c.text and "fonts" not in c.text and "Failed to load resource" not in c.text else None)
            pg.goto("http://localhost:8765/research"); pg.wait_for_timeout(1200)
            if w == 1300:
                info = pg.evaluate("""() => ({
                  status: document.getElementById('data-status').textContent, source: document.getElementById('data-source').textContent,
                  nav: [...document.querySelectorAll('#site-nav a')].map(a=>a.textContent+(a.getAttribute('aria-current')?'*':'')).join(','),
                  facts: [...document.querySelectorAll('.facts dd')].map(e=>e.textContent).join(' | '),
                  noData: !document.getElementById('no-data').hidden ? document.getElementById('no-data-title').textContent : null,
                  feat: document.querySelector('#feat h3')?.textContent, featStats: [...document.querySelectorAll('#feat .feat-stats .v')].map(e=>e.textContent).join(' | '),
                  counts: [...document.querySelectorAll('#counts .v')].map(e=>e.textContent).join(' | '),
                  score: [...document.querySelectorAll('#score .v')].map(e=>e.textContent).join(' | '),
                  rows: document.querySelectorAll('#r-t tr.rep-row').length, count: document.getElementById('count').textContent,
                  cov: [...document.querySelectorAll('#cov-t tbody tr')].map(r=>r.innerText.replace(/\\s+/g,' ')),
                  pipe: document.getElementById('pipe-sec').hidden ? 'hidden' : document.querySelectorAll('#pipe-t tbody tr').length
                })""")
                print(m, json.dumps(info, indent=0))
                if m == "hx_full":
                    pg.select_option('#f-decision', 'Approved'); pg.wait_for_timeout(100)
                    print("filter Approved ->", pg.locator('#count').text_content())
                    pg.select_option('#f-decision', ''); pg.fill('#q', 'adobe'); pg.wait_for_timeout(100)
                    print("search adobe ->", pg.locator('#count').text_content())
                    pg.click('#r-t tr.rep-row >> nth=0'); pg.wait_for_timeout(100)
                    print("detail:", pg.locator('#r-t tr.rep-detail').inner_text().replace("\n", " / ")[:400])
                    pg.fill('#q', 'zzzz'); pg.wait_for_timeout(100); print("no match:", pg.locator('#r-t td.empty-row').text_content())
                    pg.fill('#q', ''); pg.wait_for_timeout(100)
                    pg.click('a[href="/holdings"]'); pg.wait_for_timeout(1000); print("-> holdings nav:", [a.text_content()+('*' if a.get_attribute('aria-current') else '') for a in pg.query_selector_all('#site-nav a')])
                    pg.goto("http://localhost:8765/research"); pg.wait_for_timeout(1000)
                pg.screenshot(path=f"/tmp/res_{m}.png", full_page=True)
            else:
                sw = pg.evaluate("document.documentElement.scrollWidth")
                if sw > 400: errs.append(f"phone overflow {sw}")
                over = pg.evaluate("[...document.querySelectorAll('.table-wrap')].filter(x=>x.scrollWidth>x.clientWidth+1).map(x=>x.querySelector('table')?.id)")
                if over: errs.append(f"tables scroll on phone: {over}")
                if m == "hx_full": pg.screenshot(path=f"/tmp/res_{m}_phone.png", full_page=True)
            pg.close()
        print("  errors:", errs)
    b.close()
