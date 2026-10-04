/**
 * @vw/analyze —— yt-dlp 探测/下载、抽帧、报告解析。
 * 不内置爬虫：下载走 yt-dlp，分析走用户配置的文本模型。
 */

import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AnalysisReportDoc, RemakeTemplateDoc } from "@vw/core";
import { runFfmpeg } from "@vw/media";

export const ANALYZE_SYSTEM =
  "你是短视频拆解教练。根据提供的素材信息做结构化分析，不要编造具体台词（没有转写就写「未见转写」）。如果附带了抽帧图片，必须根据画面写 visual，不要只靠时刻表瞎猜。只输出 JSON。";

export function analysisPrompt(input: {
  title: string;
  durationMs: number;
  frames: Array<{ tMs: number }>;
  transcript: string | null;
  sourceUrl: string | null;
  withImages?: boolean;
}): string {
  const frameList = input.frames.map((f) => `${(f.tMs / 1000).toFixed(1)}s`).join(", ");
  return `请拆解这条短视频，输出 JSON：
{"title":"作品名","hook":{"startMs":0,"endMs":3000,"summary":"前3秒钩子"},"structure":[{"name":"钩子|展开|高潮|CTA","startMs":0,"endMs":0,"note":""}],"shots":[{"startMs":0,"endMs":0,"visual":"画面","line":"台词或未见转写"}],"rhythm":{"shotCount":0,"avgShotMs":0,"wordsPerSec":null,"note":""},"viralFactors":["留人技巧1","情绪点"],"template":{"name":"可复用结构名","variables":["主题","产品","人物设定"],"slots":[{"id":"hook","maxSec":3,"shotDesc":"画面槽","lineSlot":"台词槽"}]}}

已知信息：
标题：${input.title}
时长：${(input.durationMs / 1000).toFixed(1)} 秒
链接：${input.sourceUrl ?? "本地文件"}
抽帧时刻：${frameList || "无"}
${input.withImages ? "已附上对应时刻的画面截图，请按图描述 visual。" : "没有附带画面，只根据时长和抽帧节奏推断结构。"}
转写：${input.transcript?.trim() || "（无转写，台词写未见转写）"}`;
}

export function parseAnalysisReport(text: string): AnalysisReportDoc {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回可解析的分析报告，请换一个文本模型再试");
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("分析报告 JSON 不完整，请重试");
  }
  const r = json as Record<string, unknown>;
  const hook = (r.hook ?? {}) as Record<string, unknown>;
  const rhythm = (r.rhythm ?? {}) as Record<string, unknown>;
  const template = (r.template ?? {}) as Record<string, unknown>;
  const shots = Array.isArray(r.shots) ? r.shots : [];
  const structure = Array.isArray(r.structure) ? r.structure : [];
  const factors = Array.isArray(r.viralFactors) ? r.viralFactors.map((x) => String(x).trim()).filter(Boolean) : [];
  const slots = Array.isArray(template.slots) ? template.slots : [];
  return {
    title: String(r.title ?? "未命名").trim() || "未命名",
    hook: {
      startMs: num(hook.startMs, 0),
      endMs: num(hook.endMs, 3000),
      summary: String(hook.summary ?? "").trim(),
    },
    structure: structure.map((s) => {
      const x = (s ?? {}) as Record<string, unknown>;
      return { name: String(x.name ?? "段落"), startMs: num(x.startMs, 0), endMs: num(x.endMs, 0), note: String(x.note ?? "") };
    }),
    shots: shots.map((s) => {
      const x = (s ?? {}) as Record<string, unknown>;
      return {
        startMs: num(x.startMs, 0),
        endMs: num(x.endMs, 0),
        visual: String(x.visual ?? "").trim(),
        line: String(x.line ?? "").trim(),
      };
    }),
    rhythm: {
      shotCount: num(rhythm.shotCount, shots.length),
      avgShotMs: num(rhythm.avgShotMs, 0),
      wordsPerSec: rhythm.wordsPerSec === null || rhythm.wordsPerSec === undefined ? null : num(rhythm.wordsPerSec, 0),
      note: String(rhythm.note ?? "").trim(),
    },
    viralFactors: factors.slice(0, 8),
    template: {
      name: String(template.name ?? "复刻模板").trim() || "复刻模板",
      variables: Array.isArray(template.variables) && template.variables.length
        ? template.variables.map((v) => String(v))
        : ["主题", "产品", "人物设定"],
      slots: slots.map((s, i) => {
        const x = (s ?? {}) as Record<string, unknown>;
        return {
          id: String(x.id ?? `s${i}`),
          maxSec: Math.max(1, num(x.maxSec, 3)),
          shotDesc: String(x.shotDesc ?? "").trim(),
          lineSlot: String(x.lineSlot ?? "").trim(),
        };
      }),
    },
  };
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

