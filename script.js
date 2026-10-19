
const form = document.querySelector("#publishForm");
const resultBox = document.querySelector("#result");
const submitBtn = document.querySelector("#submitBtn");

function showMessage(title, message, type = "") {
  resultBox.replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = title;

  const paragraph = document.createElement("p");
  paragraph.className = type;
  paragraph.textContent = message;

  resultBox.append(heading, paragraph);
}

function addValue(label, value) {
  const row = document.createElement("div");
  row.className = "kv";

  const heading = document.createElement("b");
  heading.textContent = label;

  const content = document.createElement("div");
  content.textContent = value == null ? "—" : String(value);

  row.append(heading, content);
  resultBox.appendChild(row);
}

async function publishPlace(payload) {
  const response = await fetch("/api/publish-place", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Respuesta HTTP ${response.status} no válida: ${text.slice(0, 200)}`
    );
  }

  if (!response.ok || data.success !== true) {
    throw new Error(
      data.error || data.message || `Error HTTP ${response.status}`
    );
  }

  return data;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const fd = new FormData(form);

  if (!fd.get("confirmPublish")) {
    showMessage(
      "Confirmación necesaria",
      "Marca la casilla para confirmar la operación.",
      "bad"
    );
    return;
  }

  const payload = {
    apiKey: String(fd.get("apiKey") || "").trim(),
    universeId: String(fd.get("universeId") || "").trim(),
    placeId: String(fd.get("placeId") || "").trim(),
    fileUrl: String(fd.get("fileUrl") || "").trim(),
    versionType: String(fd.get("versionType") || "Published")
  };

  if (!/^\d+$/.test(payload.universeId) ||
      !/^\d+$/.test(payload.placeId)) {
    showMessage("Datos inválidos", "Revisa el Universe ID y el Place ID.", "bad");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Publicando…";

  showMessage(
    "Procesando",
    "Descargando el archivo y enviándolo a Roblox Open Cloud…"
  );

  try {
    const data = await publishPlace(payload);

    showMessage(
      payload.versionType === "Published"
        ? "Publicación completada"
        : "Archivo guardado",
      payload.versionType === "Published"
        ? "Roblox confirmó la actualización del Place."
        : "Roblox confirmó que el archivo se guardó sin publicarse.",
      "ok"
    );

    addValue("Place ID", payload.placeId);
    addValue("Universe ID", payload.universeId);
    addValue("Versión", data.versionNumber ?? "No proporcionada");
    addValue("Tipo", payload.versionType);
  } catch (error) {
    showMessage(
      "No se pudo completar",
      error.message || String(error),
      "bad"
    );
  } finally {
    form.elements.apiKey.value = "";
    submitBtn.disabled = false;
    submitBtn.textContent = "Publicar Place";
  }
});
