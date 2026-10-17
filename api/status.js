const ROBLOX_ASSETS = "https://apis.roblox.com/assets/v1";

function send(res, status, data) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

module.exports = async function handler(req, res) {
    if (req.method === "OPTIONS") return send(res, 200, { ok: true });

    if (req.method === "GET") {
        return send(res, 200, {
            ok: true,
            route: "/api/status",
            method: "POST required",
            runtime: "nodejs"
        });
    }

    if (req.method !== "POST") {
        return send(res, 405, { error: "Usa POST" });
    }

    try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
        let operation = String(body.operation || "").trim();

        if (!apiKey || !operation) {
            return send(res, 400, { error: "Falta apiKey u operation" });
        }

        operation = operation.replace(/^operations\//, "");

        if (!/^[A-Za-z0-9_-]+$/.test(operation)) {
            return send(res, 400, { error: "operation no es válido" });
        }

        const upstream = await fetch(
            `${ROBLOX_ASSETS}/operations/${encodeURIComponent(operation)}`,
            {
                method: "GET",
                headers: { "x-api-key": apiKey },
                signal: AbortSignal.timeout(20000)
            }
        );

        const raw = await upstream.text();
        let result;

        try {
            result = JSON.parse(raw);
        } catch {
            return send(res, 502, {
                error: "Roblox devolvió una respuesta no JSON",
                upstreamStatus: upstream.status,
                upstreamBody: raw.slice(0, 2000)
            });
        }

        if (!upstream.ok) {
            console.error("[STATUS] Roblox error:", upstream.status, JSON.stringify(result));

            return send(res, upstream.status, {
                error: result.message || result.error?.message ||
                    result.error || `Roblox respondió HTTP ${upstream.status}`,
                upstreamStatus: upstream.status,
                upstreamResponse: result
            });
        }

        const done = result.done === true;
        const assetId = done ? findAssetId(result) : null;

        const error = result.error ||
            result.response?.error ||
            result.response?.errorMessage ||
            null;

        const moderationState =
            result.response?.moderationResult?.moderationState ||
            result.moderationResult?.moderationState ||
            null;

        console.log("[STATUS DIAGNOSTIC]", JSON.stringify({
            operation,
            done: result.done,
            assetId,
            moderationState,
            error,
            upstreamResponse: result
        }));

        if (done && error) {
            return send(res, 200, {
                success: false,
                done: true,
                assetId: null,
                operation,
                error,
                upstreamResponse: result
            });
        }

        if (done && !assetId) {
            return send(res, 200, {
                success: false,
                done: true,
                assetId: null,
                operation,
                error: "La operación terminó, pero no se encontró assetId",
                response: result.response ?? null,
                upstreamResponse: result
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
            error,
            response: result.response ?? null,
            upstreamResponse: result
        });
    } catch (error) {
        console.error("[STATUS] Error:", error);

        return send(res, 502, {
            success: false,
            error: error?.name === "TimeoutError"
                ? "Roblox tardó demasiado en responder"
                : "No se pudo consultar la operación en Roblox"
        });
    }
};
