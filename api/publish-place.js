
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            error: "Usa POST"
        });
    }

    try {
        const {
            mode,
            placeId,
            universeId,
            fileUrl,
            action = "upload",
            versionType = "Saved",
            contentType,
            options = {}
        } = req.body || {};

        const apiKey = process.env.ROBLOX_OPEN_CLOUD_API_KEY;
        const secret = process.env.PUBLISH_SHARED_SECRET;

        if (!apiKey || !secret) {
            return res.status(500).json({
                success: false,
                error: "Configura las variables de entorno"
            });
        }

        if (req.headers["x-publish-secret"] !== secret) {
            return res.status(401).json({
                success: false,
                error: "Acceso denegado"
            });
        }

        if (!/^\d+$/.test(String(placeId || ""))) {
            return res.status(400).json({
                success: false,
                error: "placeId inválido"
            });
        }

        let finalUniverseId = universeId;

        if (mode === "place") {
            const map = JSON.parse(
                process.env.PLACE_UNIVERSE_MAP || "{}"
            );
            finalUniverseId = map[String(placeId)];
        } else if (mode !== "universePlace") {
            return res.status(400).json({
                success: false,
                error: "mode inválido"
            });
        }

        if (!/^\d+$/.test(String(finalUniverseId || ""))) {
            return res.status(400).json({
                success: false,
                error: "universeId inválido"
            });
        }

        if (action !== "upload") {
            return res.status(400).json({
                success: false,
                error: "Esta versión solo admite action=upload"
            });
        }

        if (!["Saved", "Published"].includes(versionType)) {
            return res.status(400).json({
                success: false,
                error: "versionType inválido"
            });
        }

        if (typeof fileUrl !== "string") {
            return res.status(400).json({
                success: false,
                error: "Falta fileUrl"
            });
        }

        const parsedUrl = new URL(fileUrl);

        if (parsedUrl.protocol !== "https:") {
            return res.status(400).json({
                success: false,
                error: "Se requiere HTTPS"
            });
        }

        const allowedHosts = (
            process.env.FILE_HOSTS || ""
        )
            .split(",")
            .map(x => x.trim().toLowerCase())
            .filter(Boolean);

        if (!allowedHosts.includes(parsedUrl.hostname.toLowerCase())) {
            return res.status(403).json({
                success: false,
                error: "Dominio de archivo no autorizado"
            });
        }

        const path = parsedUrl.pathname.toLowerCase();
        let expectedType;

        if (path.endsWith(".rbxlx")) {
            expectedType = "application/xml";
        } else if (path.endsWith(".rbxl")) {
            expectedType = "application/octet-stream";
        } else {
            return res.status(400).json({
                success: false,
                error: "La URL debe terminar en .rbxl o .rbxlx"
            });
        }

        if (options.validateFileType !== false &&
            contentType !== expectedType) {
            return res.status(400).json({
                success: false,
                error: "contentType no coincide con la extensión"
            });
        }

        const download = await fetch(parsedUrl, {
            redirect: "error",
            signal: AbortSignal.timeout(20000)
        });

        if (!download.ok) {
            return res.status(502).json({
                success: false,
                error: `Error descargando archivo: ${download.status}`
            });
        }

        const maxSize = Math.min(
            Number(options.maxFileSize) || 10485760,
            10485760
        );

        const file = Buffer.from(await download.arrayBuffer());

        if (file.length === 0 || file.length > maxSize) {
            return res.status(413).json({
                success: false,
                error: "Archivo vacío o demasiado grande"
            });
        }

        const endpoint =
            `https://apis.roblox.com/universes/v1/` +
            `${finalUniverseId}/places/${placeId}/versions` +
            `?versionType=${versionType}`;

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "x-api-key": apiKey,
                "Content-Type": expectedType
            },
            body: file,
            signal: AbortSignal.timeout(25000)
        });

        const raw = await response.text();
        let data;

        try {
            data = JSON.parse(raw);
        } catch {
            data = { message: raw };
        }

        if (!response.ok) {
            return res.status(502).json({
                success: false,
                error: "Roblox rechazó la publicación",
                robloxStatus: response.status,
                details: data
            });
        }

        return res.status(200).json({
            success: true,
            action,
            placeId: String(placeId),
            universeId: String(finalUniverseId),
            versionType,
            versionNumber: data.versionNumber ?? null
        });
    } catch (error) {
        console.error("PublishPlace:", error);

        return res.status(500).json({
            success: false,
            error: "Error interno del servidor"
        });
    }
}
