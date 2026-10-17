import json
import ipaddress
import socket
from urllib.parse import urlparse

import requests
from http.server import BaseHTTPRequestHandler

ROBLOX_ASSETS = "https://apis.roblox.com/assets/v1"
MAX_FILE_SIZE = 20 * 1024 * 1024
TIMEOUT = 25


def json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
        if length <= 0 or length > 65536:
            raise ValueError("Cuerpo vacío o demasiado grande")
        return json.loads(handler.rfile.read(length).decode("utf-8"))
    except Exception as exc:
        raise ValueError("JSON inválido o demasiado grande") from exc


def validate_file_url(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("fileUrl debe ser un enlace HTTPS directo y válido")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        for item in addresses:
            ip = ipaddress.ip_address(item[4][0])
            if not ip.is_global:
                raise ValueError("El host del archivo no es público")
    except socket.gaierror as exc:
        raise ValueError("No se pudo resolver el host de fileUrl") from exc
    if not parsed.path.lower().endswith((".rbxm", ".rbxmx")):
        raise ValueError("El enlace debe apuntar directamente a un archivo .rbxm o .rbxmx")


def handle_upload(request):
    # Vercel Python runtime passes a BaseHTTPRequestHandler-like request.
    if request.command != "POST":
        return json_response(request, 405, {"error": "Usa POST"})
    try:
        data = read_json(request)
        api_key = data.get("apiKey")
        owner_id = str(data.get("ownerId", "")).strip()
        owner_type = data.get("ownerType", "user")
        file_url = str(data.get("fileUrl", "")).strip()
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("Falta apiKey")
        if not owner_id.isdigit():
            raise ValueError("ownerId debe ser numérico")
        if owner_type not in ("user", "group"):
            raise ValueError("ownerType debe ser user o group")
        validate_file_url(file_url)

        # Download only the requested file; never log or return the API key.
        with requests.get(file_url, stream=True, timeout=TIMEOUT, allow_redirects=False) as downloaded:
            if downloaded.status_code != 200:
                return json_response(request, 400, {"error": f"No se pudo descargar el archivo (HTTP {downloaded.status_code}). Usa un enlace directo."})
            chunks, total = [], 0
            for chunk in downloaded.iter_content(65536):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_FILE_SIZE:
                    return json_response(request, 413, {"error": "El archivo supera el límite de 20 MB"})
                chunks.append(chunk)
            file_bytes = b"".join(chunks)

        context_creator = {"userId": owner_id} if owner_type == "user" else {"groupId": owner_id}
        metadata = {
            "assetType": data.get("assetType", "Model"),
            "displayName": str(data.get("name") or data.get("displayName") or "myfile")[:50],
            "description": str(data.get("description") or "")[:1000],
            "creationContext": {"creator": context_creator}
        }
        filename = urlparse(file_url).path.rsplit("/", 1)[-1] or "model.rbxmx"
        content_type = "model/x-rbxm"
        files = {
            "request": (None, json.dumps(metadata), "application/json"),
            "fileContent": (filename, file_bytes, content_type)
        }
        response = requests.post(
            f"{ROBLOX_ASSETS}/assets",
            headers={"x-api-key": api_key.strip()}, files=files, timeout=TIMEOUT
        )
        try:
            result = response.json()
        except Exception:
            result = {"error": response.text[:500]}
        if not response.ok:
            # Avoid returning any request headers or credential-bearing details.
            return json_response(request, response.status_code, {"error": result.get("message") or result.get("error") or f"Roblox respondió HTTP {response.status_code}"})
        operation = result.get("path") or result.get("operation") or result.get("operationId")
        if isinstance(operation, str) and operation.startswith("operations/"):
            operation = operation.rsplit("/", 1)[-1]
        if not operation:
            return json_response(request, 502, {"error": "Roblox no devolvió una operación reconocible", "details": result})
        return json_response(request, 200, {"operation": operation})
    except ValueError as exc:
        return json_response(request, 400, {"error": str(exc)})
    except requests.RequestException:
        return json_response(request, 502, {"error": "Error de conexión con el archivo o Roblox"})
    except Exception:
        return json_response(request, 500, {"error": "Error interno procesando la subida"})


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        handle_upload(self)

    def do_OPTIONS(self):
        json_response(self, 200, {"ok": True})

    def do_GET(self):
        json_response(self, 200, {"ok": True, "route": "/api/upload", "method": "POST required"})
