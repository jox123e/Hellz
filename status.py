import json
import re
from http.server import BaseHTTPRequestHandler

import requests

BASE_URL = "https://apis.roblox.com/assets/v1"
OPERATION = re.compile(r"^operations/[A-Za-z0-9_-]+$")


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
            operation = str(data.get("operation", "")).strip()

            if not api_key:
                raise ValueError("Falta la API Key.")
            if not OPERATION.match(operation):
                raise ValueError("Operación no válida.")

            check = requests.get(
                f"{BASE_URL}/{operation}",
                headers={"x-api-key": api_key},
                timeout=20,
            )

            try:
                result = check.json()
            except ValueError:
                result = {"message": check.text[:500]}

            if not check.ok:
                self.reply(
                    check.status_code,
                    {"error": result.get("message") or "Error consultando la operación."},
                )
                return

            if not result.get("done"):
                self.reply(200, {"done": False})
                return

            if result.get("error"):
                self.reply(
                    200,
                    {"done": True,
                     "error": result["error"].get("message") or "La subida falló."},
                )
                return

            asset_id = (result.get("response") or {}).get("assetId")
            self.reply(200, {"done": True, "assetId": asset_id})

        except Exception as error:
            self.reply(400, {"error": str(error)})

    def log_message(self, format, *args):
        pass
