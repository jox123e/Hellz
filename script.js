
const form = document.getElementById("uploadForm");
const creatorType = document.getElementById("creatorType");
const creatorIdLabel = document.getElementById("creatorIdLabel");
const creatorIdInput = document.getElementById("creatorId");
const publishButton = document.getElementById("publishButton");
const buttonText = document.getElementById("buttonText");
const message = document.getElementById("message");
const result = document.getElementById("result");
const checkButton = document.getElementById("checkButton");

let currentOperationId = null;

creatorType.addEventListener("change", () => {
  const isGroup = creatorType.value === "group";
  creatorIdLabel.textContent = isGroup ? "Group ID" : "User ID";
  creatorIdInput.placeholder = isGroup ? "987654321" : "123456789";
});

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = "message" + (type ? " " + type : "");
}

function setBusy(busy) {
  publishButton.disabled = busy;
  buttonText.textContent = busy ? "Procesando..." : "Publicar modelo";
}

function displayResult(data) {
  result.classList.remove("hidden");

  document.getElementById("assetId").textContent =
    data.assetId || "Todavía no disponible";

  document.getElementById("operationId").textContent =
    data.operationId || currentOperationId || "No disponible";

  document.getElementById("operationStatus").textContent =
    data.done === true ? "Finalizada" :
    data.done === false ? "En proceso" :
    data.status || "No disponible";

  document.getElementById("moderationStatus").textContent =
    data.moderationState || "Aún no informado";
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message ||
      `Error HTTP ${response.status}`);
  }

  return data;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true);
  result.classList.add("hidden");
  currentOperationId = null;
  showMessage("Validando los datos y enviando la solicitud...");

  const payload = {
    url: document.getElementById("modelUrl").value.trim(),
    creatorType: creatorType.value,
    creatorId: creatorIdInput.value.trim(),
    name: document.getElementById("modelName").value.trim(),
    description: document.getElementById("description").value.trim()
  };

  try {
    const data = await apiRequest("/v1/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    currentOperationId = data.operationId || null;
    displayResult(data);

    if (currentOperationId) {
      showMessage(
        "Solicitud recibida por Roblox. Consulta el estado para conocer el resultado.",
        "success"
      );
    } else {
      showMessage(
        "La respuesta no incluyó un identificador de operación. Revisa el resultado.",
        "error"
      );
    }
  } catch (error) {
    showMessage(error.message || "No se pudo publicar el modelo.", "error");
  } finally {
    setBusy(false);
  }
});

checkButton.addEventListener("click", async () => {
  if (!currentOperationId) {
    showMessage("Primero publica un modelo para obtener su operación.", "error");
    return;
  }

  checkButton.disabled = true;
  checkButton.textContent = "Consultando...";

  try {
    const data = await apiRequest(
      "/v1/operations/" + encodeURIComponent(currentOperationId)
    );

    displayResult(data);

    if (data.done === true) {
      showMessage("Roblox ha terminado de procesar la operación.", "success");
    } else {
      showMessage("La operación sigue pendiente. Puedes consultar otra vez.");
    }
  } catch (error) {
    showMessage(error.message || "No se pudo consultar la operación.", "error");
  } finally {
    checkButton.disabled = false;
    checkButton.textContent = "Consultar estado";
  }
});
