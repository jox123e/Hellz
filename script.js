"use strict";

const ENDPOINTS = {
  upload: "/api/upload",
  status: "/api/status",
  get: "/api/get",
  publishPlace: "/api/publish-place"
};

const $ = id => document.getElementById(id);

const assetForm = $("assetForm");
const placeForm = $("placeForm");
const apiKeyInput = $("apiKey");
const assetPanel = $("assetPanel");
const placePanel = $("placePanel");
const copyBtn = $("copyBtn");

let currentMode = "asset";
let lastOutput = null;
let requestRunning = false;

function showResult(title, message, data = null, isError = false) {
  $("resultTitle").textContent = title;
  $("resultMessage").textContent = message;
  $("resultMessage").style.color = isError ? "#ff727f" : "";

  lastOutput = data;
  $("resultData").textContent = data == null
    ? ""
    : typeof data === "string"
      ? data
      : JSON.stringify(data, null, 2);

  copyBtn.disabled = data == null;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label || "Procesando...";
  } else {
    button.textContent =
      button.dataset.originalText || button.textContent;
  }
}

function readApiKey() {
  const key = apiKeyInput.value.trim();

  if (!key) {
    throw new Error("Introduce tu Roblox API key.");
  }

  return key;
}

async function requestJSON(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text || "El servidor no devolvió JSON." };
  }

  if (!response.ok) {
    const message =
      data.error ||
      data.message ||
      data.details ||
      `Error HTTP ${response.status}`;

    throw new Error(message);
  }

  if (data && data.success === false) {
    throw new Error(data.error || data.message || "La operación falló.");
  }

  return data;
}

function extractJobId(data) {
  return (
    data?.jobId ??
    data?.job_id ??
    data?.operationId ??
    data?.operation_id ??
    data?.job?.id ??
    null
  );
}

function extractAssetIds(value, found = new Set()) {
  if (!value || typeof value !== "object") {
    return [...found];
  }

  for (const [key, item] of Object.entries(value)) {
    if (
      /^(assetid|asset_id|assetids|asset_ids)$/i.test(key) &&
      (typeof item === "string" || typeof item === "number")
    ) {
      if (Array.isArray(item)) {
        item.forEach(id => found.add(String(id)));
      } else {
        found.add(String(item));
      }
    } else if (item && typeof item === "object") {
      extractAssetIds(item, found);
    }
  }

  return [...found];
}

function isFinished(data) {
  const state = String(
    data?.status ??
    data?.state ??
    data?.operationStatus ??
    data?.operation_status ??
    ""
  ).toLowerCase();

  return data?.done === true ||
    data?.completed === true ||
    data?.success === true ||
    [
      "complete",
      "completed",
      "success",
      "succeeded",
      "done",
      "finished"
    ].includes(state);
}

