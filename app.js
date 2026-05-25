const $ = (selector) => document.querySelector(selector);

const state = {
  palette: ["#101214", "#39d19a", "#f8d96a", "#ea6464", "#f4f7f4"],
  seed: 2451529,
  grid: true,
  frames: [],
  activeFrame: 0,
  lastTick: 0,
  authMode: "login",
  user: null,
  authChallenge: 0,
  authFailures: 0,
  lockUntil: 0,
  uploadedImage: null,
  uploadedName: "",
  uploadedSubjectBox: null,
  useUploadedImage: false,
};

const palettes = [
  ["#101214", "#39d19a", "#f8d96a", "#ea6464", "#f4f7f4"],
  ["#151820", "#62a8ff", "#f3f7ff", "#ffae42", "#5d6b78"],
  ["#171111", "#e95d4f", "#ffc857", "#7bd389", "#fff7e6"],
  ["#111318", "#b8f2e6", "#aed9e0", "#ffa69e", "#faf3dd"],
  ["#16130f", "#d6a84f", "#f2ead3", "#5f8a70", "#2c2f33"],
];

const controls = {
  prompt: $("#prompt"),
  assetType: $("#assetType"),
  stylePreset: $("#stylePreset"),
  size: $("#size"),
  frames: $("#frames"),
  detail: $("#detail"),
  consistency: $("#consistency"),
  motionPrompt: $("#motionPrompt"),
};

const packItems = [
  { title: "主角", type: "character", note: "玩家角色，可作为 idle/run 动画基础" },
  { title: "敌人", type: "character", note: "同色系敌方单位，便于快速扩展关卡" },
  { title: "掉落物", type: "item", note: "宝箱、材料、任务物品等可交互资产" },
  { title: "地块", type: "tile", note: "地面或平台 tile，可拼接地图原型" },
  { title: "技能", type: "icon", note: "技能、状态或 UI 快捷栏图标" },
];

const preview = $("#preview");
const sheet = $("#sheet");
const pctx = preview.getContext("2d");
const sctx = sheet.getContext("2d");

const storageKeys = {
  users: "spriteforge_users_v1",
  session: "spriteforge_session_v1",
  history: "spriteforge_history_v1",
};

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function refreshCaptcha() {
  const left = Math.floor(Math.random() * 8) + 2;
  const right = Math.floor(Math.random() * 8) + 2;
  state.authChallenge = left + right;
  $("#captchaQuestion").textContent = `${left} + ${right} = ?`;
  $("#captchaAnswer").value = "";
}

function passwordStrength(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-zA-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  return score;
}

function validateAuthInput(name, password, confirmPassword) {
  if (!/^[\u4e00-\u9fa5\w-]{3,18}$/.test(name)) {
    return "用户名需为 3-18 位中文、字母、数字、下划线或短横线。";
  }
  if (passwordStrength(password) < 3) {
    return "密码至少 8 位，并包含字母、数字，建议再加入符号。";
  }
  if (state.authMode === "register" && password !== confirmPassword) {
    return "两次输入的密码不一致。";
  }
  if (Number($("#captchaAnswer").value.trim()) !== state.authChallenge) {
    refreshCaptcha();
    return "验证码不正确，请重新计算。";
  }
  return "";
}

function setAuthMode(mode) {
  state.authMode = mode;
  $("#loginTab").classList.toggle("active", mode === "login");
  $("#registerTab").classList.toggle("active", mode === "register");
  $("#authSubmit").textContent = mode === "login" ? "登录" : "注册";
  document.querySelectorAll(".register-only").forEach((node) => {
    node.classList.toggle("hidden", mode !== "register");
  });
  $("#authPassword").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#authMessage").textContent = "";
  refreshCaptcha();
}

function renderAuth() {
  const loggedIn = Boolean(state.user);
  $("#authStatus").textContent = loggedIn ? state.user : "未登录";
  $("#authName").value = loggedIn ? state.user : $("#authName").value;
  $("#authName").disabled = loggedIn;
  $("#authPassword").disabled = loggedIn;
  $("#authConfirm").disabled = loggedIn;
  $("#captchaAnswer").disabled = loggedIn;
  $("#authSubmit").classList.toggle("hidden", loggedIn);
  $("#logout").classList.toggle("hidden", !loggedIn);
  $("#authMessage").textContent = loggedIn ? "已登录，导出的 JSON 会记录作者和最近生成历史。" : "";
}

function submitAuth() {
  const name = $("#authName").value.trim();
  const password = $("#authPassword").value;
  const confirmPassword = $("#authConfirm").value;
  const users = readStorage(storageKeys.users, {});

  if (Date.now() < state.lockUntil) {
    const seconds = Math.ceil((state.lockUntil - Date.now()) / 1000);
    $("#authMessage").textContent = `验证失败过多，请 ${seconds} 秒后再试。`;
    return;
  }

  const validationMessage = validateAuthInput(name, password, confirmPassword);
  if (validationMessage) {
    $("#authMessage").textContent = validationMessage;
    return;
  }

  const passwordHash = hashText(`${name}|${password}|spriteforge`);
  if (state.authMode === "register") {
    if (users[name]) {
      $("#authMessage").textContent = "这个用户名已注册。";
      return;
    }
    users[name] = { passwordHash, createdAt: new Date().toISOString() };
    writeStorage(storageKeys.users, users);
    $("#authMessage").textContent = "注册成功，已自动登录。";
  } else if (!users[name] || users[name].passwordHash !== passwordHash) {
    state.authFailures += 1;
    if (state.authFailures >= 5) {
      state.lockUntil = Date.now() + 30 * 1000;
      state.authFailures = 0;
    }
    refreshCaptcha();
    $("#authMessage").textContent = "用户名或密码不正确。";
    return;
  }

  state.authFailures = 0;
  state.user = name;
  writeStorage(storageKeys.session, { user: name });
  $("#authConfirm").value = "";
  refreshCaptcha();
  renderAuth();
}

function logout() {
  state.user = null;
  localStorage.removeItem(storageKeys.session);
  $("#authPassword").value = "";
  $("#authConfirm").value = "";
  refreshCaptcha();
  renderAuth();
}

function recordGeneration() {
  if (!state.user) return;
  const history = readStorage(storageKeys.history, {});
  const list = history[state.user] ?? [];
  list.unshift({
    time: new Date().toISOString(),
    prompt: controls.prompt.value,
    source: state.useUploadedImage ? "uploaded-image" : "procedural",
    motion: controls.motionPrompt.value.trim(),
    seed: state.seed,
  });
  history[state.user] = list.slice(0, 12);
  writeStorage(storageKeys.history, history);
}

function analyzePrompt(prompt) {
  const text = prompt.toLowerCase();
  const has = (...words) => words.some((word) => text.includes(word));
  return {
    dark: has("暗黑", "黑暗", "dark", "shadow", "night"),
    knight: has("骑士", "knight", "武士", "warrior", "剑士"),
    chest: has("宝箱", "箱子", "chest", "treasure"),
    mage: has("法师", "巫师", "mage", "wizard"),
    archer: has("弓", "弓箭", "archer", "bow"),
    shield: has("盾", "shield"),
    staff: has("法杖", "权杖", "staff", "wand"),
    cat: has("猫", "cat"),
    owl: has("猫头鹰", "owl"),
    octopus: has("章鱼", "octopus"),
    mech: has("机械", "机甲", "robot", "mech", "machine"),
    plant: has("植物", "花", "树", "plant", "flower"),
    merchant: has("商人", "merchant", "shop"),
    slime: has("史莱姆", "slime"),
    purple: has("紫", "purple", "violet"),
    blue: has("蓝", "blue"),
    red: has("红", "red"),
    gold: has("金", "gold", "黄金"),
    fire: has("火", "flame", "fire", "焰"),
    ice: has("冰", "ice", "frost"),
    thunder: has("雷", "电", "lightning", "thunder"),
    forest: has("森林", "forest", "green", "自然"),
    cyber: has("赛博", "cyber", "neon", "科幻"),
    steampunk: has("蒸汽朋克", "steampunk"),
  };
}

function derivePalette(basePalette, semantic) {
  if (semantic.dark && semantic.purple) {
    return ["#090713", "#1b102b", "#5b21b6", "#a855f7", "#f5d0fe"];
  }
  if (semantic.dark) {
    return ["#090b10", "#1f2430", "#59606f", "#9ca3af", "#f4f7fb"];
  }
  if (semantic.purple) {
    return ["#151022", "#5b21b6", "#a855f7", "#f0abfc", "#fff7ff"];
  }
  if (semantic.fire) {
    return ["#1c0b08", "#dc2626", "#f97316", "#facc15", "#fff7ed"];
  }
  if (semantic.ice) {
    return ["#08131d", "#1d4ed8", "#60a5fa", "#bae6fd", "#f8fbff"];
  }
  if (semantic.thunder) {
    return ["#101019", "#2563eb", "#7dd3fc", "#facc15", "#fefce8"];
  }
  if (semantic.steampunk || semantic.gold) {
    return ["#17110c", "#7c4a1e", "#c08430", "#eab308", "#fff7d6"];
  }
  if (semantic.red) {
    return ["#1c0b0b", "#991b1b", "#ef4444", "#fb923c", "#fff1f2"];
  }
  if (semantic.blue) {
    return ["#08111f", "#1d4ed8", "#38bdf8", "#bfdbfe", "#f8fbff"];
  }
  if (semantic.forest) {
    return ["#0b1610", "#15803d", "#65a30d", "#bef264", "#f7fee7"];
  }
  return basePalette;
}

