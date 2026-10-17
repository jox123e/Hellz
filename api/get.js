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
  if (req.method === 'GET') return send(res, 200, { ok: true, route: '/api/get', method: 'POST required', runtime: 'nodejs' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Usa POST' });
  try {
    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const apiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : '';
    const assetId = String(data.assetId || '').trim();
    if (!apiKey || !/^\d+$/.test(assetId)) return send(res, 400, { error: 'Falta apiKey o assetId inválido' });
    const upstream = await fetch(`${ROBLOX_ASSETS}/assets/${encodeURIComponent(assetId)}?readMask=moderationResult`, {
      headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(20000)
    });
    const raw = await upstream.text();
    let result;
    try { result = JSON.parse(raw); } catch { result = {}; }
    if (!upstream.ok) return send(res, upstream.status, { error: result.message || result.error || `Roblox respondió HTTP ${upstream.status}` });
    const moderation = result.moderationResult || {};
    return send(res, 200, { assetId, moderationState: moderation.moderationState || result.moderationState || 'Unknown' });
  } catch (error) {
    return send(res, 502, { error: error && error.name === 'TimeoutError' ? 'Roblox tardó demasiado en responder' : 'No se pudo consultar el asset en Roblox' });
  }
};
