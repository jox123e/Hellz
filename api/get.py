import json
import requests
from http.server import BaseHTTPRequestHandler

ROBLOX_ASSETS = "https://apis.roblox.com/assets/v1"

def send(handler, status, data):
    body = json.dumps(data).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)

def main(request):
    if request.command != "POST": return send(request, 405, {"error":"Usa POST"})
    try:
        n = int(request.headers.get("Content-Length", "0"))
        if n < 1 or n > 16384: return send(request, 400, {"error":"JSON inválido"})
        data = json.loads(request.rfile.read(n))
        key, asset_id = data.get("apiKey"), str(data.get("assetId", "")).strip()
        if not isinstance(key, str) or not key or not asset_id.isdigit(): return send(request, 400, {"error":"Falta apiKey o assetId inválido"})
        # Roblox's asset creation operation includes moderationResult. This route attempts
        # the asset details endpoint and returns a clear error if the key lacks access.
        r = requests.get(f"{ROBLOX_ASSETS}/assets/{asset_id}", headers={"x-api-key":key}, timeout=20)
        try: d = r.json()
        except Exception: d = {}
        if not r.ok:
            return send(request, r.status_code, {"error":d.get("message") or d.get("error") or f"Roblox respondió HTTP {r.status_code}; la API puede no permitir consultar moderación por assetId"})
        moderation = d.get("moderationResult") or {}
        state = moderation.get("moderationState") or d.get("moderationState") or "Unknown"
        return send(request, 200, {"assetId":asset_id, "moderationState":state})
    except Exception:
        return send(request, 500, {"error":"No se pudo consultar el asset"})

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        main(self)

    def do_OPTIONS(self):
        send(self, 200, {"ok": True})

    def do_GET(self):
        send(self, 200, {"ok": True, "route": "/api/get", "method": "POST required"})
