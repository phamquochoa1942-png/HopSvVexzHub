// ============================================================
// VexzHub Relay API
// Nhận data từ script Roblox (đã xác thực bằng id/apiKey),
// KHÔNG giải mã jobId ra dạng thô — giữ nguyên dạng đã mã hoá
// ("VexzHub" + base64) và nhét thẳng vào đoạn code copy-paste
// (kèm hàm tự giải mã bên trong) rồi forward embed sang đúng
// Discord webhook được cấu hình cho id đó.
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

const app = express();
app.use(express.json());

// Nhãn category hiển thị trong embed, map theo "id" (không phụ thuộc user chỉnh sửa)
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
  id_full_moon: "Event",
  id_pirate_raid: "Event",
  id_sword_dealer: "Dealer",
  id_haki_dealer: "Dealer",
  id_cake_spawner: "Event",
};

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

// Đoạn code Lua tự giải mã "VexzHub"+base64 rồi gọi remote hop server.
// jobId THẬT không bao giờ xuất hiện dạng thô trong tin nhắn Discord —
// chỉ ai paste đoạn code này vào exploit thì mới decode ra lúc chạy.
function buildJoinScriptPretty(encodedJob) {
  return `local encoded = "${encodedJob}"
local b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local function base64_decode(data)
    data = string.gsub(data, '[^'..b64chars..'=]', '')
    return (data:gsub('.', function(x)
        if x == '=' then return '' end
        local r, f = '', (b64chars:find(x) - 1)
        for i = 6, 1, -1 do r = r .. (f % 2^i - f % 2^(i-1) > 0 and '1' or '0') end
        return r
    end):gsub('%d%d%d?%d?%d?%d?%d?%d?', function(x)
        if #x ~= 8 then return '' end
        local c = 0
        for i = 1, 8 do c = c + (x:sub(i, i) == '1' and 2^(8 - i) or 0) end
        return string.char(c)
    end))
end
local jobId = base64_decode(encoded:sub(8))
game:GetService("ReplicatedStorage").__ServerBrowser:InvokeServer("teleport", jobId)`;
}

function buildJoinScriptMinified(encodedJob) {
  return `local encoded="${encodedJob}";local b64chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';local function base64_decode(data) data=string.gsub(data,'[^'..b64chars..'=]',''); return (data:gsub('.',function(x) if x=='=' then return '' end local r,f='',(b64chars:find(x)-1) for i=6,1,-1 do r=r..(f%2^i-f%2^(i-1)>0 and '1' or '0') end return r end):gsub('%d%d%d?%d?%d?%d?%d?%d?',function(x) if #x~=8 then return '' end local c=0 for i=1,8 do c=c+(x:sub(i,i)=='1' and 2^(8-i) or 0) end return string.char(c) end)) end local jobId=base64_decode(encoded:sub(8)); game:GetService("ReplicatedStorage").__ServerBrowser:InvokeServer("teleport", jobId)`;
}

app.post("/push", async (req, res) => {
  try {
    const { id, apiKey, job, players, sea, boss } = req.body || {};

    if (!id || !apiKey || !job || !boss) {
      return res.status(400).json({ error: "missing required fields" });
    }

    const entry = config[id];
    if (!entry || entry.apiKey !== apiKey) {
      return res.status(401).json({ error: "invalid id or apiKey" });
    }

    // Kiểm tra sơ format (đúng tiền tố "VexzHub"), KHÔNG decode ra dùng để hiển thị
    const PREFIX = "VexzHub";
    if (typeof job !== "string" || !job.startsWith(PREFIX)) {
      return res.status(400).json({ error: "invalid job format (missing VexzHub prefix)" });
    }

    const dedupeKey = `${id}:${boss}:${job}`;
    if (isDuplicate(dedupeKey)) {
      return res.json({ ok: true, skipped: "duplicate" });
    }

    const category = CATEGORY_BY_ID[id] || "Notify";
    const mobileCopy = buildJoinScriptMinified(job);
    const pcCopy = buildJoinScriptPretty(job);

    const discordBody = {
      embeds: [
        {
          color: 16753920,
          fields: [
            { name: "📌 Name", value: category, inline: true },
            { name: "🌊 Sea", value: "Sea " + String(sea ?? "?"), inline: true },
            { name: "👥 Players", value: String(players ?? "?"), inline: true },
            { name: category, value: String(boss) },
            { name: "📱 Mobile Copy", value: "```lua\n" + mobileCopy + "\n```" },
            { name: "💻 PC Copy", value: "```lua\n" + pcCopy + "\n```" },
            { name: "🆔 Job ID (Encoded)", value: "```" + job + "```" },
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
app.listen(PORT, () => {
  console.log("VexzHub Relay API đang chạy ở port " + PORT);
  if (Object.keys(config).length === 0) {
    console.warn("⚠️  CONFIG_JSON đang rỗng hoặc chưa được set trong Render Environment — mọi request /push sẽ bị từ chối (401).");
  } else {
    console.log("✅ Đã load config cho " + Object.keys(config).length + " id.");
  }
}); 
