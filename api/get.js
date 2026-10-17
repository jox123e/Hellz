const ROBLOX_ASSETS = "https://apis.roblox.com/assets/v1";

function send(res, status, data) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(status).json(data);
}

module.exports = async function handler(req, res) {
    if (req.method === "OPTIONS") return send(res, 200, { ok: true });

    if (req.method === "GET") {
        return send(res, 200, {
            ok: true,
            route: "/api/get",
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
        const assetId = String(data.assetId || "").trim();

        if (!apiKey || !/^\d+$/.test(assetId)) {
            return send(res, 400, {
                ok: false,
                error: "Falta apiKey o assetId inválido"
            });
        }

        const upstream = await fetch(
            `${ROBLOX_ASSETS}/assets/${encodeURIComponent(assetId)}?readMask=moderationResult`,
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
                ok: false,
                assetId,
                error: "Roblox devolvió una respuesta no JSON",
                upstreamStatus: upstream.status,
                upstreamBody: raw.slice(0, 2000)
            });
        }

        if (!upstream.ok) {
            console.error("[GET] Roblox error:", upstream.status, JSON.stringify(result));

            return send(res, upstream.status, {
                ok: false,
                assetId,
                error: result.message || result.error?.message ||
                    result.error || `Roblox respondió HTTP ${upstream.status}`,
                upstreamStatus: upstream.status,
                upstreamResponse: result
            });
        }

        const moderation = result.moderationResult || {};
        const moderationState =
            moderation.moderationState ||
            result.moderationState ||
            "Unknown";

        console.log("[GET] Asset consultado:", assetId, moderationState);

        return send(res, 200, {
            ok: true,
            assetId,
            assetUrl: `https://www.roblox.com/library/${assetId}`,
            moderationState,
            moderationResult: moderation,
            asset: result
        });
    } catch (error) {
        console.error("[GET] Error:", error);

        return send(res, 502, {
            ok: false,
            error: error?.name === "TimeoutError"
                ? "Roblox tardó demasiado en responder"
                : "No se pudo consultar el asset en Roblox"
        });
    }
};
