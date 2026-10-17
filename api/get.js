
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

        const assetId = String(body.assetId || "").trim();

        if (!apiKey) {
            return send(res, 400, { error: "Falta apiKey" });
        }

        if (!/^\d+$/.test(assetId)) {
            return send(res, 400, { error: "assetId no es válido" });
        }

        const upstream = await fetch(
            `${ROBLOX_ASSETS}/assets/${encodeURIComponent(assetId)}`,
            {
                method: "GET",
                headers: {
                    "x-api-key": apiKey
                },
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

        return send(res, 200, {
            success: true,
            assetId,
            assetUrl: `https://www.roblox.com/library/${assetId}`,
            displayName: result.displayName || null,
            description: result.description || null,
            assetType: result.assetType || null,
            moderationState:
                result.moderationResult?.moderationState || null,
            response: result
        });
    } catch (error) {
        console.error("[GET ASSET]", error?.message || error);

        return send(
            res,
            error?.name === "TimeoutError" ? 504 : 502,
            {
                success: false,
                error: error?.name === "TimeoutError"
                    ? "Roblox tardó demasiado en responder"
                    : "No se pudo consultar el asset"
            }
        );
    }
};
