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

function findAssetId(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 10) return null;

    if (value.assetId != null && /^\d+$/.test(String(value.assetId))) {
        return String(value.assetId);
    }

    if (typeof value.path === "string") {
        const match = value.path.match(/(?:^|\/)assets\/(\d+)\/?$/);
        if (match) return match[1];
    }

    for (const key of ["response", "asset", "result", "data"]) {
        const id = findAssetId(value[key], depth + 1);
        if (id) return id;
    }

    return null;
}

function findOperation(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 10) return null;

    for (const candidate of [value.operationId, value.operation, value.path]) {
        if (typeof candidate !== "string") continue;

        const match = candidate.match(
            /^(?:operations\/)?([A-Za-z0-9_-]+)$/
        );

        if (match) return match[1];
    }

    for (const key of ["response", "result", "data"]) {
        const found = findOperation(value[key], depth + 1);
        if (found) return found;
    }

    return null;
}

function validPublicIp(ip) {
    if (ip.includes(":")) {
        const s = ip.toLowerCase();

        if (s.startsWith("::ffff:")) {
            const mapped = s.slice(7);
            if (mapped.includes(".")) return validPublicIp(mapped);
        }

        return !(
            s === "::" ||
            s === "::1" ||
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
    ) return false;

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
        addresses.some(a => !validPublicIp(a.address))
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

    if (/^(<!doctype html|<html|<head|<body)/.test(header)) {
        throw new Error("El enlace devolvió HTML, no un modelo Roblox");
    }

    const isRbxmx = /\.rbxmx$/i.test(filename);
    const isRbxm = /\.rbxm$/i.test(filename);
    const isBinary = buffer.subarray(0, 8).toString("ascii") === "<roblox!";
    const isXml = header.startsWith("<?xml") || header.startsWith("<roblox");

    if (isRbxmx && !isXml) {
        throw new Error("El archivo .rbxmx no parece XML de Roblox");
    }

    if (isRbxm && !isBinary) {
        throw new Error("El archivo .rbxm no tiene la cabecera esperada");
    }
}

module.exports = async function handler(req, res) {
    if (req.method === "OPTIONS") return send(res, 200, { ok: true });

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
        const data = req.body && typeof req.body === "object" ? req.body : {};
        const apiKey = typeof data.apiKey === "string" ? data.apiKey.trim() : "";
        const ownerId = String(data.ownerId || "").trim();
        const ownerType = data.ownerType || "user";
        const fileUrl = String(data.fileUrl || "").trim();

        if (!apiKey) return send(res, 400, { error: "Falta apiKey" });

        if (!/^\d+$/.test(ownerId)) {
            return send(res, 400, { error: "ownerId debe ser numérico" });
        }

        if (!["user", "group"].includes(ownerType)) {
            return send(res, 400, { error: "ownerType debe ser user o group" });
        }

        if (String(data.assetType || "Model") !== "Model") {
            return send(res, 400, { error: "Solo se permite assetType Model" });
        }

        let file;

        try {
            file = await validateFileUrl(fileUrl);
        } catch (error) {
            return send(res, 400, { error: error.message });
        }

        // No seguir redirecciones automáticamente: se evita descargar
        // contenido de un destino distinto del host validado.
        const downloaded = await fetch(file, {
            redirect: "manual",
            signal: AbortSignal.timeout(25000)
        });

        if (downloaded.status >= 300 && downloaded.status < 400) {
            return send(res, 400, {
                error: "El enlace redirige. Usa un enlace HTTPS directo al archivo."
            });
        }

        if (!downloaded.ok) {
            return send(res, 400, {
                error: `Descarga fallida: HTTP ${downloaded.status}`
            });
        }

        const length = Number(downloaded.headers.get("content-length") || 0);

        if (length > MAX_FILE_SIZE) {
            return send(res, 413, { error: "El archivo supera 20 MB" });
        }

        const buffer = Buffer.from(await downloaded.arrayBuffer());

        if (!buffer.length) {
            return send(res, 400, { error: "El archivo está vacío" });
        }

        if (buffer.length > MAX_FILE_SIZE) {
            return send(res, 413, { error: "El archivo supera 20 MB" });
        }

        let filename;

        try {
            filename = decodeURIComponent(file.pathname.split("/").pop() || "");
        } catch {
            filename = file.pathname.split("/").pop() || "";
        }

        try {
            validateModelBuffer(buffer, filename);
        } catch (error) {
            return send(res, 400, {
                error: error.message,
                filename,
                fileSize: buffer.length
            });
        }

        const metadata = {
            assetType: "Model",
            displayName: String(data.name || data.displayName || "myfile").slice(0, 50),
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
            new Blob([buffer], { type: "model/x-rbxm" }),
            filename
        );

        console.log("[UPLOAD] Enviando archivo:", filename, buffer.length);

        const upstream = await fetch(`${ROBLOX_ASSETS}/assets`, {
            method: "POST",
            headers: { "x-api-key": apiKey },
            body: form,
            signal: AbortSignal.timeout(55000)
        });

        const raw = await upstream.text();
        let result;

        try {
            result = JSON.parse(raw);
        } catch {
            result = { rawResponse: raw.slice(0, 2000) };
        }

        console.log("[UPLOAD] Roblox HTTP:", upstream.status);

        if (!upstream.ok) {
            console.error("[UPLOAD] Error Roblox:", upstream.status, JSON.stringify(result));

            return send(res, upstream.status, {
                success: false,
                error: result.message || result.error?.message ||
                    result.error || `Roblox respondió HTTP ${upstream.status}`,
                details: result
            });
        }

        const assetId = findAssetId(result);
        const operation = findOperation(result);

        console.log("[UPLOAD] Resultado:", JSON.stringify({
            assetId,
            operation,
            response: result
        }));

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

        if (operation) {
            return send(res, 200, {
                success: true,
                done: false,
                assetId: null,
                operation,
                response: result
            });
        }

        return send(res, 502, {
            success: false,
            error: "Roblox no devolvió assetId ni identificador de operación",
            details: result
        });
    } catch (error) {
        console.error("[UPLOAD] Error:", error);

        return send(res, error?.name === "TimeoutError" ? 504 : 500, {
            success: false,
            error: error?.name === "TimeoutError"
                ? "Se agotó el tiempo de espera de la subida"
                : "Error interno procesando la subida"
        });
    }
};
