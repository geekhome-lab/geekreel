/**
 * @vw/radar —— AI 查询源模板、解析、去重、订阅匹配。
 * kind=ai-query 用联网文本模型；rss / http-api 直接拉公开源。
 */

export { parseHttpItems, parseRss, type ParsedRadarItem } from "./feeds";

import { createHash } from "node:crypto";
import type { RadarItem, RadarSub } from "@vw/core";
import type { ParsedRadarItem } from "./feeds";

export interface SourceTemplate {
  id: string;
  name: string;
  platform: string;
  intervalMinutes: number;
  queryTemplate: string;
}

const JSON_RULE = `
只输出 JSON，不要解释、不要 markdown。格式：
{"items":[{"title":"标题","platform":"平台名","url":"https://...或空字符串","heat":0到100的整数,"heatText":"原文热度描述如热搜第3","summary":"一句话摘要"}]}
至少 8 条、最多 20 条。必须是此刻互联网上真实在传的话题，不要编造过期新闻。热度是你根据排名/讨论量给出的估计。`;

export const sourceTemplates: SourceTemplate[] = [
  {
    id: "tpl_weibo",
    name: "微博热搜",
    platform: "微博",
    intervalMinutes: 360,
    queryTemplate: `请联网查询此刻微博热搜榜前 15 名。${JSON_RULE}`,
  },
  {
    id: "tpl_douyin",
    name: "抖音热点",
    platform: "抖音",
    intervalMinutes: 360,
    queryTemplate: `请联网查询此刻抖音热点 / 热榜上正在爆的话题（不是广告）。${JSON_RULE}`,
  },
  {
    id: "tpl_bilibili",
    name: "B站热门",
    platform: "B站",
    intervalMinutes: 360,
    queryTemplate: `请联网查询此刻哔哩哔哩（B站）热门或全站排行里正在火的内容话题。${JSON_RULE}`,
  },
  {
    id: "tpl_zhihu",
    name: "知乎热榜",
    platform: "知乎",
    intervalMinutes: 360,
    queryTemplate: `请联网查询此刻知乎热榜上的热门问题与话题。${JSON_RULE}`,
  },
  {
    id: "tpl_xiaohongshu",
    name: "小红书热点",
    platform: "小红书",
    intervalMinutes: 360,
    queryTemplate: `请联网查询此刻小红书正在流行的热点话题或热搜词。${JSON_RULE}`,
  },
];

export const RADAR_SYSTEM =
  "你是热点观察助手。你必须基于此刻互联网上的真实公开信息作答，禁止编造。热度 heat 是估计值（0–100）。";

export function itemHash(title: string, platform: string, url: string | null): string {
  const n = title.trim().toLowerCase().replace(/\s+/g, "");
  const u = (url ?? "").split("?")[0] ?? "";
  return createHash("sha256").update(`${n}|${platform}|${u}`).digest("hex").slice(0, 16);
}

/** 从模型输出里抠 JSON（容忍 markdown 围栏和前后废话） */
export function parseRadarResponse(text: string, fallbackPlatform: string): ParsedRadarItem[] {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回可解析的热点列表，请换一个更稳的联网文本模型再试");
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("模型返回的 JSON 不完整，请稍后重试或换模型");
  }
  const list = Array.isArray(json) ? json : (json as { items?: unknown }).items;
  if (!Array.isArray(list)) throw new Error("模型返回里没有 items 数组");

  const out: ParsedRadarItem[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const title = String(r.title ?? "").trim();
    if (!title) continue;
    const heatNum = Number(r.heat);
    const heat = Number.isFinite(heatNum) ? Math.max(0, Math.min(100, Math.round(heatNum))) : 50;
    const urlRaw = String(r.url ?? "").trim();
    out.push({
      title: title.slice(0, 160),
      platform: String(r.platform ?? fallbackPlatform).trim() || fallbackPlatform,
      url: urlRaw.startsWith("http") ? urlRaw.slice(0, 500) : null,
      heat,
      heatText: String(r.heatText ?? r.heat_text ?? "").trim().slice(0, 80),
      summary: String(r.summary ?? "").trim().slice(0, 240),
    });
  }
  if (out.length === 0) throw new Error("模型没有给出任何有效热点");
  return out.slice(0, 20);
}

export function isDue(lastRunAt: number | null, intervalMinutes: number, now = Date.now()): boolean {
  if (!lastRunAt) return true;
  return now - lastRunAt >= Math.max(5, intervalMinutes) * 60_000;
}

/** 免打扰：quietStart/quietEnd 为小时 0–23，可跨夜（如 22→8） */
export function inQuietHours(sub: Pick<RadarSub, "quietStart" | "quietEnd">, now = new Date()): boolean {
  const s = sub.quietStart;
  const e = sub.quietEnd;
  if (s === null || e === null || s === e) return false;
  const h = now.getHours();
  if (s < e) return h >= s && h < e;
  return h >= s || h < e;
}

export function matchSubscription(
  item: Pick<RadarItem, "title" | "summary" | "platform" | "heat">,
  sub: Pick<RadarSub, "keyword" | "platforms" | "heatThreshold" | "enabled">,
): boolean {
  if (!sub.enabled) return false;
  if (item.heat < sub.heatThreshold) return false;
  if (sub.platforms.length > 0 && !sub.platforms.includes(item.platform)) return false;
  const kw = sub.keyword.trim().toLowerCase();
  if (!kw) return false;
  const hay = `${item.title}\n${item.summary}`.toLowerCase();
  return hay.includes(kw);
}

export function buildFocusTemplate(focus: string): string {
  const topic = focus.trim() || "综合";
  return `请联网查询此刻「${topic}」领域正在被讨论的热点话题。${JSON_RULE}`;
}