function isFailed(data) {
  const state = String(
    data?.status ??
    data?.state ??
    data?.operationStatus ??
    data?.operation_status ??
    ""
  ).toLowerCase();

  return data?.success === false ||
    [
      "failed",
      "error",
      "cancelled",
      "canceled"
    ].includes(state);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkStatus(jobId, apiKey) {
  const status = await requestJSON(ENDPOINTS.status, {
    jobId,
    apiKey
  });

  showResult(
    "Estado de la subida",
    `Consulta del trabajo ${jobId}`,
    {
      jobId,
      status
    }
  );

  return status;
}

async function getFinalResult(jobId, apiKey) {
  return requestJSON(ENDPOINTS.get, {
    jobId,
    apiKey
  });
}

async function uploadAsset() {
  const apiKey = readApiKey();

  const ownerId = $("ownerId").value.trim();
  const fileUrl = $("assetUrl").value.trim();

  if (!/^\d+$/.test(ownerId)) {
    throw new Error("El ID del propietario debe ser numérico.");
  }

  if (!/^https?:\/\//i.test(fileUrl)) {
    throw new Error("Introduce una URL válida del modelo.");
  }

  const payload = {
    apiKey,
    ownerType: $("ownerType").value,
    ownerId,
    fileUrl,
    name: $("assetName").value.trim() || "myfile",
    description: $("assetDescription").value.trim(),
    assetType: "Model"
  };

  showResult(
    "Iniciando subida",
    "Enviando el modelo al backend...",
    { ownerType: payload.ownerType, ownerId, assetType: "Model" }
  );

  const uploadResponse = await requestJSON(
    ENDPOINTS.upload,
    payload
  );

  const jobId = extractJobId(uploadResponse);
  const initialIds = extractAssetIds(uploadResponse);

  if (!jobId) {
    showResult(
      "Respuesta de subida",
      initialIds.length
        ? `Asset IDs encontrados: ${initialIds.join(", ")}`
        : "El backend respondió sin un jobId reconocible.",
      {
        assetIds: initialIds,
        upload: uploadResponse
      }
    );
    return;
  }

  showResult(
    "Subida iniciada",
    `Job ID: ${jobId}`,
    {
      jobId,
      assetIds: initialIds,
      upload: uploadResponse
    }
  );

  let finished = false;

  for (let attempt = 1; attempt <= 30; attempt++) {
    await delay(2000);

    const status = await checkStatus(jobId, apiKey);

    if (isFailed(status)) {
      throw new Error(
        status.error ||
        status.message ||
        "Roblox o el backend informaron un error en la subida."
      );
    }

    if (isFinished(status)) {
      finished = true;
      break;
    }
  }

  if (!finished) {
    showResult(
      "Subida todavía pendiente",
      "Guarda el Job ID y consulta el estado nuevamente.",
      {
        jobId,
        assetIds: initialIds,
        statusEndpoint: ENDPOINTS.status
      }
    );
    return;
  }

  const finalResult = await getFinalResult(jobId, apiKey);
  const finalIds = [
    ...new Set([
      ...initialIds,
      ...extractAssetIds(status),
      ...extractAssetIds(finalResult)
    ])
  ];

  showResult(
    "Resultado de la subida",
    finalIds.length
      ? `Asset IDs: ${finalIds.join(", ")}`
      : "Operación completada. El backend no devolvió campos Asset ID reconocibles.",
    {
      jobId,
      assetIds: finalIds,
      result: finalResult
    }
  );
}

async function publishPlace() {
  const apiKey = readApiKey();
  const universeId = $("universeId").value.trim();
  const placeId = $("placeId").value.trim();
  const fileUrl = $("placeUrl").value.trim();

  if (!/^\d+$/.test(universeId) || !/^\d+$/.test(placeId)) {
    throw new Error("Universe ID y Place ID deben ser numéricos.");
  }

  if (!/^https?:\/\//i.test(fileUrl)) {
    throw new Error("Introduce una URL directa del archivo.");
  }

  if (!$("confirmPublish").checked) {
    throw new Error("Confirma la publicación antes de continuar.");
  }

  const extension = new URL(fileUrl).pathname.toLowerCase();

  if (!extension.endsWith(".rbxl") && !extension.endsWith(".rbxlx")) {
    throw new Error("El archivo debe terminar en .rbxl o .rbxlx.");
  }

  const payload = {
    apiKey,
    universeId,
    placeId,
    fileUrl,
    versionType: $("versionType").value
  };

  showResult(
    "Publicando lugar",
    "El backend está descargando y enviando el archivo a Roblox...",
    {
      universeId,
      placeId,
      fileUrl,
      versionType: payload.versionType
    }
  );

  const response = await requestJSON(
    ENDPOINTS.publishPlace,
    payload
  );

  showResult(
    "Respuesta de publicación",
    "El backend aceptó la solicitud. Revisa los datos devueltos para confirmar el resultado.",
    response
  );
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    if (requestRunning) return;

    currentMode = tab.dataset.mode;

    document.querySelectorAll(".tab").forEach(button => {
      const active = button === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    assetPanel.classList.toggle("hidden", currentMode !== "asset");
    placePanel.classList.toggle("hidden", currentMode !== "place");

    showResult(
      currentMode === "asset" ? "Asset Uploader" : "Place Publisher",
      currentMode === "asset"
        ? "Listo para subir un modelo."
        : "Listo para publicar un archivo de lugar.",
      null
    );
  });
});

assetForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (requestRunning) return;
  requestRunning = true;
  setBusy($("assetSubmit"), true, "Subiendo...");

  try {
    await uploadAsset();
  } catch (error) {
    showResult("Error al subir el asset", error.message, {
      error: error.message
    }, true);
  } finally {
    requestRunning = false;
    setBusy($("assetSubmit"), false);
    apiKeyInput.value = "";
  }
});

placeForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (requestRunning) return;
  requestRunning = true;
  setBusy($("placeSubmit"), true, "Publicando...");

  try {
    await publishPlace();
  } catch (error) {
    showResult("Error al publicar", error.message, {
      error: error.message
    }, true);
  } finally {
    requestRunning = false;
    setBusy($("placeSubmit"), false);
    apiKeyInput.value = "";
  }
});

copyBtn.addEventListener("click", async () => {
  if (lastOutput == null) return;

  const text = JSON.stringify(lastOutput, null, 2);

  try {
    await navigator.clipboard.writeText(text);
    $("resultMessage").textContent = "Resultado copiado.";
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();

    const copied = document.execCommand("copy");
    area.remove();

    $("resultMessage").textContent = copied
      ? "Resultado copiado."
      : "No se pudo copiar automáticamente.";
  }
});

showResult(
  "Resultado",
  "Selecciona Asset Uploader o Place Publisher para comenzar.",
  null
);
