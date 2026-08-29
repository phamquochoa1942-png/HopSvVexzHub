// ============================================================
// VexzHub Relay API
// Nhận data từ script Roblox (đã xác thực bằng id/apiKey),
// KHÔNG giải mã jobId — giữ nguyên dạng đã mã hoá "VexzHub|<base64>"
// và hiển thị thẳng trong embed (Job Id PC Copy / Job Id Mobile Copy),
// rồi forward sang đúng Discord webhook được cấu hình cho id đó.
// ============================================================

const express = require("express");
const fetch = require("node-fetch");

// Đọc config từ biến môi trường CONFIG_JSON (Render) thay vì file config.json
// -> webhook URL thật không nằm trong code/git nữa, chỉ nằm trong Render dashboard.
let config = {};
try {
  config = JSON.parse(process.env.CONFIG_JSON || "{}");
} catch (e) {
  console.error("❌ CONFIG_JSON không parse được — kiểm tra lại JSON dán trong Render Environment:", e.message);
}

// Nhãn field hiển thị theo đúng loại sự kiện, thay vì luôn ghi cứng "Name"
// (Prehistoric Island là đảo sự kiện chứ không phải boss, nên phải ghi đúng)
const CATEGORY_BY_ID = {
  id_darkbeard: "Boss",
  id_cursed_captain: "Boss",
  id_rip_indra: "Boss",
  id_dough_king: "Boss",
  id_cake_prince: "Boss",
  id_cake_queen: "Boss",
  id_tyrant: "Boss",
  id_soul_reaper: "Boss",
  id_elite: "Elite",
  id_rare_npc: "Rare NPC",
  id_fruit: "Fruit",
  id_berry: "Berry",
  id_mirage: "Island",
  id_kitsune: "Island",
  id_prehistoric: "Island",
  id_leviathan: "Island",
  id_full_moon: "Full Moon",
  id_pirate_raid: "Event",
  id_sword_dealer: "Dealer",
  id_haki_dealer: "Dealer",
  id_cake_spawner: "Boss",
};

const app = express();
app.use(express.json());

// Chặn spam gọi liên tục cùng 1 job trong thời gian ngắn (tránh Discord rate-limit / spam kênh)
const lastSentCache = new Map(); // key: `${id}:${boss}:${encodedJob}` -> timestamp
const DEDUPE_WINDOW_MS = 60 * 1000; // 60s

function isDuplicate(key) {
  const now = Date.now();
  const last = lastSentCache.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return true;
  lastSentCache.set(key, now);
  return false;
}

// "2026-08-29 21:21:49" — giờ server (UTC), format giống mẫu
function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear() +
    "-" + pad(date.getUTCMonth() + 1) +
    "-" + pad(date.getUTCDate()) +
    " " + pad(date.getUTCHours()) +
    ":" + pad(date.getUTCMinutes()) +
    ":" + pad(date.getUTCSeconds())
  );
}

app.post("/push", async (req, res) => {
  try {
    const { id, apiKey, job, players, maxPlayers, sea, boss } = req.body || {};

    if (!id || !apiKey || !job || !boss) {
      return res.status(400).json({ error: "missing required fields" });
    }

    const entry = config[id];
    if (!entry || entry.apiKey !== apiKey) {
      return res.status(401).json({ error: "invalid id or apiKey" });
    }

    // Kiểm tra sơ format (đúng tiền tố "VexzHub|"), KHÔNG decode ra dùng để hiển thị
    const PREFIX = "VexzHub|";
    if (typeof job !== "string" || !job.startsWith(PREFIX)) {
      return res.status(400).json({ error: "invalid job format (missing VexzHub| prefix)" });
    }

    const dedupeKey = `${id}:${boss}:${job}`;
    if (isDuplicate(dedupeKey)) {
      return res.json({ ok: true, skipped: "duplicate" });
    }

    const category = CATEGORY_BY_ID[id] || "Name";

    const discordBody = {
      embeds: [
        {
          color: 16753920,
          fields: [
            { name: "Player Count", value: `${players ?? "?"}/${maxPlayers ?? "?"}` },
            { name: "World", value: `World ${sea ?? "?"}` },
            { name: category, value: String(boss) },
            { name: "Job Id PC Copy", value: "```" + job + "```" },
            { name: "Job Id Mobile Copy", value: "`" + job + "`" },
            { name: "Time", value: formatTime(new Date()) },
          ],
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
app.listen(PORT, () => {
  console.log("VexzHub Relay API đang chạy ở port " + PORT);
  if (Object.keys(config).length === 0) {
    console.warn("⚠️  CONFIG_JSON đang rỗng hoặc chưa được set trong Render Environment — mọi request /push sẽ bị từ chối (401).");
  } else {
    console.log("✅ Đã load config cho " + Object.keys(config).length + " id.");
  }
}); 
