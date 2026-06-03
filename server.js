const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 5173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function has(text, words) {
  return words.some((word) => text.includes(word));
}

function semanticParse(prompt, assetType = "character") {
  const text = String(prompt || "").toLowerCase();
  const semantic = {
    cat: has(text, ["猫", "猫咪", "小猫", "cat", "kitten"]),
    dog: has(text, ["狗", "小狗", "狗狗", "柴犬", "柯基", "金毛", "哈士奇", "犬", "dog", "puppy", "corgi", "shiba", "husky"]),
    owl: has(text, ["猫头鹰", "猫头鷹", "夜枭", "鸮", "owl"]),
    bird: has(text, ["鸟", "小鸟", "鹰", "隼", "bird", "eagle", "falcon"]),
    vehicle: has(text, ["车", "汽车", "跑车", "轿车", "车辆", "car", "vehicle", "sedan", "suv"]),
    tesla: has(text, ["特斯拉", "tesla", "model 3", "model y", "model s", "cybertruck"]),
    spaceship: has(text, ["飞船", "宇宙飞船", "战机", "spaceship", "fighter", "starship"]),
    building: has(text, ["建筑", "房子", "城堡", "塔", "屋", "building", "house", "castle", "tower"]),
    character: has(text, ["人", "人物", "角色", "武士", "骑士", "剑士", "法师", "弓箭手", "warrior", "samurai", "knight", "mage", "character", "hero"]),
    potion: has(text, ["药水", "瓶子", "potion", "bottle"]),
    weapon: has(text, ["剑", "刀", "枪", "武器", "sword", "blade", "weapon", "gun"]),
    chest: has(text, ["宝箱", "箱子", "chest", "treasure"]),
    mech: has(text, ["机械", "机甲", "机器人", "robot", "mech", "machine"]),
    slime: has(text, ["史莱姆", "slime"]),
    plant: has(text, ["植物", "花", "树", "plant", "flower"]),
    monochrome: has(text, ["黑白", "白黑", "black and white", "monochrome", "grayscale"]),
    black: has(text, ["黑", "黑色", "black"]),
    white: has(text, ["白", "白色", "white"]),
    gray: has(text, ["灰", "灰色", "银", "银色", "gray", "grey", "silver"]),
    pink: has(text, ["粉", "粉色", "pink"]),
    green: has(text, ["绿", "绿色", "green"]),
    orange: has(text, ["橙", "橙色", "orange"]),
    purple: has(text, ["紫", "purple", "violet"]),
    blue: has(text, ["蓝", "blue"]),
    red: has(text, ["红", "red"]),
    gold: has(text, ["金", "gold", "黄金"]),
    fire: has(text, ["火", "flame", "fire", "焰"]),
    ice: has(text, ["冰", "ice", "frost"]),
    thunder: has(text, ["雷", "电", "lightning", "thunder"]),
  };

  const characterIntent = assetType === "character" || semantic.character;
  const subject =
    characterIntent ? "character" :
    semantic.tesla ? "tesla" :
    semantic.vehicle ? "vehicle" :
    semantic.dog ? "dog" :
    semantic.owl ? "owl" :
    semantic.cat ? "cat" :
    semantic.spaceship ? "spaceship" :
    semantic.building ? "building" :
    semantic.weapon ? "weapon" :
    semantic.potion ? "potion" :
    semantic.chest ? "chest" :
    assetType;

  return { semantic, subject };
}

function normalizeSemanticPlan(plan, fallback) {
  if (!plan || typeof plan !== "object") return fallback;
  const allowedSubjects = new Set([
    "character", "cat", "dog", "owl", "bird", "vehicle", "tesla", "spaceship",
    "building", "weapon", "potion", "chest", "mech", "slime", "plant", "tile", "icon", "prop",
  ]);
  const semantic = { ...fallback.semantic };
  if (plan.semantic && typeof plan.semantic === "object") {
    Object.entries(plan.semantic).forEach(([key, value]) => {
      semantic[key] = Boolean(value);
    });
  }
  const subject = allowedSubjects.has(plan.subject) ? plan.subject : fallback.subject;
  return {
    semantic,
    subject,
    modelNote: typeof plan.note === "string" ? plan.note.slice(0, 240) : "",
  };
}