function updatePalette() {
  const palette = $("#palette");
  palette.innerHTML = "";
  state.palette.forEach((color, index) => {
    const swatch = document.createElement("input");
    swatch.className = "swatch";
    swatch.type = "color";
    swatch.value = color;
    swatch.title = color;
    swatch.addEventListener("input", () => {
      state.palette[index] = swatch.value;
      generate();
      renderAssetPack();
    });
    palette.appendChild(swatch);
  });
}

function rect(ctx, x, y, w, h, color, unit) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x * unit), Math.round(y * unit), Math.round(w * unit), Math.round(h * unit));
}

function mirrorPixels(ctx, pixels, unit, cells) {
  pixels.forEach(([x, y, w, h, color]) => {
    rect(ctx, x, y, w, h, color, unit);
    rect(ctx, cells - x - w, y, w, h, color, unit);
  });
}

function ellipse(ctx, x, y, w, h, color, unit) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse((x + w / 2) * unit, (y + h / 2) * unit, (w / 2) * unit, (h / 2) * unit, 0, 0, Math.PI * 2);
  ctx.fill();
}

function strokeEllipse(ctx, x, y, w, h, color, unit, lineWidth = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, lineWidth * unit);
  ctx.beginPath();
  ctx.ellipse((x + w / 2) * unit, (y + h / 2) * unit, (w / 2) * unit, (h / 2) * unit, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawVectorFrame(ctx, frame, opt, type, size) {
  const semantic = opt.semantic;
  if (type === "character") {
    if (semantic.cat) drawVectorCat(ctx, frame, opt, size);
    else if (semantic.owl) drawVectorOwl(ctx, frame, opt, size);
    else if (semantic.slime) drawVectorSlime(ctx, frame, opt, size);
    else drawVectorHero(ctx, frame, opt, size);
    return true;
  }
  if (type === "item") {
    drawVectorItem(ctx, frame, opt, size);
    return true;
  }
  if (type === "tile") {
    drawVectorTile(ctx, frame, opt, size);
    return true;
  }
  if (type === "icon") {
    drawVectorIcon(ctx, frame, opt, size);
    return true;
  }
  return false;
}

function makeGradient(ctx, x, y, r, colors) {
  const gradient = ctx.createRadialGradient(x - r * 0.25, y - r * 0.35, r * 0.08, x, y, r);
  colors.forEach(([stop, color]) => gradient.addColorStop(stop, color));
  return gradient;
}

function drawVectorShape(ctx, path, fill, stroke, lineWidth = 4) {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.fill(path);
  ctx.stroke(path);
  ctx.restore();
}

function roundedRectPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  const path = new Path2D();
  path.moveTo(x + r, y);
  path.lineTo(x + width - r, y);
  path.quadraticCurveTo(x + width, y, x + width, y + r);
  path.lineTo(x + width, y + height - r);
  path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  path.lineTo(x + r, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  path.closePath();
  return path;
}

function drawVectorCat(ctx, frame, opt, size) {
  const { palette, semantic } = opt;
  const bob = Math.sin(frame * 1.4) * size * 0.015;
  const tail = Math.sin(frame * 1.2) * size * 0.045;
  const outline = palette[0];
  const body = makeGradient(ctx, size * 0.5, size * 0.5, size * 0.32, [[0, palette[4]], [0.2, palette[2]], [1, palette[1]]]);
  const accent = semantic.purple ? "#a855f7" : palette[3];

  ctx.save();
  ctx.translate(0, bob);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = size * 0.025;
  ctx.shadowOffsetY = size * 0.018;

  const tailPath = new Path2D();
  tailPath.moveTo(size * 0.3, size * 0.62);
  tailPath.bezierCurveTo(size * 0.09, size * 0.53 + tail, size * 0.18, size * 0.28 - tail, size * 0.35, size * 0.34);
  ctx.strokeStyle = outline;
  ctx.lineWidth = size * 0.085;
  ctx.lineCap = "round";
  ctx.stroke(tailPath);
  ctx.strokeStyle = palette[2];
  ctx.lineWidth = size * 0.052;
  ctx.stroke(tailPath);

  const bodyPath = new Path2D();
  bodyPath.ellipse(size * 0.5, size * 0.58, size * 0.21, size * 0.27, 0, 0, Math.PI * 2);
  drawVectorShape(ctx, bodyPath, body, outline, size * 0.018);

  const headPath = new Path2D();
  headPath.moveTo(size * 0.31, size * 0.42);
  headPath.quadraticCurveTo(size * 0.29, size * 0.26, size * 0.39, size * 0.29);
  headPath.lineTo(size * 0.46, size * 0.2);
  headPath.quadraticCurveTo(size * 0.5, size * 0.28, size * 0.54, size * 0.2);
  headPath.lineTo(size * 0.61, size * 0.29);
  headPath.quadraticCurveTo(size * 0.72, size * 0.26, size * 0.69, size * 0.43);
  headPath.bezierCurveTo(size * 0.68, size * 0.56, size * 0.58, size * 0.64, size * 0.5, size * 0.64);
  headPath.bezierCurveTo(size * 0.39, size * 0.64, size * 0.31, size * 0.55, size * 0.31, size * 0.42);
  drawVectorShape(ctx, headPath, body, outline, size * 0.018);

  ctx.fillStyle = palette[4];
  ctx.beginPath();
  ctx.ellipse(size * 0.43, size * 0.43, size * 0.042, size * 0.052, 0, 0, Math.PI * 2);
  ctx.ellipse(size * 0.57, size * 0.43, size * 0.042, size * 0.052, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.ellipse(size * 0.435, size * 0.435, size * 0.012, size * 0.03, 0, 0, Math.PI * 2);
  ctx.ellipse(size * 0.565, size * 0.435, size * 0.012, size * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = outline;
  ctx.lineWidth = size * 0.011;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.47);
  ctx.quadraticCurveTo(size * 0.49, size * 0.5, size * 0.46, size * 0.51);
  ctx.moveTo(size * 0.5, size * 0.47);
  ctx.quadraticCurveTo(size * 0.51, size * 0.5, size * 0.54, size * 0.51);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(size * 0.485, size * 0.465);
  ctx.quadraticCurveTo(size * 0.5, size * 0.485, size * 0.515, size * 0.465);
  ctx.quadraticCurveTo(size * 0.5, size * 0.452, size * 0.485, size * 0.465);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.32)";
  ctx.lineWidth = size * 0.011;
  ctx.beginPath();
  ctx.moveTo(size * 0.38, size * 0.36);
  ctx.quadraticCurveTo(size * 0.5, size * 0.3, size * 0.62, size * 0.36);
  ctx.stroke();

  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.ellipse(size * 0.43, size * 0.83, size * 0.055, size * 0.026, 0, 0, Math.PI * 2);
  ctx.ellipse(size * 0.57, size * 0.83, size * 0.055, size * 0.026, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawVectorEffects(ctx, frame, opt, size);
}

function drawVectorOwl(ctx, frame, opt, size) {
  const { palette } = opt;
  const flap = Math.sin(frame * 1.5) * size * 0.04;
  const outline = palette[0];
  const body = makeGradient(ctx, size * 0.5, size * 0.5, size * 0.32, [[0, palette[4]], [0.24, palette[2]], [1, palette[1]]]);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.34)";
  ctx.shadowBlur = size * 0.022;
  const leftWing = new Path2D();
  leftWing.moveTo(size * 0.38, size * 0.42);
  leftWing.bezierCurveTo(size * 0.15, size * 0.38 + flap, size * 0.16, size * 0.67, size * 0.36, size * 0.72);
  leftWing.quadraticCurveTo(size * 0.32, size * 0.56, size * 0.38, size * 0.42);
  drawVectorShape(ctx, leftWing, palette[2], outline, size * 0.016);
  const rightWing = new Path2D();
  rightWing.moveTo(size * 0.62, size * 0.42);
  rightWing.bezierCurveTo(size * 0.85, size * 0.38 - flap, size * 0.84, size * 0.67, size * 0.64, size * 0.72);
  rightWing.quadraticCurveTo(size * 0.68, size * 0.56, size * 0.62, size * 0.42);
  drawVectorShape(ctx, rightWing, palette[2], outline, size * 0.016);
  const bodyPath = new Path2D();
  bodyPath.moveTo(size * 0.34, size * 0.31);
  bodyPath.bezierCurveTo(size * 0.34, size * 0.19, size * 0.45, size * 0.26, size * 0.5, size * 0.2);
  bodyPath.bezierCurveTo(size * 0.55, size * 0.26, size * 0.66, size * 0.19, size * 0.66, size * 0.31);
  bodyPath.bezierCurveTo(size * 0.76, size * 0.54, size * 0.67, size * 0.82, size * 0.5, size * 0.83);
  bodyPath.bezierCurveTo(size * 0.33, size * 0.82, size * 0.24, size * 0.54, size * 0.34, size * 0.31);
  drawVectorShape(ctx, bodyPath, body, outline, size * 0.018);
  ctx.fillStyle = palette[4];
  ctx.beginPath();
  ctx.ellipse(size * 0.43, size * 0.42, size * 0.075, size * 0.085, 0, 0, Math.PI * 2);
  ctx.ellipse(size * 0.57, size * 0.42, size * 0.075, size * 0.085, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(size * 0.43, size * 0.42, size * 0.025, 0, Math.PI * 2);
  ctx.arc(size * 0.57, size * 0.42, size * 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f7b955";
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.48);
  ctx.lineTo(size * 0.46, size * 0.55);
  ctx.lineTo(size * 0.54, size * 0.55);
  ctx.fill();
  ctx.restore();
  drawVectorEffects(ctx, frame, opt, size);
}

function drawVectorSlime(ctx, frame, opt, size) {
  const { palette } = opt;
  const squash = Math.sin(frame * 1.7) * size * 0.025;
  const outline = palette[0];
  const body = makeGradient(ctx, size * 0.48, size * 0.48, size * 0.35, [[0, palette[4]], [0.28, palette[2]], [1, palette[1]]]);
  const blob = new Path2D();
  blob.moveTo(size * 0.2, size * 0.66 + squash);
  blob.bezierCurveTo(size * 0.18, size * 0.47, size * 0.31, size * 0.28 - squash, size * 0.5, size * 0.28);
  blob.bezierCurveTo(size * 0.71, size * 0.28 - squash, size * 0.84, size * 0.48, size * 0.8, size * 0.67 + squash);
  blob.bezierCurveTo(size * 0.7, size * 0.82, size * 0.31, size * 0.82, size * 0.2, size * 0.66 + squash);
  drawVectorShape(ctx, blob, body, outline, size * 0.018);
  ctx.fillStyle = palette[4];
  ctx.beginPath();
  ctx.ellipse(size * 0.42, size * 0.55, size * 0.035, size * 0.045, 0, 0, Math.PI * 2);
  ctx.ellipse(size * 0.59, size * 0.55, size * 0.035, size * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette[3];
  ctx.lineWidth = size * 0.014;
  ctx.beginPath();
  ctx.quadraticCurveTo(size * 0.45, size * 0.66, size * 0.53, size * 0.66);
  ctx.stroke();
  drawVectorEffects(ctx, frame, opt, size);
}

function drawVectorHero(ctx, frame, opt, size) {
  const { palette, semantic } = opt;
  const bob = Math.sin(frame * 1.35) * size * 0.014;
  const outline = palette[0];
  const armor = makeGradient(ctx, size * 0.5, size * 0.5, size * 0.32, [[0, palette[4]], [0.32, palette[2]], [1, palette[1]]]);
  ctx.save();
  ctx.translate(0, bob);
  ctx.shadowColor = "rgba(0,0,0,0.36)";
  ctx.shadowBlur = size * 0.02;
  const cloak = new Path2D();
  cloak.moveTo(size * 0.38, size * 0.36);
  cloak.bezierCurveTo(size * 0.22, size * 0.5, size * 0.26, size * 0.78, size * 0.42, size * 0.86);
  cloak.lineTo(size * 0.6, size * 0.86);
  cloak.bezierCurveTo(size * 0.74, size * 0.74, size * 0.78, size * 0.51, size * 0.62, size * 0.36);
  drawVectorShape(ctx, cloak, palette[1], outline, size * 0.017);
  const head = new Path2D();
  head.ellipse(size * 0.5, size * 0.32, size * 0.12, size * 0.14, 0, 0, Math.PI * 2);
  drawVectorShape(ctx, head, armor, outline, size * 0.016);
  const torso = roundedRectPath(size * 0.36, size * 0.46, size * 0.28, size * 0.28, size * 0.05);
  drawVectorShape(ctx, torso, armor, outline, size * 0.016);
  ctx.fillStyle = palette[4];
  ctx.beginPath();
  ctx.ellipse(size * 0.46, size * 0.31, size * 0.025, size * 0.032, 0, 0, Math.PI * 2);
  ctx.ellipse(size * 0.55, size * 0.31, size * 0.025, size * 0.032, 0, 0, Math.PI * 2);
  ctx.fill();
  if (semantic.archer) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = size * 0.018;
    ctx.beginPath();
    ctx.arc(size * 0.72, size * 0.5, size * 0.17, -1.2, 1.2);
    ctx.stroke();
  }
  if (semantic.knight || semantic.mage || semantic.staff) {
    ctx.strokeStyle = palette[3];
    ctx.lineWidth = size * 0.027;
    ctx.beginPath();
    ctx.moveTo(size * 0.68, size * 0.25);
    ctx.quadraticCurveTo(size * 0.78, size * 0.45, size * 0.69, size * 0.74);
    ctx.stroke();
  }
  ctx.restore();
  drawVectorEffects(ctx, frame, opt, size);
}

function drawVectorItem(ctx, frame, opt, size) {
  const { palette, semantic } = opt;
  const bob = Math.sin(frame * 1.2) * size * 0.018;
  const outline = palette[0];
  ctx.save();
  ctx.translate(0, bob);
  if (semantic.chest) {
    const lid = roundedRectPath(size * 0.24, size * 0.28, size * 0.52, size * 0.22, size * 0.06);
    drawVectorShape(ctx, lid, palette[2], outline, size * 0.017);
    const box = roundedRectPath(size * 0.21, size * 0.45, size * 0.58, size * 0.3, size * 0.04);
    drawVectorShape(ctx, box, palette[1], outline, size * 0.017);
    ctx.fillStyle = palette[4];
    ctx.fillRect(size * 0.47, size * 0.43, size * 0.06, size * 0.22);
  } else {
    const gem = new Path2D();
    gem.moveTo(size * 0.5, size * 0.17);
    gem.lineTo(size * 0.73, size * 0.36);
    gem.quadraticCurveTo(size * 0.67, size * 0.7, size * 0.5, size * 0.83);
    gem.quadraticCurveTo(size * 0.33, size * 0.7, size * 0.27, size * 0.36);
    gem.closePath();
    drawVectorShape(ctx, gem, makeGradient(ctx, size * 0.45, size * 0.35, size * 0.28, [[0, palette[4]], [0.35, palette[2]], [1, palette[1]]]), outline, size * 0.017);
  }
  ctx.restore();
  drawVectorEffects(ctx, frame, opt, size);
}

function drawVectorTile(ctx, frame, opt, size) {
  const { palette, rand } = opt;
  const grd = ctx.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, palette[2]);
  grd.addColorStop(0.5, palette[1]);
  grd.addColorStop(1, palette[0]);
  ctx.fillStyle = grd;
  ctx.fillRect(size * 0.12, size * 0.18, size * 0.76, size * 0.64);
  ctx.strokeStyle = palette[0];
  ctx.lineWidth = size * 0.025;
  ctx.strokeRect(size * 0.12, size * 0.18, size * 0.76, size * 0.64);
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 22; i += 1) {
    ctx.fillStyle = i % 2 ? palette[4] : palette[3];
    ctx.beginPath();
    ctx.ellipse(size * (0.17 + rand() * 0.66), size * (0.24 + rand() * 0.52), size * (0.015 + rand() * 0.035), size * 0.012, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawVectorIcon(ctx, frame, opt, size) {
  const { palette, semantic } = opt;
  const pulse = 1 + Math.sin(frame * 1.4) * 0.05;
  ctx.save();
  ctx.translate(size * 0.5, size * 0.5);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = makeGradient(ctx, 0, 0, size * 0.34, [[0, palette[4]], [0.35, palette[2]], [1, palette[1]]]);
  ctx.strokeStyle = palette[0];
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.31, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = semantic.thunder ? "#facc15" : semantic.fire ? "#fb923c" : semantic.ice ? "#bae6fd" : palette[4];
  ctx.lineWidth = size * 0.05;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-size * 0.12, -size * 0.08);
  ctx.quadraticCurveTo(0, -size * 0.25, size * 0.13, -size * 0.06);
  ctx.quadraticCurveTo(size * 0.02, size * 0.08, size * 0.1, size * 0.2);
  ctx.stroke();
  ctx.restore();
}

function drawVectorEffects(ctx, frame, opt, size) {
  const { semantic, palette, rand } = opt;
  let color = null;
  if (semantic.fire) color = "#fb923c";
  if (semantic.ice) color = "#bae6fd";
  if (semantic.thunder) color = "#facc15";
  if (semantic.dark || semantic.purple) color = "#a855f7";
  if (!color) return;
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = color;
  for (let i = 0; i < 18; i += 1) {
    const angle = rand() * Math.PI * 2 + frame * 0.1;
    const radius = size * (0.2 + rand() * 0.25);
    ctx.beginPath();
    ctx.arc(size * 0.5 + Math.cos(angle) * radius, size * 0.52 + Math.sin(angle) * radius, size * (0.008 + rand() * 0.012), 0, Math.PI * 2);
    ctx.fillStyle = rand() > 0.45 ? color : palette[4];
    ctx.fill();
  }
  ctx.restore();
}

function drawRefinedPixelFrame(ctx, frame, opt, type) {
  if (type === "character") {
    drawRefinedPixelCharacter(ctx, frame, opt);
    return true;
  }
  if (type === "item") {
    drawRefinedPixelItem(ctx, frame, opt);
    return true;
  }
  if (type === "tile") {
    drawRefinedPixelTile(ctx, frame, opt);
    return true;
  }
  if (type === "icon") {
    drawRefinedPixelIcon(ctx, frame, opt);
    return true;
  }
  return false;
}

function drawRefinedPixelCharacter(ctx, frame, opt) {
  const unit = opt.unit;
  const { palette, semantic, rand } = opt;
  const outline = palette[0];
  const body = palette[1];
  const mid = palette[2];
  const accent = palette[3];
  const light = palette[4];
  const bob = Math.sin(frame * 1.35) * 0.8;
  const wing = Math.sin(frame * 1.4) * 1.6;

  if (semantic.owl) {
    rect(ctx, 13, 14 + bob, 22, 24, outline, unit);
    rect(ctx, 15, 13 + bob, 18, 25, body, unit);
    rect(ctx, 11, 18 + bob + wing, 7, 15, outline, unit);
    rect(ctx, 30, 18 + bob - wing, 7, 15, outline, unit);
    rect(ctx, 12, 19 + bob + wing, 6, 13, mid, unit);
    rect(ctx, 30, 19 + bob - wing, 6, 13, mid, unit);
    rect(ctx, 14, 9 + bob, 7, 8, outline, unit);
    rect(ctx, 27, 9 + bob, 7, 8, outline, unit);
    rect(ctx, 16, 11 + bob, 5, 6, body, unit);
    rect(ctx, 27, 11 + bob, 5, 6, body, unit);
    rect(ctx, 16, 18 + bob, 7, 7, light, unit);
    rect(ctx, 25, 18 + bob, 7, 7, light, unit);
    rect(ctx, 18, 20 + bob, 3, 3, outline, unit);
    rect(ctx, 27, 20 + bob, 3, 3, outline, unit);
    rect(ctx, 21, 25 + bob, 6, 4, accent, unit);
    rect(ctx, 22, 29 + bob, 4, 3, "#f7b955", unit);
    rect(ctx, 18, 33 + bob, 12, 3, mid, unit);
    rect(ctx, 17, 39 + bob, 4, 3, accent, unit);
    rect(ctx, 27, 39 + bob, 4, 3, accent, unit);
  } else if (semantic.cat) {
    rect(ctx, 14, 13 + bob, 20, 23, outline, unit);
    rect(ctx, 16, 14 + bob, 16, 21, body, unit);
    rect(ctx, 14, 8 + bob, 7, 8, outline, unit);
    rect(ctx, 27, 8 + bob, 7, 8, outline, unit);
    rect(ctx, 16, 10 + bob, 4, 5, mid, unit);
    rect(ctx, 28, 10 + bob, 4, 5, mid, unit);
    rect(ctx, 18, 20 + bob, 4, 3, light, unit);
    rect(ctx, 26, 20 + bob, 4, 3, light, unit);
    rect(ctx, 20, 24 + bob, 8, 3, accent, unit);
    rect(ctx, 9, 28 + bob, 6, 4, outline, unit);
    rect(ctx, 7, 24 + bob + Math.sin(frame) * 2, 4, 10, mid, unit);
    rect(ctx, 17, 35 + bob, 5, 6, outline, unit);
    rect(ctx, 26, 35 + bob, 5, 6, outline, unit);
  } else if (semantic.slime) {
    rect(ctx, 12, 24 + bob, 24, 12, outline, unit);
    rect(ctx, 14, 18 + bob, 20, 17, body, unit);
    rect(ctx, 18, 16 + bob, 12, 5, mid, unit);
    rect(ctx, 18, 25 + bob, 4, 3, light, unit);
    rect(ctx, 27, 25 + bob, 4, 3, outline, unit);
    rect(ctx, 19, 32 + bob, 10, 2, accent, unit);
    rect(ctx, 11, 36 + bob, 26, 3, accent, unit);
  } else {
    rect(ctx, 16, 7 + bob, 16, 5, outline, unit);
    rect(ctx, 14, 12 + bob, 20, 13, outline, unit);
    rect(ctx, 16, 13 + bob, 16, 11, body, unit);
    rect(ctx, 18, 16 + bob, 4, 4, light, unit);
    rect(ctx, 26, 16 + bob, 4, 4, outline, unit);
    rect(ctx, 20, 22 + bob, 8, 2, accent, unit);
    rect(ctx, 13, 25 + bob, 22, 15, outline, unit);
    rect(ctx, 15, 26 + bob, 18, 13, body, unit);
    rect(ctx, 18, 27 + bob, 12, 4, mid, unit);
    rect(ctx, 9, 27 + bob, 7, 12, outline, unit);
    rect(ctx, 32, 27 + bob, 7, 12, outline, unit);
    rect(ctx, 11, 28 + bob, 5, 10, mid, unit);
    rect(ctx, 32, 28 + bob, 5, 10, mid, unit);
    rect(ctx, 16, 40 + bob, 6, 6, outline, unit);
    rect(ctx, 26, 40 + bob, 6, 6, outline, unit);
  }

  if (semantic.archer) {
    rect(ctx, 37, 13 + bob, 2, 25, outline, unit);
    rect(ctx, 38, 14 + bob, 2, 23, mid, unit);
    rect(ctx, 26, 25 + bob, 13, 2, accent, unit);
  }
  if (semantic.mage || semantic.staff) {
    rect(ctx, 39, 9 + bob, 3, 32, outline, unit);
    rect(ctx, 37, 7 + bob, 7, 6, light, unit);
    rect(ctx, 16, 5 + bob, 16, 5, accent, unit);
  }
  if (semantic.knight || semantic.mech) {
    rect(ctx, 13, 12 + bob, 22, 3, light, unit);
    rect(ctx, 17, 26 + bob, 14, 3, accent, unit);
  }
  if (semantic.plant) {
    rect(ctx, 20, 4 + bob, 8, 6, "#65a30d", unit);
    rect(ctx, 16, 8 + bob, 16, 5, "#bef264", unit);
  }
  drawElementAura(ctx, frame, { ...opt, unit }, 8, 7, 32, 34);
  for (let i = 0; i < Math.min(18, 6 + opt.detail * 2); i += 1) {
    rect(ctx, 11 + rand() * 26, 8 + rand() * 32, 1, 1, rand() > 0.5 ? light : accent, unit);
  }
}

function drawRefinedPixelItem(ctx, frame, opt) {
  const { unit, palette, semantic, rand } = opt;
  const pulse = Math.sin(frame * 1.2) * 0.9;
  const outline = palette[0];
  const body = palette[1];
  const mid = palette[2];
  const accent = palette[3];
  const light = palette[4];

  if (semantic.chest) {
    rect(ctx, 8, 19 + pulse, 32, 6, outline, unit);
    rect(ctx, 10, 14 + pulse, 28, 8, mid, unit);
    rect(ctx, 13, 11 + pulse, 22, 5, light, unit);
    rect(ctx, 8, 24 + pulse, 32, 15, outline, unit);
    rect(ctx, 10, 25 + pulse, 28, 12, body, unit);
    rect(ctx, 10, 25 + pulse, 28, 3, accent, unit);
    rect(ctx, 22, 23 + pulse, 5, 15, outline, unit);
    rect(ctx, 23, 27 + pulse, 3, 5, light, unit);
  } else {
    rect(ctx, 15, 14 + pulse, 18, 20, outline, unit);
    rect(ctx, 17, 12 + pulse, 14, 21, body, unit);
    rect(ctx, 19, 9 + pulse, 10, 6, mid, unit);
    rect(ctx, 20, 18 + pulse, 8, 8, accent, unit);
    rect(ctx, 22, 20 + pulse, 4, 3, light, unit);
  }

  if (semantic.staff) {
    rect(ctx, 23, 5 + pulse, 3, 36, outline, unit);
    rect(ctx, 20, 4 + pulse, 9, 8, light, unit);
  }
  if (semantic.shield) {
    rect(ctx, 13, 10 + pulse, 22, 27, outline, unit);
    rect(ctx, 16, 13 + pulse, 16, 20, mid, unit);
    rect(ctx, 20, 17 + pulse, 8, 10, light, unit);
  }
  drawElementAura(ctx, frame, opt, 8, 7, 32, 32);
  for (let i = 0; i < 10 + opt.detail; i += 1) {
    rect(ctx, 8 + rand() * 32, 7 + rand() * 32, 1, 1, rand() > 0.5 ? light : accent, unit);
  }
}

function drawRefinedPixelTile(ctx, frame, opt) {
  const { unit, palette, rand, detail } = opt;
  rect(ctx, 0, 0, 48, 48, palette[0], unit);
  rect(ctx, 0, 0, 48, 14, palette[2], unit);
  rect(ctx, 0, 14, 48, 25, palette[1], unit);
  rect(ctx, 0, 39, 48, 9, palette[0], unit);
  for (let i = 0; i < 42 + detail * 3; i += 1) {
    rect(ctx, Math.floor(rand() * 48), Math.floor(rand() * 48), 1 + Math.floor(rand() * 4), 1, palette[i % palette.length], unit);
  }
  rect(ctx, (frame * 4) % 44, 8, 4, 1, palette[4], unit);
  rect(ctx, 7, 14, 34, 2, palette[4], unit);
}

function drawRefinedPixelIcon(ctx, frame, opt) {
  const { unit, palette, semantic } = opt;
  const pulse = Math.sin(frame * 1.2) * 1.2;
  rect(ctx, 9, 9, 30, 30, palette[0], unit);
  rect(ctx, 11, 11, 26, 26, palette[1], unit);
  rect(ctx, 13, 13, 22, 22, palette[2], unit);
  if (semantic.thunder) {
    rect(ctx, 24, 12 + pulse, 6, 13, palette[4], unit);
    rect(ctx, 18, 24 + pulse, 12, 4, palette[4], unit);
    rect(ctx, 18, 28 + pulse, 6, 12, palette[3], unit);
  } else if (semantic.fire) {
    rect(ctx, 20, 12 + pulse, 8, 22, palette[3], unit);
    rect(ctx, 23, 17 + pulse, 4, 14, palette[4], unit);
  } else if (semantic.ice) {
    rect(ctx, 23, 10, 3, 28, palette[4], unit);
    rect(ctx, 10, 23, 28, 3, palette[4], unit);
    rect(ctx, 16, 16, 16, 16, palette[2], unit);
  } else {
    rect(ctx, 21, 13 + pulse, 7, 22, palette[4], unit);
    rect(ctx, 13, 21 + pulse, 22, 7, palette[4], unit);
  }
}

function drawCharacter(ctx, frame, opt) {
  if (opt.semantic.dark && opt.semantic.knight) {
    drawDarkKnight(ctx, frame, opt);
    return;
  }

  const { unit, cells, rand, palette, semantic } = opt;
  const bob = Math.sin(frame * 1.5) * 0.8;
  const body = palette[1];
  const trim = palette[2];
  const accent = palette[3];
  const light = palette[4];
  const shadow = palette[0];

  if (semantic.slime) {
    rect(ctx, 8, 16 + bob, 16, 11, body, unit);
    rect(ctx, 10, 13 + bob, 12, 5, body, unit);
    rect(ctx, 12, 18 + bob, 3, 2, light, unit);
    rect(ctx, 18, 18 + bob, 3, 2, shadow, unit);
    rect(ctx, 7, 25 + bob, 18, 3, accent, unit);
  } else {
    const pixels = [
      [14, 7 + bob, 4, 2, light],
      [12, 9 + bob, 8, 6, body],
      [13, 11 + bob, 2, 2, light],
      [17, 11 + bob, 2, 2, shadow],
      [11, 15 + bob, 10, 10, body],
      [10, 17 + bob, 3, 6, trim],
      [19, 17 + bob, 3, 6, trim],
      [13, 25 + bob, 3, 5, shadow],
    ];
    mirrorPixels(ctx, pixels, unit, cells);
    rect(ctx, 14 + Math.sin(frame) * 2, 17 + bob, 4, 2, accent, unit);
    rect(ctx, 18 + Math.cos(frame) * 2, 28 - bob, 5, 2, accent, unit);
  }

  if (semantic.owl) {
    rect(ctx, 10, 6 + bob, 4, 4, trim, unit);
    rect(ctx, 18, 6 + bob, 4, 4, trim, unit);
    rect(ctx, 12, 10 + bob, 3, 3, light, unit);
    rect(ctx, 17, 10 + bob, 3, 3, light, unit);
    rect(ctx, 15, 13 + bob, 2, 2, accent, unit);
  }

  if (semantic.cat) {
    rect(ctx, 11, 6 + bob, 3, 4, trim, unit);
    rect(ctx, 18, 6 + bob, 3, 4, trim, unit);
    rect(ctx, 8, 23 + bob, 2, 6, accent, unit);
  }

  if (semantic.octopus) {
    for (let i = 0; i < 5; i += 1) {
      rect(ctx, 8 + i * 4, 24 + Math.sin(frame + i) * 2, 2, 6, i % 2 ? trim : body, unit);
    }
  }

  if (semantic.mech) {
    rect(ctx, 9, 14 + bob, 14, 2, light, unit);
    rect(ctx, 8, 18 + bob, 2, 7, trim, unit);
    rect(ctx, 22, 18 + bob, 2, 7, trim, unit);
    rect(ctx, 15, 8 + bob, 2, 2, accent, unit);
  }

  if (semantic.mage || semantic.staff) {
    rect(ctx, 7, 6 + bob, 18, 3, accent, unit);
    rect(ctx, 11, 3 + bob, 10, 5, trim, unit);
    rect(ctx, 25, 8 + bob, 2, 21, trim, unit);
    rect(ctx, 23, 6 + bob, 6, 4, light, unit);
  }

  if (semantic.archer) {
    rect(ctx, 24, 10 + bob, 2, 17, trim, unit);
    rect(ctx, 23, 10 + bob, 1, 4, light, unit);
    rect(ctx, 23, 23 + bob, 1, 4, light, unit);
    rect(ctx, 14, 18 + bob, 11, 1, accent, unit);
  }

  if (semantic.shield) {
    rect(ctx, 5, 16 + bob, 5, 9, trim, unit);
    rect(ctx, 6, 18 + bob, 3, 5, light, unit);
  }

  if (semantic.merchant) {
    rect(ctx, 5, 20 + bob, 5, 5, accent, unit);
    rect(ctx, 22, 20 + bob, 5, 5, accent, unit);
  }

  drawElementAura(ctx, frame, opt, 6, 5, 24, 24);
  for (let i = 0; i < 6 + opt.detail; i += 1) {
    const x = 6 + rand() * 20;
    const y = 6 + rand() * 24;
    rect(ctx, x, y, 1, 1, rand() > 0.5 ? trim : light, unit);
  }
}

function drawElementAura(ctx, frame, opt, x, y, w, h) {
  const { unit, rand, palette, semantic } = opt;
  let color = null;
  if (semantic.fire) color = "#fb923c";
  if (semantic.ice) color = "#bae6fd";
  if (semantic.thunder) color = "#facc15";
  if (semantic.dark) color = "#a855f7";
  if (!color) return;

  ctx.globalAlpha = 0.42;
  for (let i = 0; i < 10 + opt.detail; i += 1) {
    const px = x + rand() * w + Math.sin(frame + i) * 1.2;
    const py = y + rand() * h + Math.cos(frame + i) * 1.2;
    rect(ctx, px, py, 1 + rand() * 1.8, 1 + rand() * 1.8, rand() > 0.5 ? color : palette[3], unit);
  }
  ctx.globalAlpha = 1;
}

function drawDarkKnight(ctx, frame, opt) {
  const { unit, palette, rand, detail } = opt;
  const bob = Math.sin(frame * 1.4) * 0.7;
  const outline = palette[0];
  const armor = palette[1];
  const purple = palette[2];
  const glow = palette[3];
  const highlight = palette[4];
  const swordTilt = Math.sin(frame * 1.1) * 1.4;

  rect(ctx, 6, 14 + bob, 8, 16, "#12091f", unit);
  rect(ctx, 4, 18 + bob, 6, 10, "#0b0712", unit);
  rect(ctx, 8, 9 + bob, 16, 7, outline, unit);
  rect(ctx, 11, 6 + bob, 10, 5, armor, unit);
  rect(ctx, 7, 7 + bob, 4, 3, purple, unit);
  rect(ctx, 21, 7 + bob, 4, 3, purple, unit);
  rect(ctx, 13, 10 + bob, 2, 1, glow, unit);
  rect(ctx, 18, 10 + bob, 2, 1, glow, unit);
  rect(ctx, 15, 12 + bob, 3, 1, highlight, unit);

  rect(ctx, 7, 15 + bob, 18, 13, outline, unit);
  rect(ctx, 9, 15 + bob, 14, 12, armor, unit);
  rect(ctx, 11, 16 + bob, 10, 10, "#2b1847", unit);
  rect(ctx, 14, 15 + bob, 4, 12, purple, unit);
  rect(ctx, 9, 14 + bob, 5, 3, purple, unit);
  rect(ctx, 19, 14 + bob, 5, 3, purple, unit);
  rect(ctx, 9, 27 + bob, 5, 4, outline, unit);
  rect(ctx, 18, 27 + bob, 5, 4, outline, unit);
  rect(ctx, 8, 31 + bob, 7, 2, purple, unit);
  rect(ctx, 17, 31 + bob, 7, 2, purple, unit);

  rect(ctx, 4, 16 + bob, 5, 11, outline, unit);
  rect(ctx, 23, 15 + bob, 3, 8, outline, unit);
  rect(ctx, 25 + swordTilt, 4 + bob, 3, 25, glow, unit);
  rect(ctx, 26 + swordTilt, 2 + bob, 1, 29, highlight, unit);
  rect(ctx, 24 + swordTilt, 7 + bob, 5, 3, purple, unit);
  rect(ctx, 23 + swordTilt, 18 + bob, 7, 2, purple, unit);

  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 12 + detail * 2; i += 1) {
    const x = 22 + rand() * 9 + swordTilt;
    const y = 1 + rand() * 29 + bob;
    rect(ctx, x, y, 1 + rand() * 2.2, 1 + rand() * 2.2, rand() > 0.4 ? glow : purple, unit);
  }
  ctx.globalAlpha = 1;
}

function drawItem(ctx, frame, opt) {
  if (opt.semantic.chest) {
    drawChest(ctx, frame, opt);
    return;
  }

  const { unit, rand, palette, detail } = opt;
  const pulse = Math.sin(frame * 1.3) * 1.2;
  rect(ctx, 10, 10 - pulse, 12, 12, palette[1], unit);
  rect(ctx, 12, 8 - pulse, 8, 4, palette[2], unit);
  rect(ctx, 9, 18 - pulse, 14, 5, palette[0], unit);
  rect(ctx, 13, 13 - pulse, 6, 5, palette[3], unit);
  rect(ctx, 15, 14 - pulse, 2, 2, palette[4], unit);
  if (opt.semantic.staff) {
    rect(ctx, 15, 5 - pulse, 2, 22, palette[2], unit);
    rect(ctx, 12, 4 - pulse, 8, 5, palette[4], unit);
  }
  if (opt.semantic.shield) {
    rect(ctx, 9, 8 - pulse, 14, 16, palette[2], unit);
    rect(ctx, 12, 11 - pulse, 8, 10, palette[4], unit);
  }
  if (opt.semantic.mech) {
    rect(ctx, 7, 8 - pulse, 18, 16, palette[1], unit);
    rect(ctx, 10, 11 - pulse, 5, 4, palette[4], unit);
    rect(ctx, 18, 11 - pulse, 4, 4, palette[3], unit);
  }
  drawElementAura(ctx, frame, opt, 5, 5, 22, 22);
  for (let i = 0; i < 10 + detail; i += 1) {
    rect(ctx, 4 + rand() * 24, 5 + rand() * 24, 1, 1, palette[2 + (i % 3)], unit);
  }
}

function drawChest(ctx, frame, opt) {
  const { unit, rand, palette, detail, semantic } = opt;
  const pulse = Math.sin(frame * 1.2) * 0.5;
  const outline = semantic.ice ? "#071827" : palette[0];
  const body = semantic.ice ? "#1d4ed8" : palette[1];
  const lid = semantic.ice ? "#60a5fa" : palette[2];
  const trim = semantic.ice ? "#bae6fd" : palette[3];
  const shine = semantic.ice ? "#f8fbff" : palette[4];

  rect(ctx, 6, 12 + pulse, 20, 4, outline, unit);
  rect(ctx, 7, 9 + pulse, 18, 5, lid, unit);
  rect(ctx, 9, 7 + pulse, 14, 3, trim, unit);
  rect(ctx, 6, 15 + pulse, 20, 12, outline, unit);
  rect(ctx, 8, 16 + pulse, 16, 9, body, unit);
  rect(ctx, 8, 16 + pulse, 16, 2, trim, unit);
  rect(ctx, 14, 15 + pulse, 4, 11, outline, unit);
  rect(ctx, 15, 18 + pulse, 2, 4, shine, unit);
  rect(ctx, 10, 20 + pulse, 3, 2, "#3b82f6", unit);
  rect(ctx, 19, 20 + pulse, 3, 2, "#3b82f6", unit);

  if (semantic.ice) {
    rect(ctx, 5, 10 + pulse, 2, 5, shine, unit);
    rect(ctx, 25, 10 + pulse, 2, 5, shine, unit);
    rect(ctx, 11, 5 + pulse, 2, 4, trim, unit);
    rect(ctx, 20, 5 + pulse, 2, 4, trim, unit);
  }

  ctx.globalAlpha = 0.45;
  for (let i = 0; i < 8 + detail; i += 1) {
    rect(ctx, 4 + rand() * 24, 4 + rand() * 24, 1 + rand() * 1.5, 1 + rand() * 1.5, rand() > 0.5 ? shine : trim, unit);
  }
  ctx.globalAlpha = 1;
}

function drawTile(ctx, frame, opt) {
  const { unit, rand, palette, detail } = opt;
  rect(ctx, 0, 0, 32, 32, palette[1], unit);
  rect(ctx, 0, 0, 32, 7, palette[2], unit);
  rect(ctx, 0, 25, 32, 7, palette[0], unit);
  for (let i = 0; i < 22 + detail * 2; i += 1) {
    const x = Math.floor(rand() * 32);
    const y = Math.floor(rand() * 32);
    rect(ctx, x, y, 1 + Math.floor(rand() * 3), 1, palette[i % palette.length], unit);
  }
  rect(ctx, (frame * 3) % 28, 3, 4, 1, palette[4], unit);
}

function drawIcon(ctx, frame, opt) {
  const { unit, palette, detail, semantic } = opt;
  const radius = 10 + Math.sin(frame) * 1.5;
  ctx.fillStyle = palette[0];
  ctx.beginPath();
  ctx.arc(16 * unit, 16 * unit, 13 * unit, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette[1];
  ctx.beginPath();
  ctx.arc(16 * unit, 16 * unit, radius * unit, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = palette[2];
  for (let i = 0; i < detail + 4; i += 1) {
    const angle = (Math.PI * 2 * i) / (detail + 4) + frame * 0.25;
    rect(ctx, 15 + Math.cos(angle) * 8, 15 + Math.sin(angle) * 8, 2, 2, palette[3], unit);
  }
  if (semantic.thunder) {
    rect(ctx, 16, 6, 4, 9, palette[4], unit);
    rect(ctx, 12, 14, 8, 3, palette[4], unit);
    rect(ctx, 12, 16, 4, 10, palette[3], unit);
  } else if (semantic.fire) {
    rect(ctx, 13, 7 + Math.sin(frame), 6, 16, palette[3], unit);
    rect(ctx, 15, 11, 3, 10, palette[4], unit);
  } else if (semantic.ice) {
    rect(ctx, 15, 6, 2, 20, palette[4], unit);
    rect(ctx, 8, 15, 18, 2, palette[4], unit);
    rect(ctx, 10, 10, 12, 12, palette[2], unit);
  } else {
    rect(ctx, 13, 9, 6, 14, palette[4], unit);
    rect(ctx, 9, 13, 14, 6, palette[4], unit);
  }
}

function colorDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function detectSubjectBox(image) {
  const maxProbe = 240;
  const scale = Math.min(maxProbe / image.width, maxProbe / image.height, 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const probe = document.createElement("canvas");
  probe.width = width;
  probe.height = height;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const edge = Math.max(4, Math.round(Math.min(width, height) * 0.08));
  const bg = [0, 0, 0];
  let bgCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= edge && x < width - edge && y >= edge && y < height - edge) continue;
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 20) continue;
      bg[0] += pixels[i];
      bg[1] += pixels[i + 1];
      bg[2] += pixels[i + 2];
      bgCount += 1;
    }
  }

  if (!bgCount) {
    return { x: 0, y: 0, width: image.width, height: image.height };
  }

  bg[0] /= bgCount;
  bg[1] /= bgCount;
  bg[2] /= bgCount;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxDist = Math.hypot(centerX, centerY);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 30) continue;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const dist = colorDistance([r, g, b], bg);
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const saturation = maxC - minC;
      const darkness = 255 - (r + g + b) / 3;
      const centerWeight = 1 - Math.hypot(x - centerX, y - centerY) / maxDist;
      const subjectLike = dist > 42 || saturation > 42 || darkness > 84;
      const nearCenter = centerWeight > 0.18;
      if (!subjectLike || !nearCenter) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }

  if (count < width * height * 0.015) {
    const cropWidth = width * 0.62;
    const cropHeight = height * 0.82;
    minX = (width - cropWidth) / 2;
    maxX = minX + cropWidth;
    minY = (height - cropHeight) / 2;
    maxY = minY + cropHeight;
  }

  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  const tooWide = boxWidth > width * 0.92 && boxHeight > height * 0.92;
  if (tooWide) {
    minX = width * 0.18;
    maxX = width * 0.82;
    minY = height * 0.06;
    maxY = height * 0.96;
  }

  const padX = (maxX - minX) * 0.16;
  const padY = (maxY - minY) * 0.12;
  const sx = Math.max(0, (minX - padX) / scale);
  const sy = Math.max(0, (minY - padY) / scale);
  const ex = Math.min(image.width, (maxX + padX) / scale);
  const ey = Math.min(image.height, (maxY + padY) / scale);

  return {
    x: sx,
    y: sy,
    width: Math.max(1, ex - sx),
    height: Math.max(1, ey - sy),
  };
}

