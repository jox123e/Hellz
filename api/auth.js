export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Clave compartida opcional para que no cualquiera use tu endpoint
  const secret = process.env.AUTH_SECRET;
  if (secret && req.headers["x-auth-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    userid, gameid, placeid, name, display,
    serverid, ownerid, players
  } = req.body || {};

  const auth = String(name) === String(display);

  const payload = {
    username: "Roblox Logger",
    embeds: [{
      title: "Nuevo servidor / auth",
      color: auth ? 0x2ecc71 : 0xe74c3c,
      fields: [
        { name: "Auth", value: String(auth), inline: true },
        { name: "UserId", value: String(userid ?? "?"), inline: true },
        { name: "Name / Display", value: `${name} / ${display}`, inline: true },
        { name: "GameId", value: String(gameid ?? "?"), inline: true },
        { name: "PlaceId", value: String(placeid ?? "?"), inline: true },
        { name: "ServerId", value: "`" + String(serverid ?? "?") + "`" },
        { name: "Dueño (OwnerId)", value: String(ownerid ?? "?"), inline: true },
        { name: "Jugadores", value: String(players ?? "?"), inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  };

  try {
    await fetch(process.env.DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error("Webhook error", e);
  }

  return res.status(200).json({ auth });
}