async function parseWithDeepSeek(payload) {
  const fallback = semanticParse(payload.prompt, payload.assetType);
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return { engine: "local-semantic", ...fallback };

  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response;

  const systemPrompt = [
    "You parse Chinese or English 2D game asset prompts.",
    "Return JSON only. No markdown.",
    "Schema: {\"subject\":\"character|cat|dog|owl|bird|vehicle|tesla|spaceship|building|weapon|potion|chest|mech|slime|plant|tile|icon|prop\",\"semantic\":{\"character\":boolean,\"cat\":boolean,\"dog\":boolean,\"owl\":boolean,\"vehicle\":boolean,\"tesla\":boolean,\"weapon\":boolean,\"monochrome\":boolean,\"black\":boolean,\"white\":boolean,\"gray\":boolean,\"blue\":boolean,\"red\":boolean,\"green\":boolean,\"purple\":boolean,\"gold\":boolean,\"fire\":boolean,\"ice\":boolean,\"thunder\":boolean},\"note\":\"short Chinese note\"}.",
    "If a prompt mentions a character and a weapon, choose subject=character and mark weapon=true.",
    "For 黑白/black and white, mark monochrome=true, black=true, white=true.",
  ].join(" ");

  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify({
            prompt: payload.prompt || "",
            assetType: payload.assetType || "character",
            style: payload.style || "",
          }) },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } catch (cause) {
    return {
      engine: "local-semantic",
      ...fallback,
      note: `DeepSeek 不可用，已回退本地语义解析：${cause.message}`,
    };
  } finally {
    clearTimeout(timeout);
  }

  let result = {};
  try {
    result = await response.json();
  } catch {
    return { engine: "local-semantic", ...fallback, note: "DeepSeek 响应不可解析，已回退本地语义解析。" };
  }

  if (!response.ok) {
    return {
      engine: "local-semantic",
      ...fallback,
      note: `DeepSeek 调用失败，已回退本地语义解析：${result.error?.message || response.status}`,
    };
  }

  try {
    const content = result.choices?.[0]?.message?.content || "{}";
    const plan = JSON.parse(content);
    return {
      engine: "deepseek-semantic",
      model,
      ...normalizeSemanticPlan(plan, fallback),
    };
  } catch {
    return { engine: "local-semantic", ...fallback, note: "DeepSeek JSON 格式异常，已回退本地语义解析。" };
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function buildImagePrompt(payload) {
  const parsed = semanticParse(payload.prompt, payload.assetType);
  const subject = parsed.subject;
  const characterIntent = subject === "character" || payload.assetType === "character";
  const styleName = payload.style === "pixel" ? "crisp pixel art" : payload.style === "neon" ? "neon sci-fi game art" : payload.style === "ink" ? "ink wash game concept art" : "polished 2D game asset";
  const colorHints = Array.isArray(payload.palette) ? payload.palette.join(", ") : "";
  return [
    `Create a ${styleName} for a 2D game.`,
    `Subject: ${payload.prompt}. Interpreted subject category: ${subject}.`,
    characterIntent ? "If the prompt mentions a weapon, draw the full character holding or using that weapon; do not generate the weapon alone." : "",
    characterIntent ? "The full person/creature must be visible: head, torso, arms, legs, costume, and equipment." : "",
    "Make the object/person highly recognizable and centered.",
    "Use a transparent or plain clean background. Do not include text, watermark, UI, frame, or mockup.",
    "Single isolated game asset, full body/object visible, readable silhouette, strong details, production-quality shape language.",
    "Suitable for Unity or Godot sprite workflows.",
    colorHints ? `Preferred palette: ${colorHints}.` : "",
  ].filter(Boolean).join(" ");
}

async function generateOpenAIImage(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("未配置 OPENAI_API_KEY，无法调用真实图像生成模型。");
    error.status = 400;
    throw error;
  }

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const prompt = buildImagePrompt(payload);
  const imageSize = Number(payload.size) >= 512 ? "1024x1024" : "1024x1024";
  const requestBody = {
    model,
    prompt,
    size: imageSize,
    quality: process.env.OPENAI_IMAGE_QUALITY || "medium",
    n: 1,
    background: "transparent",
    output_format: "png",
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  let response;
  try {
    response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (cause) {
    const hint = cause.name === "AbortError"
      ? "请求超时，请检查网络或稍后重试。"
      : "无法连接图像生成服务，请检查网络、代理、DNS，或配置 OPENAI_BASE_URL。";
    const error = new Error(`${hint} 当前地址：${baseUrl}。底层错误：${cause.message}`);
    error.status = 502;
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error?.message || "OpenAI 图像生成失败。");
    error.status = response.status;
    throw error;
  }

  const imageBase64 = result.data?.[0]?.b64_json;
  if (!imageBase64) {
    const error = new Error("OpenAI 响应中没有图片数据。");
    error.status = 502;
    throw error;
  }

  return {
    model,
    prompt,
    image: `data:image/png;base64,${imageBase64}`,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const filePath = path.normalize(path.join(root, urlPath === "/" ? "index.html" : urlPath));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/semantic-parse") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const parsed = await parseWithDeepSeek(payload);
      sendJson(res, 200, {
        ...parsed,
        note: parsed.note || parsed.modelNote || "DeepSeek 未配置时会自动使用本地语义解析。",
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }
  if (req.method === "POST" && req.url === "/api/generate-image") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const generated = await generateOpenAIImage(payload);
      sendJson(res, 200, {
        engine: "openai-images",
        ...generated,
      });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message });
    }
    return;
  }
  serveStatic(req, res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`SpriteForge server running at http://127.0.0.1:${port}`);
});
