const form = document.querySelector('#uploadForm');
const resultBox = document.querySelector('#result');
const submitBtn = document.querySelector('#submitBtn');

function showMessage(title, message, type = '') {
  resultBox.innerHTML = '';
  const h = document.createElement('h2'); h.textContent = title; resultBox.appendChild(h);
  const p = document.createElement('p'); p.className = type; p.textContent = message; resultBox.appendChild(p);
}
function addValue(label, value) {
  const row = document.createElement('div'); row.className = 'kv';
  const b = document.createElement('b'); b.textContent = label;
  const v = document.createElement('div'); v.textContent = value == null ? '—' : String(value);
  row.append(b, v); resultBox.appendChild(row);
}
async function apiPost(path, payload) {
  const response = await fetch(`/api/${path}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload), cache: 'no-store'
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`El servidor respondió HTTP ${response.status} sin JSON: ${text.slice(0, 240)}`); }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fd = new FormData(form);
  const payload = {
    apiKey: String(fd.get('apiKey') || '').trim(),
    ownerId: String(fd.get('ownerId') || '').trim(),
    ownerType: String(fd.get('ownerType') || 'user'),
    assetType: 'Model',
    name: String(fd.get('name') || '').trim() || 'myfile',
    description: String(fd.get('description') || ''),
    fileUrl: String(fd.get('fileUrl') || '').trim()
  };
  submitBtn.disabled = true; submitBtn.textContent = 'Subiendo…';
  showMessage('Procesando', 'Conectando con Roblox Open Cloud…');
  try {
    const uploaded = await apiPost('upload', payload);
    if (uploaded.error) throw new Error(uploaded.error);
    if (uploaded.assetId) {
      showMessage('Subida completada', 'Roblox devolvió un assetId.', 'ok');
      addValue('Asset ID', uploaded.assetId); return;
    }
    if (!uploaded.operation) throw new Error('La API no devolvió operation ni assetId. Revisa la respuesta del backend.');
    let status = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      status = await apiPost('status', {apiKey: payload.apiKey, operation: uploaded.operation});
      if (status.error) throw new Error(status.error);
      if (status.done === true) break;
    }
    const assetId = status && (status.assetId || (status.response && status.response.assetId));
    if (!status || status.done !== true || !assetId) {
      showMessage('Sigue procesándose', 'No se recibió un assetId en 60 segundos. Puedes volver a consultar el estado.');
      addValue('Operación', uploaded.operation); return;
    }
    let moderation = 'Unknown';
    try {
      const moderationResult = await apiPost('get', {apiKey: payload.apiKey, assetId: String(assetId)});
      moderation = moderationResult.moderationState || 'Unknown';
      if (moderationResult.error) moderation = `Error: ${moderationResult.error}`;
    } catch (e) { moderation = `No disponible: ${e.message}`; }
    showMessage('Subida completada', 'Roblox terminó la operación.', 'ok');
    addValue('Asset ID', assetId);
    addValue('Moderación', moderation);
    addValue('Operación', uploaded.operation);
  } catch (error) {
    showMessage('No se pudo completar', error.message || String(error), 'bad');
  } finally {
    // Vacía la clave del formulario después de la solicitud.
    form.elements.apiKey.value = '';
    submitBtn.disabled = false; submitBtn.textContent = 'Subir modelo';
  }
});
