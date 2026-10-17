// Servidor para https://eow.com/getdata/auth
// Recibe userid, gameid, name y display desde el script de Roblox.
// Devuelve true si name === display, false si no.
// Uso: node server.js   (sin dependencias, Node 16+)

const http = require("http");

const PORT = process.env.PORT || 3000;
const ROUTE = "/getdata/auth";
// Opcional: limita a ciertos juegos. Ej: ALLOWED_GAME_IDS=113289549640925
const ALLOWED = (process.env.ALLOWED_GAME_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

function check(data) {
  const userid = String(data.userid ?? "").trim();
  const gameid = String(data.gameid ?? "").trim();
  const placeid = String(data.placeid ?? "").trim();
  const name = String(data.name ?? "").trim();
  const display = String(data.display ?? "").trim();

  if (!/^\d+$/.test(userid) || !name || !display) return false;
  if (ALLOWED.length && !ALLOWED.includes(gameid) && !ALLOWED.includes(placeid)) return false;
  return name === display; // distingue mayúsculas/minúsculas, como Roblox
}

function send(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname !== ROUTE) return send(res, 404, { result: false, error: "not found" });

  // GET para probar desde el navegador: /getdata/auth?userid=1&gameid=2&name=a&display=a
  if (req.method === "GET") {
    const result = check(Object.fromEntries(url.searchParams));
    return send(res, 200, { result });
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10_000) req.destroy(); // evita cuerpos enormes
    });
    req.on("end", () => {
      let data;
      try { data = JSON.parse(body); } catch { return send(res, 400, { result: false, error: "invalid json" }); }
      const result = check(data);
      console.log(new Date().toISOString(), data.userid, data.name, "=>", result);
      send(res, 200, { result });
    });
    return;
  }

  send(res, 405, { result: false, error: "method not allowed" });
});

server.listen(PORT, () => console.log(`Auth escuchando en puerto ${PORT}${ROUTE}`));
