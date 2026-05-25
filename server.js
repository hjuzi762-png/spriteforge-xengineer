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

  const subject =
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

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
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
      const parsed = semanticParse(payload.prompt, payload.assetType);
      sendJson(res, 200, {
        engine: "local-semantic",
        ...parsed,
        note: "No external model key is required. This backend expands prompt understanding and can be replaced by a real image model proxy.",
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }
  serveStatic(req, res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`SpriteForge server running at http://127.0.0.1:${port}`);
});
