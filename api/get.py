import json
from http.server import BaseHTTPRequestHandler

import requests

BASE_URL = "https://apis.roblox.com/assets/v1"


class handler(BaseHTTPRequestHandler):

    def reply(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 10_000:
                raise ValueError("Solicitud no válida.")

            data = json.loads(self.rfile.read(length))
            api_key = str(data.get("apiKey", "")).strip()
            asset_id = str(data.get("assetId", "")).strip()

            if not api_key:
                raise ValueError("Falta la API Key.")
            if not asset_id.isdigit():
                raise ValueError("assetId debe contener solo números.")

            response = requests.get(
                f"{BASE_URL}/assets/{asset_id}",
                headers={"x-api-key": api_key},
                params={"readMask": "moderationResult,state"},
                timeout=20,
            )

            try:
                result = response.json()
            except ValueError:
                result = {"message": response.text[:500]}

            if not response.ok:
                self.reply(response.status_code,
                           {"error": result.get("message") or "No se pudo consultar el asset."})
                return

            moderation = (result.get("moderationResult") or {}).get("moderationState", "Unknown")
            self.reply(200, {"assetId": asset_id, "moderationState": moderation, "raw": result})

        except Exception as error:
            self.reply(400, {"error": str(error)})

    def log_message(self, format, *args):
        pass