function analyzeMotion(text) {
  const lower = text.toLowerCase();
  const has = (...words) => words.some((word) => lower.includes(word));
  return {
    jump: has("跳", "弹", "跃", "jump", "bounce"),
    run: has("跑", "奔", "冲刺", "run", "dash"),
    attack: has("攻击", "挥", "砍", "斩", "刺", "attack", "slash", "swing"),
    fly: has("飞", "漂浮", "悬浮", "float", "fly"),
    rotate: has("旋转", "翻滚", "转身", "rotate", "spin"),
    grow: has("变大", "放大", "膨胀", "grow", "bigger"),
    shrink: has("缩小", "收缩", "shrink", "smaller"),
    shake: has("抖", "震动", "受击", "shake", "hit"),
    ghost: has("残影", "分身", "影子", "ghost", "clone"),
    pixelate: has("像素", "pixel"),
    fire: has("火", "火焰", "燃烧", "fire", "flame"),
    ice: has("冰", "冰霜", "冻结", "ice", "frost"),
    thunder: has("雷", "电", "闪电", "thunder", "lightning"),
    glow: has("发光", "光环", "拖尾", "glow", "trail"),
  };
}

function drawUploadedFrame(target, frameIndex, size) {
  const ctx = target.getContext("2d");
  const image = state.uploadedImage;
  const subject = state.uploadedSubjectBox ?? { x: 0, y: 0, width: image.width, height: image.height };
  const frameCount = Math.max(1, Number(controls.frames.value));
  const progress = frameIndex / frameCount;
  const phase = progress * Math.PI * 2;
  const motion = analyzeMotion(`${controls.motionPrompt.value} ${controls.prompt.value}`);
  const semantic = analyzePrompt(`${controls.motionPrompt.value} ${controls.prompt.value}`);
  const palette = derivePalette(state.palette, semantic);
  const wave = Math.sin(phase);
  const hop = motion.jump ? -Math.abs(wave) * size * 0.18 : 0;
  const floatY = motion.fly ? Math.sin(phase + 0.8) * size * 0.08 : 0;
  const runX = motion.run ? (progress - 0.5) * size * 0.22 : 0;
  const shakeX = motion.shake ? Math.sin(phase * 4) * size * 0.035 : 0;
  const attackAngle = motion.attack ? Math.sin(phase) * 0.24 : 0;
  const spinAngle = motion.rotate ? phase : 0;
  const growScale = motion.grow ? 1 + Math.abs(wave) * 0.18 : 1;
  const shrinkScale = motion.shrink ? 1 - Math.abs(wave) * 0.16 : 1;
  const breathe = 1 + Math.sin(phase) * 0.025;
  const scale = growScale * shrinkScale * breathe;
  const drawSize = size * 0.9;
  const ratio = Math.min(drawSize / subject.width, drawSize / subject.height);
  const width = subject.width * ratio;
  const height = subject.height * ratio;
  const x = size / 2 + runX + shakeX;
  const y = size / 2 + hop + floatY;

  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = !motion.pixelate;
  ctx.imageSmoothingQuality = "high";

  if (motion.ghost || motion.run || motion.glow) {
    for (let i = 1; i <= 3; i += 1) {
      ctx.save();
      ctx.globalAlpha = 0.1 + i * 0.05;
      ctx.translate(x - i * size * 0.055, y + i * 1.5);
      ctx.rotate(attackAngle + spinAngle - i * 0.05);
      ctx.scale(scale, scale);
      ctx.filter = "saturate(1.25)";
      ctx.drawImage(image, subject.x, subject.y, subject.width, subject.height, -width / 2, -height / 2, width, height);
      ctx.restore();
    }
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(attackAngle + spinAngle);
  ctx.scale(scale, scale);
  ctx.shadowColor = motion.thunder ? "#7dd3fc" : motion.fire ? "#fb923c" : motion.ice ? "#bae6fd" : palette[3];
  ctx.shadowBlur = motion.glow || motion.fire || motion.ice || motion.thunder ? size * 0.08 : 0;

  if (motion.pixelate) {
    const temp = document.createElement("canvas");
    const small = Math.max(64, Math.min(128, Math.floor(size / 3)));
    temp.width = small;
    temp.height = small;
    const tctx = temp.getContext("2d");
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(image, subject.x, subject.y, subject.width, subject.height, (small - width / (size / small)) / 2, (small - height / (size / small)) / 2, width / (size / small), height / (size / small));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(temp, -width / 2, -height / 2, width, height);
  } else {
    ctx.drawImage(image, subject.x, subject.y, subject.width, subject.height, -width / 2, -height / 2, width, height);
  }
  ctx.restore();

  drawMotionEffects(ctx, frameIndex, size, motion, palette, x, y, width, height);
}

function drawMotionEffects(ctx, frameIndex, size, motion, palette, x, y, width, height) {
  const frameCount = Math.max(1, Number(controls.frames.value));
  const progress = frameIndex / frameCount;
  const phase = progress * Math.PI * 2;
  const accent = motion.thunder ? "#facc15" : motion.fire ? "#fb923c" : motion.ice ? "#bae6fd" : palette[3];
  const light = motion.thunder ? "#7dd3fc" : motion.fire ? "#fff7ed" : motion.ice ? "#f8fbff" : palette[4];

  if (motion.run || motion.jump) {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = palette[0];
    for (let i = 0; i < 5; i += 1) {
      const dustX = x - width * 0.35 - i * size * 0.035;
      const dustY = y + height * 0.34 + Math.sin(phase + i) * 3;
      ctx.fillRect(dustX, dustY, size * 0.035, size * 0.012);
    }
    ctx.globalAlpha = 1;
  }

  if (motion.attack) {
    ctx.save();
    ctx.translate(x + width * 0.22, y - height * 0.12);
    ctx.rotate(Math.sin(phase) * 0.28);
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(3, size * 0.035);
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.24, -0.8, 0.95);
    ctx.stroke();
    ctx.strokeStyle = light;
    ctx.lineWidth = Math.max(1, size * 0.012);
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.29, -0.55, 0.75);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  if (motion.fire || motion.ice || motion.thunder || motion.glow) {
    const rand = rng(state.seed + frameIndex * 193);
    ctx.globalAlpha = 0.68;
    for (let i = 0; i < 16; i += 1) {
      const px = x - width * 0.42 + rand() * width * 0.84 + Math.sin(phase + i) * 5;
      const py = y - height * 0.42 + rand() * height * 0.84 + Math.cos(phase + i) * 5;
      ctx.fillStyle = rand() > 0.45 ? accent : light;
      ctx.fillRect(px, py, 2 + rand() * 4, 2 + rand() * 4);
    }
    ctx.globalAlpha = 1;
  }
}

