
const crypto = require("crypto");

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_HOSTS = (process.env.FILE_HOSTS || "")
    .split(",")
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN;

function getKey() {
    const key = process.env.ENCRYPTION_KEY || "";

    if (!/^[a-f0-9]{64}$/i.test(key)) {
        throw new Error("ENCRYPTION_KEY debe tener 64 caracteres hexadecimales");
    }

    return Buffer.from(key, "hex");
}

function encrypt(data) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

    return Buffer.concat([
        Buffer.from("PP01"),
        iv,
        cipher.getAuthTag(),
        encrypted
    ]);
}

function decrypt(data) {
    const buffer = Buffer.from(data);

    if (buffer.subarray(0, 4).toString() !== "PP01") {
        throw new Error("Formato cifrado inválido");
    }

    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        getKey(),
        buffer.subarray(4, 16)
    );

    decipher.setAuthTag(buffer.subarray(16, 32));

    return Buffer.concat([
        decipher.update(buffer.subarray(32)),
        decipher.final()
    ]);
}

async function githubRequest(path, method = "GET", body) {
    const response = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
        {
            method,
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json"
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(25000)
        }
    );

    const text = await response.text();
    let data = {};

    try {
        data = JSON.parse(text);
    } catch {}

    if (!response.ok) {
        const error = new Error(
            `GitHub HTTP ${response.status}: ${data.message || "Error"}`
        );
        error.status = response.status;
        throw error;
    }

    return data;
}

async function githubPut(path, bytes) {
    return githubRequest(path, "PUT", {
        message: "PlacePublisher: guardar tarea cifrada",
        branch: BRANCH,
        content: Buffer.from(bytes).toString("base64")
    });
}

async function githubGet(path) {
    const file = await githubRequest(
        `${path}?ref=${encodeURIComponent(BRANCH)}`
    );

    if (!file.content || file.encoding !== "base64" || !file.sha) {
        throw new Error(`Archivo de GitHub inválido: ${path}`);
    }

    return {
        bytes: Buffer.from(file.content.replace(/\n/g, ""), "base64"),
        sha: file.sha
    };
}

async function githubDelete(path, sha) {
    return githubRequest(path, "DELETE", {
        message: "PlacePublisher: limpiar trabajo temporal",
        sha,
        branch: BRANCH
    });
}

function validId(value) {
    return typeof value === "string" &&
        /^\d{1,30}$/.test(value);
}

function validJobId(value) {
    return typeof value === "string" &&
        /^[a-f0-9-]{36}$/i.test(value);
}

function validateFileUrl(value) {
    let url;

    try {
        url = new URL(value);
    } catch {
        throw new Error("URL de archivo inválida");
    }

    const extension = url.pathname.match(/\.rbxlx?$/i)?.[0];

    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !ALLOWED_HOSTS.includes(url.hostname.toLowerCase()) ||
        !extension
    ) {
        throw new Error("URL o dominio de archivo no permitido");
    }

    return {
        url,
        extension: extension.toLowerCase(),
        contentType: extension.toLowerCase() === ".rbxlx"
            ? "application/xml"
            : "application/octet-stream"
    };
}

async function downloadFile(url) {
    const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(20000)
    });

    if (!response.ok || !response.body) {
        throw new Error(`Descarga fallida: HTTP ${response.status}`);
    }

    const length = Number(response.headers.get("content-length"));

    if (Number.isFinite(length) && length > MAX_FILE_SIZE) {
        await response.body.cancel();
        throw new Error("Archivo supera 10 MiB");
    }

    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        size += value.byteLength;

        if (size > MAX_FILE_SIZE) {
            await reader.cancel();
            throw new Error("Archivo supera 10 MiB");
        }

        chunks.push(Buffer.from(value));
    }

    if (!size) throw new Error("Archivo vacío");

    return Buffer.concat(chunks);
}

