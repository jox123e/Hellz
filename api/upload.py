import json
import mimetypes
from io import BytesIO
from http.server import BaseHTTPRequestHandler
from email.parser import BytesParser
from email.policy import default

import requests

BASE_URL = "https://apis.roblox.com/assets/v1"
MAX_SIZE = 4 * 1024 * 1024
TYPES = ("Model", "Decal", "Image", "Audio", "Mesh", "Animation")


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
            if length <= 0 or length > MAX_SIZE + 512 * 1024:
                raise ValueError("Tamaño de solicitud no válido (máximo 4 MB).")

            content_type = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in content_type:
                raise ValueError("Formulario multipart requerido.")

            body = self.rfile.read(length)
            raw = (
                b"Content-Type: " + content_type.encode("ascii")
                + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
            )
            message = BytesParser(policy=default).parsebytes(raw)

            fields = {}
            uploaded_file = None
            filename = None

            for part in message.iter_parts():
                name = part.get_param("name", header="content-disposition")
                payload = part.get_payload(decode=True) or b""
                if name == "file":
                    filename = part.get_filename()
                    uploaded_file = payload
                elif name:
                    charset = part.get_content_charset() or "utf-8"
                    fields[name] = payload.decode(charset, errors="replace")

            api_key = fields.get("apiKey", "").strip()
            owner_id = fields.get("ownerId", "").strip()
            owner_type = fields.get("ownerType", "user").strip()
            asset_type = fields.get("assetType", "").strip()
            display_name = fields.get("displayName", "").strip()
            description = fields.get("description", "").strip()

            if not api_key:
                raise ValueError("Falta la API Key.")
            if not owner_id.isdigit():
                raise ValueError("El ID debe contener solo números.")
            if asset_type not in TYPES:
                raise ValueError("Asset Type no válido.")
            if not display_name:
                raise ValueError("Escribe el nombre del asset.")
            if not filename or uploaded_file is None:
                raise ValueError("Selecciona un archivo.")
            if not uploaded_file:
                raise ValueError("El archivo está vacío.")
            if len(uploaded_file) > MAX_SIZE:
                raise ValueError("El archivo supera los 4 MB.")
            if asset_type == "Model" and not filename.lower().endswith(
                (".rbxm", ".rbxmx")
            ):
                raise ValueError("Model requiere un archivo .rbxm o .rbxmx.")

            creator = (
                {"groupId": owner_id}
                if owner_type == "group"
                else {"userId": owner_id}
            )

            metadata = {
                "assetType": asset_type,
                "displayName": display_name[:50],
                "description": description[:1000] or "Subido con Open Cloud",
                "creationContext": {"creator": creator},
            }

            mime = (
                "model/x-rbxm"
                if asset_type == "Model"
                else mimetypes.guess_type(filename)[0]
                or "application/octet-stream"
            )

            response = requests.post(
                f"{BASE_URL}/assets",
                headers={"x-api-key": api_key},
                files={
                    "request": (None, json.dumps(metadata), "application/json"),
                    "fileContent": (filename, BytesIO(uploaded_file), mime),
                },
                timeout=50,
            )

            try:
                result = response.json()
            except ValueError:
                result = {"message": response.text[:500]}

            if not response.ok:
                self.reply(
                    response.status_code,
                    {"error": result.get("message") or "Roblox rechazó la subida.",
                     "httpStatus": response.status_code},
                )
                return

            operation = result.get("path", "")
            if not operation.startswith("operations/"):
                self.reply(200, result)
                return

            self.reply(200, {"operation": operation})

        except Exception as error:
            self.reply(400, {"error": str(error)})

    def log_message(self, format, *args):
        pass