function drawFrame(target, frameIndex, size) {
  const ctx = target.getContext("2d");
  const promptHash = hashText(`${controls.prompt.value}|${controls.assetType.value}|${controls.stylePreset.value}`);
  const seed = promptHash + state.seed + frameIndex * 97;
  const rand = rng(seed);
  const semantic = analyzePrompt(controls.prompt.value);
  const palette = derivePalette(state.palette, semantic);
  const cells = 48;
  const unit = size / cells;
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = controls.stylePreset.value !== "pixel";

  const opt = {
    unit,
    cells,
    rand,
    palette,
    detail: Number(controls.detail.value),
    consistency: Number(controls.consistency.value),
    semantic,
  };

  const type = controls.assetType.value;
  const usePixelRenderer = controls.stylePreset.value === "pixel";
  const rendered = usePixelRenderer
    ? drawRefinedPixelFrame(ctx, frameIndex, opt, type)
    : drawVectorFrame(ctx, frameIndex, opt, type, size);
  if (!rendered && type === "character") drawCharacter(ctx, frameIndex, opt);
  if (!rendered && type === "item") drawItem(ctx, frameIndex, opt);
  if (!rendered && type === "tile") drawTile(ctx, frameIndex, opt);
  if (!rendered && type === "icon") drawIcon(ctx, frameIndex, opt);

  if (controls.stylePreset.value === "handpaint") {
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 16; i += 1) {
      ctx.fillRect(rand() * size, rand() * size, rand() * 20, 2);
    }
    ctx.globalAlpha = 1;
  }

  if (controls.stylePreset.value === "neon") {
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.42;
    ctx.filter = "blur(2px)";
    ctx.drawImage(target, 0, 0);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  if (controls.stylePreset.value === "ink") {
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#f7f1df";
    for (let i = 0; i < 28; i += 1) {
      ctx.fillRect(rand() * size, rand() * size, size * 0.45, 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

function drawAssetToCanvas(canvas, item, index) {
  const originalType = controls.assetType.value;
  const originalPrompt = controls.prompt.value;
  controls.assetType.value = item.type;
  controls.prompt.value = `${originalPrompt} ${item.title}`;
  canvas.width = 96;
  canvas.height = 96;
  drawFrame(canvas, index, 96);
  controls.assetType.value = originalType;
  controls.prompt.value = originalPrompt;
}

function drawGrid(ctx, size, step) {
  if (!state.grid) return;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= size; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = 0; y <= size; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
}

function generate() {
  const size = Number(controls.size.value);
  const frameCount = Number(controls.frames.value);
  state.frames = [];
  preview.width = 768;
  preview.height = 768;
  pctx.clearRect(0, 0, preview.width, preview.height);

  for (let i = 0; i < frameCount; i += 1) {
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    if (state.useUploadedImage && state.uploadedImage) {
      drawUploadedFrame(off, i, size);
    } else {
      drawFrame(off, i, size);
    }
    state.frames.push(off);
  }

  state.activeFrame = 0;
  renderPreview();
  drawSheet();
  renderManifest();
  updateSummary();
  recordGeneration();
}

function renderPreview() {
  if (!state.frames.length) return;
  const previewSize = preview.width;
  pctx.clearRect(0, 0, previewSize, previewSize);
  const uploadedPixelated = state.useUploadedImage && analyzeMotion(`${controls.motionPrompt.value} ${controls.prompt.value}`).pixelate;
  const crispPreview = uploadedPixelated || (!state.useUploadedImage && controls.stylePreset.value === "pixel");
  preview.classList.toggle("crisp-preview", crispPreview);
  preview.classList.toggle("smooth-preview", !crispPreview);
  pctx.imageSmoothingEnabled = !crispPreview;
  pctx.imageSmoothingQuality = "high";
  const source = state.frames[state.activeFrame];
  const maxDraw = previewSize * 0.86;
  const drawSize = state.useUploadedImage ? Math.min(maxDraw, Math.max(source.width, 512)) : maxDraw;
  const x = (previewSize - drawSize) / 2;
  const y = (previewSize - drawSize) / 2;
  pctx.drawImage(source, x, y, drawSize, drawSize);
  drawGrid(pctx, previewSize, previewSize / 16);
}

function animate(timestamp) {
  if (timestamp - state.lastTick > 220) {
    state.activeFrame = (state.activeFrame + 1) % Math.max(1, state.frames.length);
    state.lastTick = timestamp;
    renderPreview();
  }
  requestAnimationFrame(animate);
}

function drawSheet() {
  const size = Number(controls.size.value);
  const frameCount = state.frames.length;
  sheet.width = size * frameCount;
  sheet.height = size;
  sctx.clearRect(0, 0, sheet.width, sheet.height);
  state.frames.forEach((frame, index) => {
    sctx.drawImage(frame, index * size, 0);
  });
}

function renderManifest() {
  const manifest = [
    ["格式", "PNG 透明背景 + JSON 元数据"],
    ["尺寸", `${controls.size.value}px / frame`],
    ["命名", "spriteforge_asset_{seed}.png"],
    ["来源", state.useUploadedImage ? `上传图：${state.uploadedName}` : "文本程序化生成"],
    ["适配", "Unity Sprite Editor, Godot AnimatedSprite2D"],
  ];
  $("#manifest").innerHTML = manifest.map(([key, value]) => `<div><strong>${key}</strong><br>${value}</div>`).join("");
}

function renderAssetPack() {
  const pack = $("#assetPack");
  pack.innerHTML = "";
  packItems.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "pack-card";
    const canvas = document.createElement("canvas");
    const title = document.createElement("div");
    const note = document.createElement("p");
    title.className = "pack-title";
    title.innerHTML = `<span>${item.title}</span><span>${item.type}</span>`;
    note.textContent = item.note;
    card.append(canvas, title, note);
    pack.appendChild(card);
    drawAssetToCanvas(canvas, item, index);
  });
}

function updateSummary() {
  const typeName = controls.assetType.options[controls.assetType.selectedIndex].text;
  const styleName = controls.stylePreset.options[controls.stylePreset.selectedIndex].text;
  const source = state.useUploadedImage ? "上传图片动作化" : typeName;
  $("#summary").textContent = `${source} · ${styleName} · ${controls.frames.value} 帧 · ${controls.size.value}px`;
  $("#frameMetric").textContent = controls.frames.value;
  $("#seedLabel").textContent = `Seed ${state.seed}`;
  $("#sourceMetric").textContent = state.useUploadedImage ? "图片" : "文本";
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function downloadJson() {
  const payload = {
    name: `spriteforge_${state.seed}`,
    prompt: controls.prompt.value,
    assetType: controls.assetType.value,
    style: controls.stylePreset.value,
    frameSize: Number(controls.size.value),
    frames: Number(controls.frames.value),
    palette: state.palette,
    author: state.user ?? "guest",
    source: state.useUploadedImage ? "uploaded-image" : "procedural-text",
    uploadedImageName: state.uploadedName,
    motionPrompt: controls.motionPrompt.value.trim(),
    stylePack: packItems.map((item) => ({
      name: item.title,
      type: item.type,
      note: item.note,
    })),
    recommendedImport: {
      unity: "Sprite Mode: Multiple, Filter Mode: Point, Pixels Per Unit: 32",
      godot: "AnimatedSprite2D + SpriteFrames, Filter: Nearest",
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.download = `spriteforge_${state.seed}.json`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

$("#loginTab").addEventListener("click", () => setAuthMode("login"));
$("#registerTab").addEventListener("click", () => setAuthMode("register"));
$("#authSubmit").addEventListener("click", submitAuth);
$("#logout").addEventListener("click", logout);
$("#authPassword").addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitAuth();
});

$("#imageUpload").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const image = new Image();
    image.addEventListener("load", () => {
      state.uploadedImage = image;
      state.uploadedName = file.name;
      state.uploadedSubjectBox = detectSubjectBox(image);
      state.useUploadedImage = false;
      if (Number(controls.size.value) < 512) {
        controls.size.value = "512";
      }
      $("#imageStatus").textContent = "已识别主体";
      if (!controls.motionPrompt.value.trim()) {
        controls.motionPrompt.value = "高清保真，轻微呼吸，向右奔跑，带发光拖尾";
      }
      updateSummary();
    });
    image.src = reader.result;
  });
  reader.readAsDataURL(file);
});

