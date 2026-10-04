export interface ParsedRadarItem {
  title: string;
  platform: string;
  url: string | null;
  heat: number;
  heatText: string;
  summary: string;
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? decodeXml(m[1] ?? "") : "";
}

/** RSS / Atom 抽标题、链接、摘要。热度按出现顺序递减。 */
export function parseRss(xml: string, platform: string): ParsedRadarItem[] {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
  const out: ParsedRadarItem[] = [];
  items.forEach((block, i) => {
    const title = tag(block, "title");
    if (!title) return;
    const link = tag(block, "link") || /<link[^>]+href="([^"]+)"/i.exec(block)?.[1] || "";
    const summary = tag(block, "description") || tag(block, "summary") || tag(block, "content");
    out.push({
      title: title.slice(0, 160),
      platform,
      url: link.startsWith("http") ? link.slice(0, 500) : null,
      heat: Math.max(20, 90 - i * 4),
      heatText: `RSS 第 ${i + 1} 条`,
      summary: summary.replace(/<[^>]+>/g, "").slice(0, 240),
    });
  });
  return out.slice(0, 20);
}

/** HTTP API：接受 {items:[...]} 或数组，字段兼容 title/url/heat/summary。 */
export function parseHttpItems(json: unknown, platform: string): ParsedRadarItem[] {
  const list = Array.isArray(json) ? json : (json as { items?: unknown; data?: unknown })?.items ?? (json as { data?: unknown })?.data;
  if (!Array.isArray(list)) throw new Error("这个接口没有返回 items 数组。请改成 { items: [{ title, url, heat, summary }] }");
  const out: ParsedRadarItem[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const title = String(r.title ?? r.name ?? "").trim();
    if (!title) continue;
    const urlRaw = String(r.url ?? r.link ?? "").trim();
    const heatNum = Number(r.heat);
    out.push({
      title: title.slice(0, 160),
      platform: String(r.platform ?? platform).trim() || platform,
      url: urlRaw.startsWith("http") ? urlRaw.slice(0, 500) : null,
      heat: Number.isFinite(heatNum) ? Math.max(0, Math.min(100, Math.round(heatNum))) : 50,
      heatText: String(r.heatText ?? r.heat_text ?? "接口").slice(0, 80),
      summary: String(r.summary ?? r.desc ?? r.description ?? "").slice(0, 240),
    });
  }
  if (out.length === 0) throw new Error("接口里没有有效条目");
  return out.slice(0, 20);
}
