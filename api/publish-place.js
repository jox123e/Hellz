
const ALLOWED_HOSTS = (process.env.FILE_HOSTS || "")
    .split(",")
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);

const MAX_FILE_SIZE = 10 * 1024 * 1024;

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            error: "Método no permitido"
        });
    }

    const {
        mode,
        placeId,
        universeId,
        fileUrl,
        action,
        versionType,
        contentType,
        options = {}
    } = req.body || {};

    if (mode !== "universePlace") {
        return res.status(400).json({
            success: false,
            error: "Modo inválido"
        });
    }

    if (
        typeof placeId !== "string" ||
        !/^\d+$/.test(placeId) ||
        typeof universeId !== "string" ||
        !/^\d+$/.test(universeId)
    ) {
        return res.status(400).json({
            success: false,
            error: "PlaceId o UniverseId inválido"
        });
    }

    if (action !== "upload" || versionType !== "Published") {
        return res.status(400).json({
            success: false,
            error: "Solo se permite publicar con versionType Published"
        });
    }

    if (typeof fileUrl !== "string" || fileUrl.length > 2048) {
        return res.status(400).json({
            success: false,
            error: "URL inválida"
        });
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(fileUrl);
    } catch {
        return res.status(400).json({
            success: false,
            error: "La URL no es válida"
        });
    }

    const extension = parsedUrl.pathname.match(/\.rbxlx?$/i)?.[0]
        ?.toLowerCase();

    if (
        parsedUrl.protocol !== "https:" ||
        parsedUrl.username ||
        parsedUrl.password ||
        !ALLOWED_HOSTS.includes(parsedUrl.hostname.toLowerCase()) ||
        !extension
    ) {
        return res.status(400).json({
            success: false,
            error: "Dominio o extensión de archivo no permitidos"
        });
    }

    const expectedType = extension === ".rbxlx"
        ? "application/xml"
        : "application/octet-stream";

    if (
        options.validateFileType !== false &&
        contentType !== expectedType
    ) {
        return res.status(400).json({
            success: false,
            error: "El tipo de archivo no coincide"
        });
    }

    const requestedLimit = Number(options.maxFileSize);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, MAX_FILE_SIZE)
        : MAX_FILE_SIZE;

    try {
        const download = await fetch(parsedUrl.href, {
            redirect: "error",
            signal: AbortSignal.timeout(20000)
        });

        if (!download.ok || !download.body) {
            return res.status(502).json({
                success: false,
                error: `Error al descargar: HTTP ${download.status}`
            });
        }

        const declaredLength = Number(
            download.headers.get("content-length")
        );

        if (
            Number.isFinite(declaredLength) &&
            declaredLength > limit
        ) {
            await download.body.cancel();

            return res.status(413).json({
                success: false,
                error: "El archivo supera el límite permitido"
            });
        }

        const reader = download.body.getReader();
        const chunks = [];
        let total = 0;

        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            total += value.byteLength;

            if (total > limit) {
                await reader.cancel();

                return res.status(413).json({
                    success: false,
                    error: "El archivo supera el límite permitido"
                });
            }

            chunks.push(value);
        }

        if (total === 0) {
            return res.status(400).json({
                success: false,
                error: "El archivo está vacío"
            });
        }

        const file = new Uint8Array(total);
        let offset = 0;

        for (const chunk of chunks) {
            file.set(chunk, offset);
            offset += chunk.byteLength;
        }

        // La publicación requiere autenticación de Roblox Open Cloud.
        // Este endpoint no tiene credenciales configuradas.
        return res.status(501).json({
            success: false,
            error: "Falta configurar la autenticación de Roblox Open Cloud"
        });
    } catch (error) {
        console.error("PublishPlace:", error.name);

        return res.status(500).json({
            success: false,
            error: error.name === "TimeoutError"
                ? "Tiempo de espera agotado"
                : "Error procesando el archivo"
        });
    }
};
