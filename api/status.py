import json
import requests
from http.server import BaseHTTPRequestHandler

ROBLOX_ASSETS = "https://apis.roblox.com/assets/v1"

def send(handler, status, data):
    body = json.dumps(data).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)

def main(request):
    if request.command != "POST": return send(request, 405, {"error":"Usa POST"})
    try:
        n = int(request.headers.get("Content-Length", "0"))
        if n < 1 or n > 16384: return send(request, 400, {"error":"JSON inválido"})
        data = json.loads(request.rfile.read(n))
        key, operation = data.get("apiKey"), str(data.get("operation", "")).strip()
        if not isinstance(key, str) or not key or not operation: return send(request, 400, {"error":"Falta apiKey u operation"})
        if operation.startswith("operations/"): operation = operation.rsplit("/", 1)[-1]
        r = requests.get(f"{ROBLOX_ASSETS}/operations/{operation}", headers={"x-api-key":key}, timeout=20)
        try: d = r.json()
        except Exception: d = {}
        if not r.ok: return send(request, r.status_code, {"error":d.get("message") or d.get("error") or f"Roblox respondió HTTP {r.status_code}"})
        response = d.get("response") or {}
        moderation = response.get("moderationResult") or {}
        return send(request, 200, {"done": bool(d.get("done")), "assetId": response.get("assetId"), "moderationState": moderation.get("moderationState"), "response": response})
    except Exception:
        return send(request, 500, {"error":"No se pudo consultar la operación"})

class Handler(BaseHTTPRequestHandler):
    def do_POST(self): main(self)
