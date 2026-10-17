import base64
import ipaddress
import json
import socket
from io import BytesIO
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, urljoin, unquote

import requests

BASE_URL = "https://apis.roblox.com/assets/v1"
MAX_SIZE = 4 * 1024 * 1024
TYPES = ("Model", "Decal", "Image", "Audio", "Mesh", "Animation")


def check_url(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("El link debe empezar con https://")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443)
    except socket.gaierror:
        raise ValueError("No se pudo resolver el link.")
    for item in addresses:
        if not ipaddress.ip_address(item[4][0]).is_global:
            raise ValueError("Ese link no está permitido.")


def download(url):
    current = url
    for _ in range(4):
        check_url(current)
        response = requests.get(current, stream=True, allow_redirects=False, timeout=15)
        if response.is_redirect:
            current = urljoin(current, response.headers.get("Location", ""))
            continue
        if not response.ok:
            raise ValueError("No se pudo descargar el archivo del link.")
        data = b""
        for chunk in response.iter_content(65536):
            data += chunk
            if len(data) > MAX_SIZE:
                raise ValueError("El archivo del link supera los 4 MB.")
        name = unquote(urlparse(current).path.rsplit("/", 1)[-1]) or "archivo"
        return name, data
    raise ValueError("Demasiadas redirecciones en el link.")


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
            if length <= 0 or length > 6 * 1024 * 1024:
                raise ValueError("Solicitud no válida.")

            data = json.loads(self.rfile.read(length))

            api_key = str(data.get("apiKey", "")).strip()
            owner_id = str(data.get("ownerId", "")).strip()
            owner_type = str(data.get("ownerType", "user")).strip()
            asset_type = str(data.get("assetType", "")).strip()
            display_name = str(data.get("displayName", "")).strip() or "myfile"
            description = str(data.get("description", "")).strip()
            file_name = str(data.get("fileName", "")).strip()
            file_base64 = data.get("fileBase64")
            file_url = str(data.get("fileUrl", "")).strip()

            if file_url and not file_base64:
                file_name, raw = download(file_url)
            elif file_base64:
                raw = base64.b64decode(file_base64)
            else:
                raise ValueError("Falta fileBase64 o fileUrl.")

            if not api_key:
                raise ValueError("Falta la API Key.")
            if not owner_id.isdigit():
                raise ValueError("ownerId debe contener solo números.")
            if asset_type not in TYPES:
                raise ValueError("assetType no válido.")
            if not file_name or not raw:
                raise ValueError("Falta el archivo.")
            if len(raw) > MAX_SIZE:
                raise ValueError("El archivo supera los 4 MB.")
            if asset_type == "Model" and not file_name.lower().endswith((".rbxm", ".rbxmx")):
                raise ValueError("Model requiere un archivo .rbxm o .rbxmx.")

            creator = {"groupId": owner_id} if owner_type == "group" else {"userId": owner_id}
            metadata = {
                "assetType": asset_type,
                "displayName": display_name[:50],
                "description": description[:1000] or "Subido con Open Cloud",
                "creationContext": {"creator": creator},
            }
            mime = "model/x-rbxm" if asset_type == "Model" else "application/octet-stream"

            response = requests.post(
                f"{BASE_URL}/assets",
                headers={"x-api-key": api_key},
                files={
                    "request": (None, json.dumps(metadata), "application/json"),
                    "fileContent": (file_name, BytesIO(raw), mime),
                },
                timeout=50,
            )

            try:
                result = response.json()
            except ValueError:
                result = {"message": response.text[:500]}

            if not response.ok:
                self.reply(response.status_code,
                           {"error": result.get("message") or "Roblox rechazó la subida."})
                return

            operation = result.get("path", "")
            if operation.startswith("operations/"):
                self.reply(200, {"operation": operation})
            else:
                self.reply(200, result)

        except Exception as error:
            self.reply(400, {"error": str(error)})

    def log_message(self, format, *args):
        pass
