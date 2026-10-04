/**
 * 把当前平台的 yt-dlp 打进 packages/analyze/vendor/。
 * bun install 时跑一次，拷走整个项目就能下视频，不依赖本机 PATH。
 */
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const vendorDir = join(import.meta.dir, "..", "vendor");
const dest = join(vendorDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const stampPath = join(vendorDir, ".platform");

const fileName =
  process.platform === "darwin" ? "yt-dlp_macos" : process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const urls = [
  `https://ghfast.top/https://github.com/yt-dlp/yt-dlp/releases/latest/download/${fileName}`,
  `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${fileName}`,
];

const force = process.argv.includes("--force");
const stamp = existsSync(stampPath) ? (await Bun.file(stampPath).text()).trim() : "";
const samePlatform = stamp === process.platform;

function looksStandalone(): boolean {
  try {
    if (statSync(dest).size < 1_000_000) return false;
    const fd = openSync(dest, "r");
    const buf = Buffer.alloc(2);
    readSync(fd, buf, 0, 2, 0);
    closeSync(fd);
    return !(buf[0] === 0x23 && buf[1] === 0x21);
  } catch {
    return false;
  }
}

if (existsSync(dest) && !force) {
  if (samePlatform || (!stamp && looksStandalone())) {
    if (!stamp) await Bun.write(stampPath, process.platform);
    console.log(`[yt-dlp] 已打包: ${dest}`);
    process.exit(0);
  }
  console.log(`[yt-dlp] 已有 ${stamp || "未知平台"} 版，当前是 ${process.platform}，重新下载`);
}

if (!urls[0]) {
  console.warn(`[yt-dlp] 未支持的平台 ${process.platform}，贴链接下载会不可用，请从资产库分析`);
  process.exit(0);
}

mkdirSync(dirname(dest), { recursive: true });
let ok = false;
for (const url of urls) {
  console.log(`[yt-dlp] 下载 ${url}`);
  try {
    const res = await fetch(url);
    if (!res.ok) continue;
    await Bun.write(dest, new Uint8Array(await res.arrayBuffer()));
    if (Bun.file(dest).size < 1_000_000) {
      console.warn(`[yt-dlp] 文件过小，换源`);
      continue;
    }
    ok = true;
    break;
  } catch {
    /* 换源 */
  }
}
if (!ok) {
  console.warn(`[yt-dlp] 下载失败，可稍后 bun run --filter @vw/analyze install:bin`);
  process.exit(0);
}
try {
  chmodSync(dest, 0o755);
} catch {
  /* win */
}
await Bun.write(stampPath, process.platform);
console.log(`[yt-dlp] 已写入 ${dest} (${Bun.file(dest).size} bytes)`);
