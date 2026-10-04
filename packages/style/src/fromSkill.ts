/**
 * 把 Agent Skill / GitHub 文档转成风格包草稿。
 * 只取文本，不执行技能里的脚本。
 */

import { inflateRawSync } from "node:zlib";

export interface SkillDoc {
  name: string;
  description: string;
  body: string;
}

export interface StyleDraft {
  name: string;
  summary: string;
  previewColors: string[];
  requiredCapabilities: Array<"llm" | "image" | "video" | "tts">;
  substyles: Array<{ id: string; name: string; hint: string }>;
  styleBlock: string;
  hardConstraint: string;
  negative: string;
  bibleSystem: string;
}

const MAX_TEXT = 240_000;

export function parseSkillMarkdown(raw: string): SkillDoc {
  const text = raw.replace(/^\uFEFF/, "");
  const fm = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!fm) return { name: "", description: "", body: text.trim() };
  const head = fm[1] ?? "";
  const body = (fm[2] ?? "").trim();
  const name = /^name:\s*(.+)$/m.exec(head)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  let description = "";
  const one = /^description:\s*>?\s*(.+)$/m.exec(head);
  if (one?.[1] && !one[1].startsWith("|") && one[1] !== ">") description = one[1].trim();
  else {
    const block = /^description:\s*[|>][^\n]*\n((?:[ \t]+.*\n?)*)/m.exec(head);
    if (block?.[1]) description = block[1].replace(/^[ \t]+/gm, "").trim();
  }
  return { name, description, body };
}

