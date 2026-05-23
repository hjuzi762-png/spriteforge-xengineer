const $ = (selector) => document.querySelector(selector);

const state = {
  palette: ["#101214", "#39d19a", "#f8d96a", "#ea6464", "#f4f7f4"],
  seed: 2451529,
  grid: true,
  frames: [],
  activeFrame: 0,
  lastTick: 0,
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

function drawFrame(target, frameIndex, size) {
  const ctx = target.getContext("2d");
  const promptHash = hashText(`${controls.prompt.value}|${controls.assetType.value}|${controls.stylePreset.value}`);
  const seed = promptHash + state.seed + frameIndex * 97;
  const rand = rng(seed);
  const semantic = analyzePrompt(controls.prompt.value);
  const palette = derivePalette(state.palette, semantic);
  const cells = 32;
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
  if (type === "character") drawCharacter(ctx, frameIndex, opt);
  if (type === "item") drawItem(ctx, frameIndex, opt);
  if (type === "tile") drawTile(ctx, frameIndex, opt);
  if (type === "icon") drawIcon(ctx, frameIndex, opt);

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
  preview.width = 512;
  preview.height = 512;
  pctx.clearRect(0, 0, 512, 512);

  for (let i = 0; i < frameCount; i += 1) {
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    drawFrame(off, i, size);
    state.frames.push(off);
  }

  state.activeFrame = 0;
  renderPreview();
  drawSheet();
  renderManifest();
  updateSummary();
}

function renderPreview() {
  if (!state.frames.length) return;
  pctx.clearRect(0, 0, 512, 512);
  pctx.imageSmoothingEnabled = controls.stylePreset.value !== "pixel";
  pctx.drawImage(state.frames[state.activeFrame], 64, 64, 384, 384);
  drawGrid(pctx, 512, 512 / 16);
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
  $("#summary").textContent = `${typeName} · ${styleName} · ${controls.frames.value} 帧 · ${controls.size.value}px`;
  $("#frameMetric").textContent = controls.frames.value;
  $("#seedLabel").textContent = `Seed ${state.seed}`;
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

updatePalette();
generate();
renderAssetPack();
requestAnimationFrame(animate);
