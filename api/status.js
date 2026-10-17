
const ROBLOX_ASSETS = "https://apis.roblox.com/assets/v1";

function send(res, status, data) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(status).json(data);
}

function getAssetId(result) {
    const asset = result?.response;

    if (asset?.assetId != null && /^\d+$/.test(String(asset.assetId))) {
        return String(asset.assetId);
    }

    const match = typeof asset?.path === "string"
        ? asset.path.match(/^assets\/(\d+)$/)
        : null;

    return match ? match[1] : null;
}

module.exports = async function handler(req, res) {
    if (req.method === "OPTIONS") {
        return send(res, 200, { ok: true });
    }

    if (req.method !== "POST") {
        return send(res, 405, { error: "Usa POST" });
    }

    try {
        const body = req.body && typeof req.body === "object"
            ? req.body
            : {};

        const apiKey = typeof body.apiKey === "string"
            ? body.apiKey.trim()
            : "";

        const operation = String(body.operation || "")
            .trim()
            .replace(/^operations\//, "");

        if (!apiKey || !operation) {
            return send(res, 400, {
                error: "Falta apiKey u operation"
            });
        }

        if (!/^[A-Za-z0-9_-]+$/.test(operation)) {
            return send(res, 400, {
                error: "operation no es válida"
            });
        }

        const upstream = await fetch(
            `${ROBLOX_ASSETS}/operations/${encodeURIComponent(operation)}`,
            {
                method: "GET",
                headers: { "x-api-key": apiKey },
                signal: AbortSignal.timeout(15000)
            }
        );

        const raw = await upstream.text();
        let result;

        try {
            result = JSON.parse(raw);
        } catch {
            return send(res, 502, {
                success: false,
                error: "Roblox devolvió una respuesta no JSON",
                upstreamStatus: upstream.status,
                upstreamBody: raw.slice(0, 1000)
            });
        }

        if (!upstream.ok) {
            return send(res, upstream.status, {
                success: false,
                error: result.message ||
                    result.error?.message ||
                    result.error ||
                    `Roblox respondió HTTP ${upstream.status}`,
                upstreamStatus: upstream.status,
                upstreamResponse: result
            });
        }

        const done = result.done === true;
        const assetId = done ? getAssetId(result) : null;
        const operationError = result.error || null;
        const moderationState =
            result.response?.moderationResult?.moderationState || null;

        if (done && operationError) {
            return send(res, 200, {
                success: false,
                done: true,
                operation,
                assetId,
                error: typeof operationError === "string"
                    ? operationError
                    : JSON.stringify(operationError),
                response: result
            });
        }

        if (done && !assetId) {
            return send(res, 200, {
                success: false,
                done: true,
                operation,
                assetId: null,
                error: "La operación terminó sin devolver un assetId",
                response: result
            });
        }

        return send(res, 200, {
            success: done && !!assetId,
            done,
            operation,
            assetId,
            assetUrl: assetId
                ? `https://www.roblox.com/library/${assetId}`
                : null,
            moderationState,
            error: null,
            response: result
        });
    } catch (error) {
        console.error("[STATUS]", error?.message || error);

        return send(
            res,
            error?.name === "TimeoutError" ? 504 : 502,
            {
                success: false,
                error: error?.name === "TimeoutError"
                    ? "Roblox tardó demasiado en responder"
                    : "No se pudo consultar la operación"
            }
        );
    }
};