/** GitHub 页面 / raw / 目录 → 一串可拉 SKILL.md 的地址 */
export function skillFetchCandidates(url: string): string[] {
  const raw = url.trim();
  if (!/^https?:\/\//i.test(raw)) return [];
  const out: string[] = [];
  const push = (u: string) => {
    if (!out.includes(u)) out.push(u);
  };
  push(raw);

  const blob = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/.exec(raw);
  if (blob) {
    const [, owner, repo, ref, path] = blob;
    push(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`);
    push(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${path}`);
  }
  const tree = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?(.*)$/.exec(raw);
  if (tree) {
    const [, owner, repo, ref, path] = tree;
    const base = path ? `${path.replace(/\/$/, "")}/` : "";
    for (const file of [`${base}SKILL.md`, `${base}skill.md`, `${base}README.md`]) {
      push(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file}`);
      push(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${file}`);
    }
  }
  const repoOnly = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/.exec(raw);
  if (repoOnly) {
    const [, owner, repo] = repoOnly;
    for (const ref of ["main", "master", "HEAD"]) {
      for (const file of ["SKILL.md", "skill.md", "README.md"]) {
        push(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file}`);
      }
    }
  }
  const rawGh = /^https?:\/\/raw\.githubusercontent\.com\/.+/.exec(raw);
  if (rawGh && !raw.endsWith(".md")) {
    push(`${raw.replace(/\/$/, "")}/SKILL.md`);
  }
  // 国内镜像垫后
  return out.flatMap((u) =>
    u.includes("github.com") || u.includes("githubusercontent.com")
      ? [u, `https://ghfast.top/${u}`]
      : [u],
  );
}

export async function fetchSkillText(url: string): Promise<{ text: string; from: string }> {
  const candidates = skillFetchCandidates(url);
  if (candidates.length === 0) throw new Error("这不像网址。GitHub 仓库、技能目录或 SKILL.md 链接都可以。");
  for (const u of candidates) {
    try {
      const res = await fetch(u, { redirect: "follow", headers: { "User-Agent": "video-workbench" } });
      if (!res.ok) continue;
      const ctype = res.headers.get("content-type") ?? "";
      if (/octet-stream|zip|image|mpeg|mp4/i.test(ctype) && !/text|markdown|json/i.test(ctype)) continue;
      const text = await res.text();
      if (text.length < 40 || text.length > MAX_TEXT) continue;
      if (/<html/i.test(text.slice(0, 200)) && !text.includes("name:")) continue;
      return { text: text.slice(0, MAX_TEXT), from: u };
    } catch {
      /* 换源 */
    }
  }
  throw new Error("这个链接里没找到技能文本。换 SKILL.md 直链，或把文件上传上来。");
}

export function heuristicDraft(skill: SkillDoc, styleName: string): StyleDraft {
  const title = styleName.trim() || skill.name || "自定义风格";
  const desc = skill.description.replace(/\s+/g, " ").slice(0, 120) || `${title}。从开源技能转来，出图时套用这套说法。`;
  const visual = pickVisualChunk(skill.body) || skill.body.slice(0, 1200);
  return {
    name: title,
    summary: desc,
    previewColors: ["#2A2118", "#C23A2B", "#E2B23A", "#F3E6C8"],
    requiredCapabilities: ["llm", "image"],
    substyles: [],
    styleBlock: `${title}视觉规范：\n${visual.slice(0, 1600)}`.trim(),
    hardConstraint: "画面必须统一在这个风格里，不要串到写实照片或其他画风。",
    negative: "写实照片、水印、二维码、乱码字幕、过度磨皮",
    bibleSystem: `你是「${title}」短视频编剧。按该风格拆 5 集、每集 3 镜。只输出 JSON。`,
  };
}

function pickVisualChunk(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /风格|视觉|画面|提示词|prompt|色盘|出图/i.test(l));
  if (start < 0) return "";
  return lines.slice(start, start + 40).join("\n").trim();
}

export const CONVERT_SYSTEM =
  "你把开源技能说明转成视频工作台的风格包。只抽视觉/分镜/提示词约束，不要脚本和安装步骤。只输出 JSON。";

export function convertPrompt(styleName: string, skill: SkillDoc, extra: string): string {
  return `把下面的技能转成风格「${styleName}」。
用户补充：${extra.trim() || "无"}
技能名：${skill.name || "未知"}
简介：${skill.description || "无"}
正文：
${skill.body.slice(0, 8000)}

输出 JSON：
{"name":"${styleName}","summary":"一句话给小白看","previewColors":["#RRGGBB"],"requiredCapabilities":["llm","image"],"substyles":[{"id":"default","name":"默认","hint":""}],"styleBlock":"每条出图提示词开头的风格咒语","hardConstraint":"必须遵守的硬约束","negative":"不要出现的元素","bibleSystem":"拆集时的系统提示"}`;
}

export function writePrompt(styleName: string, brief: string): string {
  return `请直接写一套新的视频风格包，名字叫「${styleName}」。
用户怎么形容：
${brief.trim()}

输出 JSON：
{"name":"${styleName}","summary":"一句话给小白看","previewColors":["#RRGGBB"],"requiredCapabilities":["llm","image"],"substyles":[],"styleBlock":"风格咒语","hardConstraint":"硬约束","negative":"不要出现","bibleSystem":"拆集系统提示"}`;
}

export function parseStyleDraft(text: string, fallbackName: string, fallbackSkill?: SkillDoc): StyleDraft {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const r = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      const name = String(r.name ?? fallbackName).trim() || fallbackName;
      const substyles = Array.isArray(r.substyles)
        ? r.substyles.map((s, i) => {
            const x = (s ?? {}) as Record<string, unknown>;
            return {
              id: String(x.id ?? `s${i}`).trim() || `s${i}`,
              name: String(x.name ?? "子风格").trim(),
              hint: String(x.hint ?? "").trim(),
            };
          }).filter((s) => s.name)
        : [];
      const caps = Array.isArray(r.requiredCapabilities)
        ? r.requiredCapabilities.map((c) => String(c)).filter((c): c is StyleDraft["requiredCapabilities"][number] =>
          c === "llm" || c === "image" || c === "video" || c === "tts")
        : [];
      const draft: StyleDraft = {
        name,
        summary: String(r.summary ?? "").trim() || `${name}。自定义风格。`,
        previewColors: Array.isArray(r.previewColors) ? r.previewColors.map(String).filter((c) => /^#?[0-9a-fA-F]{3,8}$/.test(c)).map((c) => (c.startsWith("#") ? c : `#${c}`)) : [],
        requiredCapabilities: caps.length ? caps : ["llm", "image"],
        substyles,
        styleBlock: String(r.styleBlock ?? "").trim(),
        hardConstraint: String(r.hardConstraint ?? "").trim() || "画面必须统一在这个风格里。",
        negative: String(r.negative ?? "").trim(),
        bibleSystem: String(r.bibleSystem ?? "").trim() || `你是「${name}」短视频编剧。拆 5 集每集 3 镜。只输出 JSON。`,
      };
      if (!draft.styleBlock && fallbackSkill) return heuristicDraft(fallbackSkill, name);
      if (!draft.previewColors.length) draft.previewColors = ["#2A2118", "#C23A2B", "#E2B23A", "#F3E6C8"];
      return draft;
    } catch {
      /* 兜底 */
    }
  }
  return fallbackSkill ? heuristicDraft(fallbackSkill, fallbackName) : heuristicDraft({ name: fallbackName, description: text.slice(0, 200), body: text }, fallbackName);
}

/** 从 zip 里抽出 SKILL.md / pack.json / 第一个 md */
export function extractTextFromZip(buf: Uint8Array): string | null {
  const names = ["skill.md", "pack.json", "readme.md"];
  let firstMd: string | null = null;
  let offset = 0;
  while (offset + 30 < buf.length) {
    if (buf[offset] !== 0x50 || buf[offset + 1] !== 0x4b || buf[offset + 2] !== 0x03 || buf[offset + 3] !== 0x04) break;
    const method = buf[offset + 8]! | (buf[offset + 9]! << 8);
    const comp = buf[offset + 18]! | (buf[offset + 19]! << 8) | (buf[offset + 20]! << 16) | (buf[offset + 21]! << 24);
    const nameLen = buf[offset + 26]! | (buf[offset + 27]! << 8);
    const extraLen = buf[offset + 28]! | (buf[offset + 29]! << 8);
    const name = new TextDecoder().decode(buf.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + comp);
    offset = dataStart + comp;
    if (name.endsWith("/") || name.includes("__MACOSX")) continue;
    let text: string;
    try {
      const raw = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
      if (!raw) continue;
      text = new TextDecoder().decode(raw);
    } catch {
      continue;
    }
    const base = name.split("/").pop()?.toLowerCase() ?? "";
    if (names.includes(base) || base === "skill.md") return text;
    if (!firstMd && base.endsWith(".md")) firstMd = text;
  }
  return firstMd;
}
