# Serves the site plus a fake Supabase REST API for local testing.
import json, sys, os, http.server, socketserver
SITE = os.path.join(os.path.dirname(__file__), "..", "site")
MODE = {"fixture": None, "fail": False}
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=SITE, **k)
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith("/__mode/"):
            name = self.path.split("/")[-1]
            MODE["fail"] = name == "fail"
            MODE["fixture"] = None if name in ("empty", "fail") else json.load(open(f"/tmp/{name}.json"))
            return self._send(200, {"ok": True})
        if self.path.startswith("/config.js"):
            body = b'window.PFW_CONFIG={supabaseUrl:"http://localhost:8765",supabaseKey:"sb_publishable_test",applyUrl:"https://example.org/apply",nav:[{label:"Performance",href:"/"},{label:"Holdings",href:"/holdings"},{label:"Research",href:"/research"}]};'
            self.send_response(200); self.send_header("Content-Type","application/javascript"); self.end_headers(); return self.wfile.write(body)
        if self.path.startswith("/rest/v1/"):
            if MODE["fail"]: return self._send(503, {"message": "down"})
            fx = MODE["fixture"] or {"rows": [], "profile": [{"id": 1, "performance_type": "simulated", "risk_free_rate": 0, "risk_free_source": "Not yet configured", "data_through": None}]}
            if "public_snapshots" in self.path:
                if "in.(" in self.path:  # research page asks for research + holdings together
                    out = [dict(r, id="holdings") for r in fx.get("snapshot", [])] + [dict(r, id="research") for r in fx.get("research", [])]
                    return self._send(200, out)
                return self._send(200, fx.get("snapshot", []))
            return self._send(200, fx["rows"] if "monthly_returns" in self.path else fx["profile"])
        if self.path.split("?")[0] in ("/holdings", "/research"): self.path = self.path.split("?")[0] + ".html"  # Vercel cleanUrls
        return super().do_GET()
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type","application/json"); self.end_headers(); self.wfile.write(b)
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", 8765), H) as s: s.serve_forever()
