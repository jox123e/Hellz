
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ROBLOX_ASSETS = "https://apis.roblox.com/assets/v1";

function send(res, status, data) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.status(status).json(data);
}

function validPublicIp(ip) {
    if (ip.includes(":")) {
        const s = ip.toLowerCase();

        if (s.startsWith("::ffff:")) {
            const mapped = s.slice(7);
            if (mapped.includes(".")) return validPublicIp(mapped);
        }

        return !(
            s === "::1" ||
            s === "::" ||
            s.startsWith("fc") ||
            s.startsWith("fd") ||
            s.startsWith("fe80:") ||
            s.startsWith("ff")
        );
    }

    const p = ip.split(".").map(Number);

    if (
        p.length !== 4 ||
        p.some(n => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
        return false;
    }

    return !(
        p[0] === 0 ||
        p[0] === 10 ||
        p[0] === 127 ||
        p[0] >= 224 ||
        (p[0] === 169 && p[1] === 254) ||
        (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
        (p[0] === 192 && p[1] === 168) ||
        (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    );
}

async function validateFileUrl(raw) {
    let url;

    try {
        url = new URL(raw);
    } catch {
        throw new Error("fileUrl no es una URL válida");
    }

    if (url.protocol !== "https:" || url.username || url.password) {
        throw new Error("fileUrl debe usar HTTPS y no incluir credenciales");
    }

    if (!/\.(rbxm|rbxmx)$/i.test(url.pathname)) {
        throw new Error("El enlace debe terminar en .rbxm o .rbxmx");
    }

    const host = url.hostname.toLowerCase();

    if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host === "metadata.google.internal"
    ) {
        throw new Error("El host del archivo no es público");
    }

    const { lookup } = await import("node:dns/promises");
    let addresses;

    try {
        addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
        throw new Error("No se pudo resolver el host de fileUrl");
    }

    if (
        !addresses.length ||
        addresses.some(address => !validPublicIp(address.address))
    ) {
        throw new Error("El host del archivo no es público");
    }

    return url;
}

function validateModelBuffer(buffer, filename) {
    if (!buffer || buffer.length < 8) {
        throw new Error("El archivo está vacío o es demasiado pequeño");
    }

    const header = buffer
        .subarray(0, Math.min(buffer.length, 512))
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .trimStart()
        .toLowerCase();

    if (
        header.startsWith("<!doctype html") ||
        header.startsWith("<html") ||
        header.startsWith("<head") ||
        header.startsWith("<body")
    ) {
        throw new Error("fileUrl devolvió HTML en lugar de un modelo Roblox");
    }

    const isBinary =
        buffer.subarray(0, 8).toString("ascii") === "<roblox!";

    const isXml =
        header.startsWith("<?xml") ||
        header.startsWith("<roblox");

    const isRbxmx = filename.toLowerCase().endsWith(".rbxmx");
    const isRbxm = filename.toLowerCase().endsWith(".rbxm");

    if (isRbxmx && !isXml) {
        throw new Error("El archivo .rbxmx no parece ser XML de Roblox");
    }

    if (isRbxm && !isBinary) {
        throw new Error("El archivo .rbxm no tiene la cabecera binaria esperada");
    }
}

function findAssetId(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 10) {
        return null;
    }

    if (
        value.assetId != null &&
        /^\d+$/.test(String(value.assetId))
    ) {
        return String(value.assetId);
    }

    if (typeof value.path === "string") {
        const match = value.path.match(/(?:^|\/)assets\/(\d+)\/?$/);
        if (match) return match[1];
    }

    for (const key of ["response", "asset", "result", "data"]) {
        const found = findAssetId(value[key], depth + 1);
        if (found) return found;
    }

    return null;
}

function findOperation(value) {
    if (!value || typeof value !== "object") return null;

    for (const candidate of [
        value.operationId,
        value.operation,
        value.path
    ]) {
        if (
            typeof candidate === "string" &&
            /^operations\/[A-Za-z0-9_-]+$/.test(candidate)
        ) {
            return candidate.slice("operations/".length);
        }
    }

    for (const key of ["response", "result", "data"]) {
        const found = findOperation(value[key]);
        if (found) return found;
    }

    return null;
}

module.exports = async function handler(req, res) {
    if (req.method === "OPTIONS") {
        return send(res, 200, { ok: true });
    }

    if (req.method === "GET") {
        return send(res, 200, {
            ok: true,
            route: "/api/upload",
            method: "POST required",
            runtime: "nodejs"
        });
    }

    if (req.method !== "POST") {
        return send(res, 405, { error: "Usa POST" });
    }

    try {
        const data =
            req.body && typeof req.body === "object"
                ? req.body
                : {};

        const apiKey =
            typeof data.apiKey === "string" ? data.apiKey.trim() : "";

        const ownerId = String(data.ownerId || "").trim();
        const ownerType = data.ownerType || "user";
        const fileUrl = String(data.fileUrl || "").trim();

        if (!apiKey) {
            return send(res, 400, { error: "Falta apiKey" });
        }

        if (!/^\d+$/.test(ownerId)) {
            return send(res, 400, { error: "ownerId debe ser numérico" });
        }

        if (!["user", "group"].includes(ownerType)) {
            return send(res, 400, {
                error: "ownerType debe ser user o group"
            });
        }

        if (String(data.assetType || "Model") !== "Model") {
            return send(res, 400, {
                error: "Este endpoint solo permite subir modelos (Model)"
            });
        }

        let file;

        try {
            file = await validateFileUrl(fileUrl);
        } catch (error) {
            return send(res, 400, { error: error.message });
        }

        // Permite redirecciones HTTPS habituales de servicios de archivos.
        const downloaded = await fetch(file, {
            redirect: "follow",
            signal: AbortSignal.timeout(25000)
        });

        if (!downloaded.ok) {
            return send(res, 400, {
                error: `No se pudo descargar el archivo (HTTP ${downloaded.status}).`
            });
        }

        if (downloaded.url && !downloaded.url.startsWith("https://")) {
            return send(res, 400, {
                error: "La descarga terminó en una URL que no usa HTTPS"
            });
        }

        const declaredLength = Number(
            downloaded.headers.get("content-length") || 0
        );

        if (declaredLength > MAX_FILE_SIZE) {
            return send(res, 413, {
                error: "El archivo supera el límite de 20 MB"
            });
        }

        const fileBuffer = Buffer.from(await downloaded.arrayBuffer());

        if (!fileBuffer.length) {
            return send(res, 400, { error: "El archivo descargado está vacío" });
        }

        if (fileBuffer.length > MAX_FILE_SIZE) {
            return send(res, 413, {
                error: "El archivo supera el límite de 20 MB"
            });
        }

        let filename;

        try {
            filename = decodeURIComponent(
                file.pathname.split("/").pop() || "model.rbxmx"
            );
        } catch {
            filename = file.pathname.split("/").pop() || "model.rbxmx";
        }

        try {
            validateModelBuffer(fileBuffer, filename);
        } catch (error) {
            return send(res, 400, {
                error: error.message,
                fileSize: fileBuffer.length,
                filename
            });
        }

        const metadata = {
            assetType: "Model",
            displayName: String(
                data.name || data.displayName || "myfile"
            ).slice(0, 50),
            description: String(data.description || "").slice(0, 1000),
            creationContext: {
                creator: ownerType === "group"
                    ? { groupId: ownerId }
                    : { userId: ownerId }
            }
        };

        const form = new FormData();
        form.append("request", JSON.stringify(metadata));
        form.append(
            "fileContent",
            new Blob([fileBuffer], { type: "model/x-rbxm" }),
            filename
        );

        console.log("[UPLOAD] Archivo validado:", {
            filename,
            fileSize: fileBuffer.length,
            ownerType,
            ownerId
        });

        const response = await fetch(`${ROBLOX_ASSETS}/assets`, {
            method: "POST",
            headers: { "x-api-key": apiKey },
            body: form,
            signal: AbortSignal.timeout(55000)
        });

        const raw = await response.text();
        let result;

        try {
            result = JSON.parse(raw);
        } catch {
            result = { message: raw.slice(0, 1000) };
        }

        console.log("[UPLOAD] HTTP Roblox:", response.status);

        if (!response.ok) {
            console.error(
                "[UPLOAD] Roblox error:",
                response.status,
                JSON.stringify(result)
            );

            return send(res, response.status, {
                error:
                    result.message ||
                    result.error?.message ||
                    result.error ||
                    `Roblox respondió HTTP ${response.status}`,
                details: result
            });
        }

        const assetId = findAssetId(result);
        const operation = findOperation(result);

        console.log("[UPLOAD] Resultado:", JSON.stringify({
            assetId,
            operation,
            responseKeys: Object.keys(result || {})
        }));

        // Si Roblox ya entregó el ID, devolverlo directamente.
        if (assetId) {
            return send(res, 200, {
                success: true,
                done: true,
                assetId,
                assetUrl: `https://www.roblox.com/library/${assetId}`,
                operation: operation || null,
                response: result
            });
        }

        // Si Roblox devuelve una operación, el endpoint /status
        // debe consultar su finalización.
        if (operation) {
            return send(res, 200, {
                success: true,
                done: false,
                operation,
                assetId: null,
                response: result
            });
        }

        console.error(
            "[UPLOAD] Respuesta sin assetId ni operación:",
            JSON.stringify(result)
        );

        return send(res, 502, {
            success: false,
            error: "Roblox no devolvió assetId ni un identificador de operación",
            details: result
        });
    } catch (error) {
        console.error("[UPLOAD] Error interno:", error);

        const isTimeout = error?.name === "TimeoutError";

        return send(res, isTimeout ? 504 : 500, {
            error: isTimeout
                ? "La solicitud agotó el tiempo de espera"
                : "Error interno procesando la subida"
        });
    }
};
