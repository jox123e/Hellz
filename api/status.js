
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
  if (!value || typeof value !== "object" || depth > 10) {
    return null;
  }

  if (
    value.assetId != null &&
    /^\d+$/.test(String(value.assetId))
  ) {
    return String(value.assetId);
  }

  if (typeof value.path === "string") {
    const match = value.path.match(/(?:^|\/)assets\/(\d+)\/?$/);
    if (match) return match[1];
  }

  for (const key of [
    "response",
    "asset",
    "result",
    "data",
    "operation"
  ]) {
    const found = findAssetId(value[key], depth + 1);
    if (found) return found;
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET") {
    return send(res, 200, {
      ok: true,
      route: "/api/status",
      method: "POST required",
      runtime: "nodejs"
    });
  }

  if (req.method !== "POST") {
    return send(res, 405, {
      error: "Usa POST"
    });
  }

  try {
    const body =
      req.body && typeof req.body === "object"
        ? req.body
        : {};

    const apiKey =
      typeof body.apiKey === "string"
        ? body.apiKey.trim()
        : "";

    let operation = String(body.operation || "").trim();

    if (!apiKey || !operation) {
      return send(res, 400, {
        error: "Falta apiKey u operation"
      });
    }

    operation = operation.replace(/^operations\//, "");

    if (!/^[A-Za-z0-9_-]+$/.test(operation)) {
      return send(res, 400, {
        error: "operation no es válido"
      });
    }

    const url =
      `${ROBLOX_ASSETS}/operations/${encodeURIComponent(operation)}`;

    console.log("[STATUS] Consultando operación:", operation);

    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey
      },
      signal: AbortSignal.timeout(20000)
    });

    const raw = await upstream.text();

    let result;

    try {
      result = JSON.parse(raw);
    } catch {
      console.error(
        "[STATUS] Roblox devolvió contenido no JSON:",
        raw.slice(0, 2000)
      );

      return send(res, 502, {
        error: "Roblox devolvió una respuesta que no es JSON",
        upstreamStatus: upstream.status,
        upstreamBody: raw.slice(0, 2000)
      });
    }

    console.log("[STATUS] HTTP Roblox:", upstream.status);

    if (!upstream.ok) {
      console.error(
        "[STATUS] Error de Roblox:",
        JSON.stringify(result)
      );

      return send(res, upstream.status, {
        error:
          result.message ||
          result.error?.message ||
          result.error ||
          `Roblox respondió HTTP ${upstream.status}`,
        upstreamStatus: upstream.status,
        upstreamResponse: result
      });
    }

    const done = result.done === true;
    const assetId = findAssetId(result);

    const operationError =
      result.error ||
      result.response?.error ||
      result.response?.errorMessage ||
      null;

    const moderationState =
      result.response?.moderationResult?.moderationState ||
      result.moderationResult?.moderationState ||
      null;

    console.log(
      "[STATUS DIAGNOSTIC]",
      JSON.stringify({
        operation: result.path || operation,
        done: result.done,
        hasResponse: result.response != null,
        assetId,
        moderationState,
        error: operationError,
        fullResponse: result
      })
    );

    if (done && operationError) {
      return send(res, 200, {
        done: true,
        assetId: null,
        error: operationError,
        moderationState,
        upstreamResponse: result
      });
    }

    if (done && !assetId) {
      console.error(
        "[STATUS] Operación terminada sin assetId:",
        JSON.stringify(result)
      );
    }

    return send(res, 200, {
      done,
      assetId,
      moderationState,
      error: operationError,
      response: result.response ?? null,
      upstreamResponse: result
    });
  } catch (error) {
    console.error("[STATUS] Error:", error);

    return send(res, 502, {
      error:
        error.name === "TimeoutError"
          ? "Roblox tardó demasiado en responder"
          : "No se pudo consultar la operación en Roblox"
    });
  }
};
