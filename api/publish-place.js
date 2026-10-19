
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

    const secret = process.env.PUBLISH_SHARED_SECRET;

    if (!secret || req.headers["x-publish-secret"] !== secret) {
        return res.status(401).json({
            success: false,
            error: "No autorizado"
        });
    }

    const {
        placeId,
        universeId,
        fileUrl,
        action,
        versionType,
        contentType
    } = req.body || {};

    if (
        typeof placeId !== "string" ||
        !/^\d+$/.test(placeId) ||
        typeof universeId !== "string" ||
        !/^\d+$/.test(universeId)
    ) {
        return res.status(400).json({
            success: false,
            error: "placeId o universeId inválido"
        });
    }

    if (action !== "upload" || versionType !== "Published") {
        return res.status(400).json({
            success: false,
            error: "Solo se permite publicar"
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
            error: "URL mal formada"
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
            error: "URL o dominio no permitido"
        });
    }

    const expectedType = extension === ".rbxlx"
        ? "application/xml"
        : "application/octet-stream";

    if (contentType && contentType !== expectedType) {
        return res.status(400).json({
            success: false,
            error: "Tipo de archivo incorrecto"
        });
    }

    try {
        const download = await fetch(parsedUrl.href, {
            redirect: "error",
            signal: AbortSignal.timeout(20000)
        });

        if (!download.ok || !download.body) {
            return res.status(502).json({
                success: false,
                error: `Error descargando archivo: HTTP ${download.status}`
            });
        }

        const declaredLength = Number(
            download.headers.get("content-length")
        );

        if (
            Number.isFinite(declaredLength) &&
            declaredLength > MAX_FILE_SIZE
        ) {
            await download.body.cancel();

            return res.status(413).json({
                success: false,
                error: "Archivo demasiado grande"
            });
        }

        const reader = download.body.getReader();
        const chunks = [];
        let total = 0;

        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            total += value.byteLength;

            if (total > MAX_FILE_SIZE) {
                await reader.cancel();

                return res.status(413).json({
                    success: false,
                    error: "Archivo supera 10 MiB"
                });
            }

            chunks.push(value);
        }

        if (total === 0) {
            return res.status(400).json({
                success: false,
                error: "Archivo vacío"
            });
        }

        const file = new Uint8Array(total);
        let offset = 0;

        for (const chunk of chunks) {
            file.set(chunk, offset);
            offset += chunk.byteLength;
        }

        // Este endpoint no puede publicar sin autenticación de Roblox.
        // La publicación debe realizarse mediante un servicio autorizado.
        return res.status(501).json({
            success: false,
            error: "Falta configurar la autenticación de Roblox Open Cloud"
        });
    } catch (error) {
        console.error("Publication error:", error.name);

        return res.status(500).json({
            success: false,
            error: error.name === "TimeoutError"
                ? "Tiempo de espera agotado"
                : "Error procesando el archivo"
        });
    }
};
