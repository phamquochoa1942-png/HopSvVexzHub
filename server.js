const express = require("express");
const fetch = require("node-fetch");

let config = {};
try {
  config = JSON.parse(process.env.CONFIG_JSON || "{}");
} catch (e) {
  console.error(
    "❌ CONFIG_JSON không parse được — kiểm tra lại JSON dán trong Render Environment:",
    e.message
  );
}

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
  id_server_4h: "Server 4H",
};

const app = express();
app.use(express.json({ limit: "1mb" }));

const lastSentCache = new Map();
const DEDUPE_WINDOW_MS = 60 * 1000;

function isDuplicate(key) {
  const now = Date.now();
  const last = lastSentCache.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return true;
  lastSentCache.set(key, now);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, t] of lastSentCache) {
    if (now - t > DEDUPE_WINDOW_MS * 10) lastSentCache.delete(k);
  }
}, 5 * 60 * 1000);

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

// ====== BUILD EMBED MẶC ĐỊNH (client cũ) ======
function buildDefaultEmbed({ category, boss, players, maxPlayers, sea, job }) {
  return {
    color: 16753920,
    fields: [
      { name: "Player Count", value: `${players ?? "?"}/${maxPlayers ?? "?"}` },
      { name: "World", value: `World ${sea ?? "?"}` },
      { name: category, value: String(boss) },
      { name: "Job Id PC Copy", value: "```" + job + "```" },
      { name: "Job Id Mobile Copy", value: "`" + job + "`" },
      { name: "Time", value: formatTime(new Date()) },
    ],
    // Không có footer Notify By
  };
}

app.post("/push", async (req, res) => {
  try {
    const {
      id, apiKey, job, players, maxPlayers, sea, boss,
      placeId, embeds,
    } = req.body || {};

    if (!id || !apiKey || !job || !boss) {
      return res.status(400).json({ error: "missing required fields" });
    }

    const entry = config[id];
    if (!entry || entry.apiKey !== apiKey) {
      return res.status(401).json({ error: "invalid id or apiKey" });
    }

    const PREFIX = "VexzHub|";
    if (typeof job !== "string" || !job.startsWith(PREFIX)) {
      return res.status(400).json({ error: "invalid job format (missing VexzHub| prefix)" });
    }

    const dedupeKey = `${id}:${boss}:${job}`;
    if (isDuplicate(dedupeKey)) {
      return res.json({ ok: true, skipped: "duplicate" });
    }

    // ====== CHỌN EMBEDS GỬI ĐI ======
    let finalEmbeds;

    if (Array.isArray(embeds) && embeds.length > 0) {
      // Client gửi embeds -> dùng thẳng, CHỈ đảm bảo có Job ID, KHÔNG thêm footer
      finalEmbeds = embeds.map((e) => {
        const copy = JSON.parse(JSON.stringify(e));

        if (!Array.isArray(copy.fields)) copy.fields = [];

        const hasJobField = copy.fields.some(
          (f) => typeof f.name === "string" && f.name.includes("Job")
        );
        if (!hasJobField) {
          copy.fields.push({
            name: "🔑 Job ID",
            value: "```" + job + "```",
            inline: false,
          });
        }

        // Loại bỏ footer Notify By nếu client lỡ gửi
        if (copy.footer && typeof copy.footer.text === "string" &&
            copy.footer.text.includes("Notify By")) {
          delete copy.footer;
        }

        return copy;
      });
    } else {
      finalEmbeds = [
        buildDefaultEmbed({
          category: CATEGORY_BY_ID[id] || "Name",
          boss, players, maxPlayers, sea, job,
        }),
      ];
    }

    const discordBody = { embeds: finalEmbeds };

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

app.get("/ping", (_req, res) => res.send("pong"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("VexzHub Relay API đang chạy ở port " + PORT);
  if (Object.keys(config).length === 0) {
    console.warn(
      "⚠️  CONFIG_JSON đang rỗng hoặc chưa được set trong Render Environment — mọi request /push sẽ bị từ chối (401)."
    );
  } else {
    console.log("✅ Đã load config cho " + Object.keys(config).length + " id.");
  }
}); 
