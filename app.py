
import os
import re
import json
import socket
import ipaddress
from pathlib import Path
from urllib.parse import urlparse

import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__)
BASE_DIR = Path(__file__).resolve().parent

ROBLOX_API_KEY = os.environ.get("ROBLOX_API_KEY", "")
API_ACCESS_TOKEN = os.environ.get("API_ACCESS_TOKEN", "")
ROBLOX_API = "https://apis.roblox.com/assets/v1"
MAX_FILE_SIZE = 20 * 1024 * 1024


def authorized():
    supplied = request.headers.get("Authorization", "")
    expected = "Bearer " + API_ACCESS_TOKEN
    return bool(API_ACCESS_TOKEN) and supplied == expected


def error(message, status=400):
    return jsonify({"error": message}), status


@app.before_request
def check_api_auth():
    if request.path.startswith("/v1/"):
        if not authorized():
            return error("No autorizado.", 401)

        if not ROBLOX_API_KEY:
            return error("Falta configurar ROBLOX_API_KEY en el servidor.", 500)


def validate_url(url):
    try:
        parsed = urlparse(url)

        if parsed.scheme != "https" or not parsed.hostname:
            return False, "La URL debe ser HTTPS."

        if parsed.username or parsed.password:
            return False, "La URL no puede incluir credenciales."

        if parsed.port not in (None, 443):
            return False, "Solo se permite HTTPS por el puerto 443."

        extension = Path(parsed.path).suffix.lower()
        if extension not in (".rbxm", ".rbxmx"):
            return False, "El archivo debe terminar en .rbxm o .rbxmx."

        addresses = socket.getaddrinfo(
            parsed.hostname, 443, type=socket.SOCK_STREAM
        )

        if not addresses:
            return False, "No se pudo resolver el servidor de la URL."

        for address in addresses:
            ip = ipaddress.ip_address(address[4][0])
            if not ip.is_global:
                return False, "La URL apunta a una dirección no pública."

        return True, ""

    except (ValueError, OSError):
        return False, "La URL no es válida o no se puede verificar."


def download_model(url):
    valid, reason = validate_url(url)
    if not valid:
        raise ValueError(reason)

    parsed = urlparse(url)
    filename = Path(parsed.path).name
    content = bytearray()

    # No se siguen redirecciones para reducir riesgos de SSRF.
    with requests.get(
        url,
        stream=True,
        allow_redirects=False,
        timeout=(10, 45),
        headers={"User-Agent": "RobloxModelPublisher/1.0"}
    ) as response:
        if response.status_code != 200:
            raise ValueError(
                f"La URL respondió con HTTP {response.status_code}."
            )

        length = response.headers.get("Content-Length")
        if length and int(length) > MAX_FILE_SIZE:
            raise ValueError("El archivo supera el límite de 20 MB.")

        for chunk in response.iter_content(chunk_size=65536):
            if not chunk:
                continue

            content.extend(chunk)

            if len(content) > MAX_FILE_SIZE:
                raise ValueError("El archivo supera el límite de 20 MB.")

    data = bytes(content)

    if filename.lower().endswith(".rbxmx"):
        if not data.lstrip().startswith(b"<roblox"):
            raise ValueError("El archivo no parece un RBXMX válido.")
    else:
        if not data.startswith(b"<roblox!"):
            raise ValueError("El archivo no parece un RBXM binario válido.")

    return filename, data


def creator_metadata(creator_type, creator_id):
    if creator_type not in ("user", "group"):
        raise ValueError("creatorType debe ser 'user' o 'group'.")

    if not creator_id.isdigit():
        raise ValueError("creatorId debe ser un ID numérico.")

    creator_key = "userId" if creator_type == "user" else "groupId"

    return {
        "assetType": "Model",
        "displayName": "",
        "description": "",
        "creationContext": {
            "creator": {creator_key: creator_id}
        }
    }


def operation_id_from(data):
    path = data.get("path", "")
    match = re.search(r"(?:^|/)operations/([^/?]+)", path)

    if match:
        return match.group(1)

    return data.get("operationId")


@app.get("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/style.css")
def style():
    return send_from_directory(BASE_DIR, "style.css")


@app.get("/script.js")
def javascript():
    return send_from_directory(BASE_DIR, "script.js")


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/v1/upload")
def upload():
    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        return error("Se necesita un cuerpo JSON válido.")

    url = str(payload.get("url", "")).strip()
    creator_type = str(payload.get("creatorType", ""))
    creator_id = str(payload.get("creatorId", "")).strip()
    name = str(payload.get("name", "")).strip()
    description = str(payload.get("description", "")).strip()

    if not url or not creator_id or not name:
        return error("Faltan url, creatorId o name.")

    if len(name) > 50 or len(description) > 1000:
        return error("El nombre o la descripción son demasiado largos.")

    try:
        filename, content = download_model(url)

        metadata = creator_metadata(creator_type, creator_id)
        metadata["displayName"] = name
        metadata["description"] = description

        response = requests.post(
            f"{ROBLOX_API}/assets",
            headers={"x-api-key": ROBLOX_API_KEY},
            data={"request": json.dumps(metadata)},
            files={
                "fileContent": (
                    filename,
                    content,
                    "model/x-rbxm"
                )
            },
            timeout=90
        )

        try:
            result = response.json()
        except ValueError:
            result = {"message": response.text[:1000]}

        if not response.ok:
            return jsonify({
                "error": "Roblox rechazó la solicitud.",
                "robloxStatus": response.status_code,
                "details": result
            }), 502

        op_id = operation_id_from(result)

        if not op_id:
            return jsonify({
                "error": "Roblox respondió, pero no devolvió una operación reconocible.",
                "details": result
            }), 502

        return jsonify({
            "operationId": op_id,
            "done": result.get("done", False),
            "assetId": None,
            "moderationState": None,
            "message": "Solicitud enviada a Roblox.",
            "raw": result
        }), 202

    except ValueError as exc:
        return error(str(exc), 400)
    except requests.RequestException:
        app.logger.exception("Error de conexión")
        return error("No se pudo conectar con el servidor remoto.", 502)
    except Exception:
        app.logger.exception("Error inesperado al publicar")
        return error("Ocurrió un error interno.", 500)


@app.get("/v1/operations/<path:op_id>")
def get_operation(op_id):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", op_id):
        return error("Identificador de operación no válido.")

    try:
        response = requests.get(
            f"{ROBLOX_API}/operations/{op_id}",
            headers={"x-api-key": ROBLOX_API_KEY},
            timeout=30
        )

        try:
            data = response.json()
        except ValueError:
            data = {"message": response.text[:1000]}

        if not response.ok:
            return jsonify({
                "error": "No se pudo consultar la operación en Roblox.",
                "robloxStatus": response.status_code,
                "details": data
            }), 502

        response_data = data.get("response") or {}
        moderation = response_data.get("moderationResult") or {}

        return jsonify({
            "operationId": op_id,
            "done": data.get("done", False),
            "assetId": response_data.get("assetId"),
            "assetType": response_data.get("assetType"),
            "name": response_data.get("displayName"),
            "moderationState": moderation.get("moderationState"),
            "error": data.get("error"),
            "raw": data
        })

    except requests.RequestException:
        app.logger.exception("Error consultando operación")
        return error("No se pudo conectar con Roblox.", 502)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")))