export function fallbackTemplate(title: string, durationMs: number): RemakeTemplateDoc {
  const n = Math.max(3, Math.min(5, Math.round(durationMs / 3000) || 3));
  const slots = Array.from({ length: n }, (_, i) => ({
    id: i === 0 ? "hook" : i === n - 1 ? "cta" : `s${i}`,
    maxSec: i === 0 ? 3 : 4,
    shotDesc: i === 0 ? "开场钩子画面" : i === n - 1 ? "结尾行动号召" : `第 ${i + 1} 镜`,
    lineSlot: i === 0 ? "钩子台词" : i === n - 1 ? "CTA 台词" : `第 ${i + 1} 镜台词`,
  }));
  return { name: title || "短视频结构", variables: ["主题", "产品", "人物设定"], slots };
}

export function looksLikeVideoUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// yt-dlp
// ---------------------------------------------------------------------------

export interface YtdlpBin {
  bin: string | null;
  source: "env" | "bundled" | "path" | "common" | "none";
}

let ytdlpCached: YtdlpBin | null = null;

function which(name: string): string | null {
  try {
    const proc = Bun.spawnSync(["/usr/bin/which", name], { stdout: "pipe", stderr: "ignore" });
    const out = proc.stdout.toString().trim();
    return proc.exitCode === 0 && out && existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

function vendorPlatformStamp(): string {
  return join(import.meta.dir, "..", "vendor", ".platform");
}

/** 独立二进制：大于 1MB 且不是 #! 包装（pipx/python 脚本离开本机必挂） */
function looksLikeStandaloneBinary(p: string): boolean {
  try {
    if (statSync(p).size < 1_000_000) return false;
    const fd = openSync(p, "r");
    const buf = Buffer.alloc(2);
    readSync(fd, buf, 0, 2, 0);
    closeSync(fd);
    return !(buf[0] === 0x23 && buf[1] === 0x21);
  } catch {
    return false;
  }
}

function bundledYtdlp(): string | null {
  const name = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const p = join(import.meta.dir, "..", "vendor", name);
  if (!existsSync(p) || !looksLikeStandaloneBinary(p)) return null;
  const stampPath = vendorPlatformStamp();
  if (existsSync(stampPath)) {
    const stamp = readFileSync(stampPath, "utf8").trim();
    if (stamp && stamp !== process.platform) return null;
  }
  return p;
}

export function detectYtdlp(force = false): YtdlpBin {
  if (ytdlpCached && !force) return ytdlpCached;
  const env = process.env.VW_YTDLP;
  if (env && existsSync(env)) return (ytdlpCached = { bin: env, source: "env" });
  // 项目自带优先：拷到别的机器也能下视频，不依赖本机 PATH
  const bundled = bundledYtdlp();
  if (bundled) return (ytdlpCached = { bin: bundled, source: "bundled" });
  const pathHit = which("yt-dlp");
  if (pathHit && looksLikeStandaloneBinary(pathHit)) return (ytdlpCached = { bin: pathHit, source: "path" });
  const common = [
    join(homedir(), ".local/bin/yt-dlp"),
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
  ].find((p) => existsSync(p) && looksLikeStandaloneBinary(p));
  if (common) return (ytdlpCached = { bin: common, source: "common" });
  return (ytdlpCached = { bin: null, source: "none" });
}

/** 没有打包文件时，下载进项目 vendor/（不是用户家目录） */
export async function ensureYtdlp(_cacheDir?: string): Promise<YtdlpBin> {
  const found = detectYtdlp(true);
  if (found.bin) return found;
  const dest = join(import.meta.dir, "..", "vendor", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  mkdirSync(dirname(dest), { recursive: true });
  const fileName =
    process.platform === "darwin" ? "yt-dlp_macos" : process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const urls = [
    `https://ghfast.top/https://github.com/yt-dlp/yt-dlp/releases/latest/download/${fileName}`,
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${fileName}`,
  ];
  let wrote = false;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      await Bun.write(dest, new Uint8Array(await res.arrayBuffer()));
      if (Bun.file(dest).size < 1_000_000) continue;
      wrote = true;
      break;
    } catch {
      /* 换源 */
    }
  }
  if (!wrote) throw new Error("项目里还没有 yt-dlp，自动补全也失败了。把视频导入「资产库」再分析即可。");
  try {
    chmodSync(dest, 0o755);
  } catch {
    /* win */
  }
  try {
    writeFileSync(join(dirname(dest), ".platform"), process.platform);
  } catch {
    /* ignore */
  }
  ytdlpCached = { bin: dest, source: "bundled" };
  return ytdlpCached;
}

export async function downloadWithYtdlp(opts: {
  bin: string;
  url: string;
  outDir: string;
  ffmpegBin?: string | null;
}): Promise<{ file: string; title: string }> {
  mkdirSync(opts.outDir, { recursive: true });
  const args = [
    "--no-playlist",
    "--restrict-filenames",
    "--max-filesize",
    "80M",
    "-f",
    "bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format",
    "mp4",
    "-o",
    join(opts.outDir, "%(id)s.%(ext)s"),
    "--print",
    "after_move:%(title)s",
    "--print",
    "after_move:%(filepath)s",
  ];
  if (opts.ffmpegBin) args.push("--ffmpeg-location", dirname(opts.ffmpegBin));
  args.push(opts.url);

  const proc = Bun.spawn([opts.bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    const hint = /private|login|cookie|403|unavailable/i.test(stderr)
      ? "这条链可能要登录或已失效。先把视频保存下来，导入「资产库」再分析。"
      : "下载失败。换一条公开链接，或把视频导入资产库。";
    throw new Error(hint);
  }
  const lines = stdout.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const file = lines.at(-1) ?? "";
  const title = lines.at(-2) ?? "竞品视频";
  if (!file || !existsSync(file)) {
    const found = readdirSync(opts.outDir).find((n) => /\.(mp4|webm|mkv|mov)$/i.test(n));
    if (!found) throw new Error("下载完成但没找到视频文件，请改从资产库导入");
    return { file: join(opts.outDir, found), title };
  }
  return { file, title };
}

/** 按间隔抽帧（含首尾），最多 10 张 */
export async function sampleFrames(opts: {
  ffmpeg: string;
  input: string;
  outDir: string;
  durationMs: number;
  signal?: AbortSignal;
}): Promise<Array<{ tMs: number; file: string }>> {
  mkdirSync(opts.outDir, { recursive: true });
  const duration = Math.max(opts.durationMs, 1000);
  const count = Math.min(10, Math.max(3, Math.round(duration / 2500)));
  const times: number[] = [];
  for (let i = 0; i < count; i++) times.push(Math.round((i / Math.max(1, count - 1)) * (duration - 80)));
  const frames: Array<{ tMs: number; file: string }> = [];
  for (let i = 0; i < times.length; i++) {
    const tMs = times[i]!;
    const file = join(opts.outDir, `shot_${String(i).padStart(2, "0")}.jpg`);
    const at = Math.max(0, tMs / 1000).toFixed(2);
    await runFfmpeg({
      bin: opts.ffmpeg,
      args: ["-ss", at, "-i", opts.input, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "4", file],
      signal: opts.signal,
    });
    if (existsSync(file)) frames.push({ tMs, file: `shot_${String(i).padStart(2, "0")}.jpg` });
  }
  if (frames.length === 0) throw new Error("抽帧失败，视频可能已损坏");
  return frames;
}
