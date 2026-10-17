const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ROBLOX_ASSETS = 'https://apis.roblox.com/assets/v1';

function send(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(JSON.stringify(data));
}

function validPublicIp(ip) {
  if (ip.includes(':')) {
    const s = ip.toLowerCase();
    return !(s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80:') || s.startsWith('::ffff:127.') || s.startsWith('::ffff:10.') || s.startsWith('::ffff:192.168.'));
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127));
}

async function validateFileUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('fileUrl no es una URL válida'); }
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('fileUrl debe ser HTTPS y no incluir credenciales');
  if (!/\.(rbxm|rbxmx)$/i.test(u.pathname)) throw new Error('El enlace debe terminar en .rbxm o .rbxmx');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal') throw new Error('El host del archivo no es público');
  const { lookup } = await import('node:dns/promises');
  let addresses;
  try { addresses = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new Error('No se pudo resolver el host de fileUrl'); }
  if (!addresses.length || addresses.some(a => !validPublicIp(a.address))) throw new Error('El host del archivo no es público');
  return u;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method === 'GET') return send(res, 200, { ok: true, route: '/api/upload', method: 'POST required', runtime: 'nodejs' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Usa POST' });
  try {
    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const apiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : '';
    const ownerId = String(data.ownerId || '').trim();
    const ownerType = data.ownerType || 'user';
    const fileUrl = String(data.fileUrl || '').trim();
    if (!apiKey) return send(res, 400, { error: 'Falta apiKey' });
    if (!/^\d+$/.test(ownerId)) return send(res, 400, { error: 'ownerId debe ser numérico' });
    if (!['user', 'group'].includes(ownerType)) return send(res, 400, { error: 'ownerType debe ser user o group' });
    let file;
    try { file = await validateFileUrl(fileUrl); }
    catch (e) { return send(res, 400, { error: e.message }); }

    const downloaded = await fetch(file, { redirect: 'manual', signal: AbortSignal.timeout(25000) });
    if (!downloaded.ok) return send(res, 400, { error: `No se pudo descargar el archivo (HTTP ${downloaded.status}). Usa un enlace directo público.` });
    const declaredLength = Number(downloaded.headers.get('content-length') || 0);
    if (declaredLength > MAX_FILE_SIZE) return send(res, 413, { error: 'El archivo supera el límite de 20 MB' });
    const fileBuffer = Buffer.from(await downloaded.arrayBuffer());
    if (!fileBuffer.length) return send(res, 400, { error: 'El archivo descargado está vacío' });
    if (fileBuffer.length > MAX_FILE_SIZE) return send(res, 413, { error: 'El archivo supera el límite de 20 MB' });

    const metadata = {
      assetType: String(data.assetType || 'Model'),
      displayName: String(data.name || data.displayName || 'myfile').slice(0, 50),
      description: String(data.description || '').slice(0, 1000),
      creationContext: { creator: ownerType === 'group' ? { groupId: ownerId } : { userId: ownerId } }
    };
    const filename = decodeURIComponent(file.pathname.split('/').pop() || 'model.rbxmx');
    const contentType = filename.toLowerCase().endsWith('.rbxmx') ? 'model/x-rbxmx' : 'model/x-rbxm';
    const form = new FormData();
    form.append('request', JSON.stringify(metadata));
    form.append('fileContent', new Blob([fileBuffer], { type: contentType }), filename);
    const response = await fetch(`${ROBLOX_ASSETS}/assets`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: form,
      signal: AbortSignal.timeout(55000)
    });
    const raw = await response.text();
    let result;
    try { result = JSON.parse(raw); } catch { result = { message: raw.slice(0, 400) }; }
    if (!response.ok) return send(res, response.status, { error: result.message || result.error || `Roblox respondió HTTP ${response.status}` });
    let operation = result.path || result.operation || result.operationId;
    if (typeof operation === 'string' && operation.startsWith('operations/')) operation = operation.slice('operations/'.length);
    if (!operation) return send(res, 502, { error: 'Roblox no devolvió una operación reconocible', details: result });
    return send(res, 200, { operation });
  } catch (error) {
    const message = error && error.name === 'TimeoutError' ? 'La solicitud agotó el tiempo de espera' : 'Error interno procesando la subida';
    return send(res, 500, { error: message });
  }
};
