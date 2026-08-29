// ============================================================
// VexzHub Relay API
// Nhận data từ script Roblox (đã xác thực bằng id/apiKey),
// giải mã jobId (client gửi base64), rồi forward embed sang
// đúng Discord webhook được cấu hình cho id đó.
// ============================================================

const express = require("express");
const fetch = require("node-fetch"); // node 16/18 nào thiếu fetch global thì dùng cái này
const config = require("./config.json");

const app = express();
app.use(express.json());

// Chặn spam gọi liên tục cùng 1 job trong thời gian ngắn (tránh Discord rate-limit / spam kênh)
const lastSentCache = new Map(); // key: `${id}:${boss}:${jobIdRaw}` -> timestamp
const DEDUPE_WINDOW_MS = 60 * 1000; // 60s

function isDuplicate(key) {
  const now = Date.now();
  const last = lastSentCache.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return true;
  lastSentCache.set(key, now);
  return false;
}

app.post("/push", async (req, res) => {
  try {
    const { id, apiKey, job, placeId, players, sea, boss } = req.body || {};

    if (!id || !apiKey || !job || !boss) {
      return res.status(400).json({ error: "missing required fields" });
    }

    const entry = config[id];
    if (!entry || entry.apiKey !== apiKey) {
      return res.status(401).json({ error: "invalid id or apiKey" });
    }

    // Giải mã jobId: client gửi dạng "VexzHub" + base64(jobId)
    const PREFIX = "VexzHub";
    if (typeof job !== "string" || !job.startsWith(PREFIX)) {
      return res.status(400).json({ error: "invalid job format (missing VexzHub prefix)" });
    }
    const b64Part = job.slice(PREFIX.length);

    let jobId;
    try {
      jobId = Buffer.from(b64Part, "base64").toString("utf8");
      if (!jobId) throw new Error("empty");
    } catch (e) {
      return res.status(400).json({ error: "invalid job encoding" });
    }

    const dedupeKey = `${id}:${boss}:${jobId}`;
    if (isDuplicate(dedupeKey)) {
      return res.json({ ok: true, skipped: "duplicate" });
    }

    const joinLink =
      "https://www.roblox.com/games/start?placeId=" +
      encodeURIComponent(placeId || "") +
      "&gameInstanceId=" +
      encodeURIComponent(jobId);

    const discordBody = {
      embeds: [
        {
          title: "🔔 " + String(boss),
          color: 16753920,
          fields: [
            { name: "Sea", value: "Sea " + String(sea ?? "?"), inline: true },
            { name: "Players", value: String(players ?? "?"), inline: true },
            { name: "Job Id", value: "```" + jobId + "```", inline: false },
            {
              name: "Hop Server",
              value: "[Bấm để join server này](" + joinLink + ")",
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const discordRes = await fetch(entry.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordBody),
    });

    if (!discordRes.ok) {
      const text = await discordRes.text().catch(() => "");
      console.error("Discord webhook failed:", discordRes.status, text);
      return res.status(502).json({ error: "discord webhook failed" });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Relay error:", err);
    return res.status(500).json({ error: "server error" });
  }
});

// health check, để test xem server sống chưa (mở link .../ping trên trình duyệt)
app.get("/ping", (_req, res) => res.send("pong"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("VexzHub Relay API đang chạy ở port " + PORT));
