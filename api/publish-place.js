
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function sendJson(res, status, body) {
  return res.status(status).json(body);
}

function validId(value) {
  return typeof value === "string" && /^\d+$/.test(value);
}

function getFileInfo(fileUrl) {
  let parsed;

  try {
    parsed = new URL(fileUrl);
  } catch {
    throw new Error("La URL del archivo no es válida.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("El enlace debe utilizar HTTPS.");
  }

  if (parsed.hostname !== "raw.githubusercontent.com") {
    throw new Error("Solo se permiten enlaces raw.githubusercontent.com.");
  }

  const pathname = parsed.pathname.toLowerCase();

  if (pathname.endsWith(".rbxlx")) {
    return {
      contentType: "application/xml",
      extension: ".rbxlx"
    };
  }

  if (pathname.endsWith(".rbxl")) {
    return {
      contentType: "application/octet-stream",
      extension: ".rbxl"
    };
  }

  throw new Error("El archivo debe terminar en .rbxl o .rbxlx.");
}

async function downloadPlace(fileUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(fileUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`No se pudo descargar el archivo: HTTP ${response.status}`);
    }

    const declaredSize = Number(response.headers.get("content-length") || 0);

    if (declaredSize > MAX_FILE_SIZE) {
      throw new Error("El archivo supera el límite de 10 MiB.");
    }

    if (!response.body) {
      throw new Error("La descarga no contiene datos.");
    }

    const reader = response.body.getReader();
    const chunks = [];
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalSize += value.byteLength;

      if (totalSize > MAX_FILE_SIZE) {
        await reader.cancel();
        throw new Error("El archivo supera el límite de 10 MiB.");
      }

      chunks.push(Buffer.from(value));
    }

    if (totalSize === 0) {
      throw new Error("El archivo descargado está vacío.");
    }

    return Buffer.concat(chunks, totalSize);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, {
      success: false,
      error: "Método no permitido."
    });
  }

  try {
    const body = req.body || {};

    const apiKey = typeof body.apiKey === "string"
      ? body.apiKey.trim()
      : "";

    const { placeId, universeId, fileUrl } = body;
    const versionType = body.versionType || "Published";

    if (!apiKey) {
      return sendJson(res, 400, {
        success: false,
        error: "Falta el Roblox Open Cloud API key."
      });
    }

    if (!validId(placeId) || !validId(universeId)) {
      return sendJson(res, 400, {
        success: false,
        error: "Place ID o Universe ID inválido."
      });
    }

    if (versionType !== "Published" && versionType !== "Saved") {
      return sendJson(res, 400, {
        success: false,
        error: "versionType debe ser Published o Saved."
      });
    }

    const fileInfo = getFileInfo(fileUrl);
    const fileBuffer = await downloadPlace(fileUrl);

    const robloxUrl =
      `https://apis.roblox.com/universes/v1/${universeId}` +
      `/places/${placeId}/versions?versionType=${versionType}`;

    const robloxResponse = await fetch(robloxUrl, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": fileInfo.contentType
      },
      body: fileBuffer
    });

    const responseText = await robloxResponse.text();

    let robloxData = {};

    try {
      robloxData = responseText ? JSON.parse(responseText) : {};
    } catch {
      robloxData = {};
    }

    if (!robloxResponse.ok) {
      const messages = {
        400: "Roblox rechazó el archivo. Comprueba el formato y su contenido.",
        401: "API key inválida o sin autorización para esta operación.",
        403: "Roblox no permite publicar en este Place.",
        404: "No se encontró el Place o la experiencia.",
        409: "El Place no pertenece al Universe indicado."
      };

      return sendJson(res, robloxResponse.status, {
        success: false,
        error: messages[robloxResponse.status] ||
          `Roblox Open Cloud respondió HTTP ${robloxResponse.status}.`,
        details: robloxData
      });
    }

    return sendJson(res, 200, {
      success: true,
      message: versionType === "Published"
        ? "Roblox confirmó la publicación."
        : "Roblox confirmó que el archivo se guardó.",
      placeId,
      universeId,
      versionType,
      versionNumber: robloxData.versionNumber ?? null
    });
  } catch (error) {
    const isAbort = error && error.name === "AbortError";

    return sendJson(res, 400, {
      success: false,
      error: isAbort
        ? "La descarga tardó demasiado."
        : error.message || "Error interno al procesar el archivo."
    });
  }
};
