const sharp = require("sharp");
const fs = require("fs");

async function measure(buf, W, H) {
  let minY = H,
    maxY = 0,
    minX = W,
    maxX = 0,
    count = 0;
  for (let y = 400; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (buf[i + 3] < 40) continue;
      const L = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      if (L < 120) continue;
      count++;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  return { minX, maxX, minY, maxY, height: maxY - minY + 1, width: maxX - minX + 1, count };
}

async function render(base, W, H, size, tracking, y) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <text x="50%" y="${y}" text-anchor="middle" dominant-baseline="middle"
    fill="#d0d0d0" font-size="${size}" font-weight="700"
    font-family="Arial, Helvetica, sans-serif"
    letter-spacing="${tracking}">PRODUCTIVITY DASHBOARD</text>
</svg>`);
  const { data, info } = await sharp(base)
    .composite([{ input: svg, top: 0, left: 0 }])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info, metrics: await measure(data, info.width, info.height) };
}

async function main() {
  const { data, info } = await sharp("public/brand/wpd-logo.png")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const px = Buffer.from(data);
  for (let y = 400; y < H; y++) {
    for (let x = 0; x < W; x++) px[(y * W + x) * 4 + 3] = 0;
  }
  const base = await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();

  // Pick largest size that stays within WORKFORCE-like margins (~10px inset)
  const candidates = [
    [34, 0.8, 428],
    [33, 1.0, 428],
    [32, 1.2, 428],
    [30, 1.6, 427],
  ];
  let best = null;
  for (const [size, tracking, y] of candidates) {
    const r = await render(base, W, H, size, tracking, y);
    console.log({ size, tracking, ...r.metrics });
    if (r.metrics.minX >= 8 && r.metrics.maxX <= W - 9) {
      best = { size, tracking, y, ...r };
      break;
    }
  }
  if (!best) {
    best = { ...(await render(base, W, H, 30, 1.6, 427)), size: 30, tracking: 1.6, y: 427 };
  }

  await sharp(best.data, { raw: { width: best.info.width, height: best.info.height, channels: 4 } })
    .png()
    .toFile("public/brand/wpd-logo.png");
  fs.copyFileSync("public/brand/wpd-logo.png", "public/brand/logo.png");

  const out = Buffer.from(best.data);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    if (r >= 120 && r > g && g >= b && chroma >= 28) continue;
    if (chroma > 28) continue;
    out[i] = 255 - r;
    out[i + 1] = 255 - g;
    out[i + 2] = 255 - b;
  }
  await sharp(out, { raw: { width: best.info.width, height: best.info.height, channels: 4 } })
    .png()
    .toFile("public/brand/wpd-logo-light.png");
  fs.copyFileSync("public/brand/wpd-logo-light.png", "public/brand/logo-light.png");

  await sharp({
    create: {
      width: best.info.width + 40,
      height: best.info.height + 40,
      channels: 3,
      background: "#0a0a0a",
    },
  })
    .composite([{ input: "public/brand/wpd-logo.png", left: 20, top: 20 }])
    .png()
    .toFile("public/brand/_qa-dark.png");

  console.log("selected", { size: best.size, tracking: best.tracking, metrics: best.metrics });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