$("#applyImageMotion").addEventListener("click", () => {
  if (!state.uploadedImage) {
    $("#imageStatus").textContent = "请先上传";
    return;
  }
  state.useUploadedImage = true;
  state.seed = hashText(`${state.uploadedName}|${controls.motionPrompt.value}|${Date.now()}`) % 10000000;
  $("#imageStatus").textContent = "动作化中";
  generate();
  $("#imageStatus").textContent = "已应用";
});

$("#clearImageMotion").addEventListener("click", () => {
  state.useUploadedImage = false;
  $("#imageStatus").textContent = state.uploadedImage ? "已上传" : "未上传";
  generate();
});

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    controls.prompt.value = button.dataset.example;
    generate();
  });
});

Object.values(controls).forEach((control) => {
  control.addEventListener("input", () => {
    generate();
    renderAssetPack();
  });
});

$("#randomPalette").addEventListener("click", () => {
  state.palette = palettes[Math.floor(Math.random() * palettes.length)].slice();
  state.seed = Math.floor(Math.random() * 9000000) + 1000000;
  updatePalette();
  generate();
  renderAssetPack();
});

$("#generate").addEventListener("click", () => {
  state.seed = hashText(`${controls.prompt.value}${Date.now()}`) % 10000000;
  generate();
  renderAssetPack();
});

$("#generatePack").addEventListener("click", () => {
  state.seed = hashText(`pack|${controls.prompt.value}|${Date.now()}`) % 10000000;
  generate();
  renderAssetPack();
});

$("#toggleGrid").addEventListener("click", () => {
  state.grid = !state.grid;
  generate();
});

$("#downloadPng").addEventListener("click", () => downloadCanvas(state.frames[0], `spriteforge_${state.seed}_preview.png`));
$("#downloadSheet").addEventListener("click", () => downloadCanvas(sheet, `spriteforge_${state.seed}_sheet.png`));
$("#downloadMeta").addEventListener("click", downloadJson);

const session = readStorage(storageKeys.session, null);
if (session?.user) {
  state.user = session.user;
}
setAuthMode("login");
renderAuth();
updatePalette();
generate();
renderAssetPack();
requestAnimationFrame(animate);
