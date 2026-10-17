const ROBLOX_ASSETS = 'https://apis.roblox.com/assets/v1';
function send(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.end(JSON.stringify(data));
}
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method === 'GET') return send(res, 200, { ok: true, route: '/api/status', method: 'POST required', runtime: 'nodejs' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Usa POST' });
  try {
    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const apiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : '';
    let operation = String(data.operation || '').trim();
    if (!apiKey || !operation) return send(res, 400, { error: 'Falta apiKey u operation' });
    if (operation.startsWith('operations/')) operation = operation.slice('operations/'.length);
    if (!/^[A-Za-z0-9_-]+$/.test(operation)) return send(res, 400, { error: 'operation no es válido' });
    const upstream = await fetch(`${ROBLOX_ASSETS}/operations/${encodeURIComponent(operation)}`, {
      headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(20000)
    });
    const raw = await upstream.text();
    let dataOut;
    try { dataOut = JSON.parse(raw); } catch { dataOut = {}; }
    if (!upstream.ok) return send(res, upstream.status, { error: dataOut.message || dataOut.error || `Roblox respondió HTTP ${upstream.status}` });
    const response = dataOut.response || {};
    const assetId = response.assetId || (typeof response.path === 'string' ? response.path.split('/').pop() : undefined);
    const moderation = response.moderationResult || {};
    return send(res, 200, { done: Boolean(dataOut.done), assetId, moderationState: moderation.moderationState, response });
  } catch (error) {
    return send(res, 502, { error: error && error.name === 'TimeoutError' ? 'Roblox tardó demasiado en responder' : 'No se pudo consultar la operación en Roblox' });
  }
};