async function cleanupJob(jobId, storedName, fileSha, metadataSha) {
    // Solo elimina los dos archivos de ESTE jobId.
    const base = `pending/${jobId}`;

    const files = [
        { path: `${base}/${storedName}.enc`, sha: fileSha },
        { path: `${base}/metadata.json.enc`, sha: metadataSha }
    ];

    const deleted = [];
    const errors = [];

    for (const file of files) {
        try {
            await githubDelete(file.path, file.sha);
            deleted.push(file.path);
        } catch (error) {
            errors.push({
                path: file.path,
                error: error.message
            });
        }
    }

    return {
        complete: errors.length === 0,
        deleted,
        errors
    };
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            error: "Método no permitido"
        });
    }

    if (!OWNER || !REPO || !TOKEN) {
        return res.status(500).json({
            success: false,
            error: "Falta configurar GitHub en Vercel"
        });
    }

    if (!ALLOWED_HOSTS.length) {
        return res.status(500).json({
            success: false,
            error: "FILE_HOSTS no está configurado"
        });
    }

    const body = req.body || {};

    try {
        if (body.action === "save") {
            const { fileUrl, placeId, universeId } = body;

            if (!validId(placeId) || !validId(universeId)) {
                return res.status(400).json({
                    success: false,
                    error: "PlaceId o UniverseId inválido"
                });
            }

            const fileInfo = validateFileUrl(fileUrl);
            const originalFile = await downloadFile(fileInfo.url.href);
            const jobId = crypto.randomUUID();

            const extension = fileInfo.extension.slice(1);
            const storedName = `place.${extension}`;

            const metadata = {
                jobId,
                placeId,
                universeId,
                contentType: fileInfo.contentType,
                fileName: storedName,
                createdAt: new Date().toISOString(),
                status: "pending"
            };

            const base = `pending/${jobId}`;
            const filePath = `${base}/${storedName}.enc`;
            const metadataPath = `${base}/metadata.json.enc`;

            // Cada trabajo crea exactamente dos archivos.
            const savedFile = await githubPut(
                filePath,
                encrypt(originalFile)
            );

            try {
                await githubPut(
                    metadataPath,
                    encrypt(Buffer.from(JSON.stringify(metadata)))
                );
            } catch (error) {
                // Si falla el segundo archivo, intenta revertir el primero.
                try {
                    await githubDelete(filePath, savedFile.content.sha);
                } catch (cleanupError) {
                    console.error(
                        "Falló la limpieza parcial:",
                        cleanupError.message
                    );
                }

                throw error;
            }

            return res.status(200).json({
                success: true,
                action: "save",
                jobId,
                status: "pending",
                placeId,
                universeId,
                filesCreated: 2,
                paths: [filePath, metadataPath]
            });
        }

        if (body.action === "publish") {
            const { jobId, apiKey } = body;

            if (!validJobId(jobId)) {
                return res.status(400).json({
                    success: false,
                    error: "jobId inválido"
                });
            }

            if (typeof apiKey !== "string" || !apiKey.trim()) {
                return res.status(400).json({
                    success: false,
                    error: "Falta la credencial de Roblox"
                });
            }

            const base = `pending/${jobId}`;

            const metadataFile = await githubGet(
                `${base}/metadata.json.enc`
            );

            const metadata = JSON.parse(
                decrypt(metadataFile.bytes).toString("utf8")
            );

            if (
                metadata.jobId !== jobId ||
                metadata.status !== "pending" ||
                !validId(metadata.placeId) ||
                !validId(metadata.universeId)
            ) {
                throw new Error("Metadatos inválidos para este jobId");
            }

            const storedName = metadata.fileName;

            if (!["place.rbxl", "place.rbxlx"].includes(storedName)) {
                throw new Error("Nombre de archivo inválido");
            }

            const encryptedFile = await githubGet(
                `${base}/${storedName}.enc`
            );

            const originalFile = decrypt(encryptedFile.bytes);

            if (
                originalFile.length === 0 ||
                originalFile.length > MAX_FILE_SIZE
            ) {
                throw new Error("Tamaño de archivo inválido");
            }

            const publishUrl =
                `https://apis.roblox.com/universes/v1/` +
                `${metadata.universeId}/places/${metadata.placeId}` +
                `/versions?versionType=Published`;

            const publication = await fetch(publishUrl, {
                method: "POST",
                headers: {
                    "x-api-key": apiKey,
                    "Content-Type": metadata.contentType,
                    Accept: "application/json"
                },
                body: originalFile,
                signal: AbortSignal.timeout(25000)
            });

            const text = await publication.text();
            let publishResult = {};

            try {
                publishResult = JSON.parse(text);
            } catch {}

            if (!publication.ok) {
                return res.status(502).json({
                    success: false,
                    error: publishResult.message ||
                        `Roblox respondió HTTP ${publication.status}`,
                    robloxStatus: publication.status,
                    jobId,
                    cleanupComplete: false
                });
            }

            // Solo se intenta limpiar después de confirmar éxito de Roblox.
            const cleanup = await cleanupJob(
                jobId,
                storedName,
                encryptedFile.sha,
                metadataFile.sha
            );

            return res.status(200).json({
                success: true,
                action: "publish",
                status: "published",
                placeId: metadata.placeId,
                universeId: metadata.universeId,
                versionType: "Published",
                versionNumber: publishResult.versionNumber ?? null,
                jobId,
                cleanupComplete: cleanup.complete,
                deletedFiles: cleanup.deleted,
                cleanupErrors: cleanup.errors
            });
        }

        return res.status(400).json({
            success: false,
            error: "action debe ser save o publish"
        });
    } catch (error) {
        console.error("PlacePublisher:", error.message);

        return res.status(500).json({
            success: false,
            error: error.message || "Error interno de PlacePublisher"
        });
    }
};
