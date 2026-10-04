/**
 * 竞品分析只读公开页上的标题/文案，不下视频、不落盘。
 */

export interface VideoCopy {
  title: string;
  description: string;
  durationMs: number | null;
  author: string | null;
  tags: string[];
  sourceUrl: string;
}

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

export function extractHashtags(text: string): string[] {
  const hits = [...text.matchAll(/#([^\s#，。！？,.!?:：]+)/g)].map((m) => m[1]!);
  return [...new Set(hits)].slice(0, 16);
}

export function extractDouyinId(url: string): string | null {
  try {
    const u = new URL(url);
    const fromPath = /\/(?:video|share\/video|note)\/(\d{6,})/.exec(u.pathname)?.[1];
    if (fromPath) return fromPath;
    const modal = u.searchParams.get("modal_id") || u.searchParams.get("aweme_id");
    if (modal && /^\d{6,}$/.test(modal)) return modal;
    return null;
  } catch {
    return null;
  }
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function metaContent(html: string, key: string): string {
  const a = new RegExp(
    `<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*content=["']([^"']*)["']`,
    "i",
  ).exec(html);
  const b = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${key}["']`,
    "i",
  ).exec(html);
  return decodeHtml((a?.[1] ?? b?.[1] ?? "").trim());
}

function pageTitle(html: string): string {
  const raw = decodeHtml(/<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1] ?? "").trim();
  return raw
    .replace(/\s*[-_|·].{0,16}(抖音|TikTok|哔哩哔哩|bilibili|YouTube)\s*$/i, "")
    .trim();
}

function extractRedirect(html: string): string | null {
  const meta = /http-equiv=["']refresh["'][^>]*url=([^"'>\s]+)/i.exec(html)?.[1];
  const loc = /location\.(?:replace|href)\s*=\s*['"]([^'"]+)/i.exec(html)?.[1];
  const href = meta || loc;
  if (!href) return null;
  try {
    return new URL(href, "https://www.douyin.com").href;
  } catch {
    return null;
  }
}

function pickDuration(values: number[]): number | null {
  for (const n of values) {
    if (!Number.isFinite(n) || n <= 0) continue;
    if (n >= 800 && n <= 30 * 60_000) return Math.round(n);
    if (n > 0 && n < 800) return Math.round(n * 1000);
  }
  return null;
}

function walkCopyFields(
  obj: unknown,
  acc: { titles: string[]; descs: string[]; authors: string[]; durations: number[] },
  depth = 0,
): void {
  if (!obj || typeof obj !== "object" || depth > 12) return;
  if (Array.isArray(obj)) {
    for (const x of obj) walkCopyFields(x, acc, depth + 1);
    return;
  }
  const rec = obj as Record<string, unknown>;
  if (typeof rec.desc === "string" && rec.desc.trim().length > 1) acc.descs.push(rec.desc.trim());
  if (typeof rec.description === "string" && rec.description.trim().length > 1) acc.descs.push(rec.description.trim());
  if (typeof rec.title === "string" && rec.title.trim().length > 1) acc.titles.push(rec.title.trim());
  if (typeof rec.duration === "number") acc.durations.push(rec.duration);
  if (typeof rec.duration_ms === "number") acc.durations.push(rec.duration_ms);
  const author = rec.author;
  if (author && typeof author === "object") {
    const nick = (author as Record<string, unknown>).nickname;
    if (typeof nick === "string" && nick.trim()) acc.authors.push(nick.trim());
  }
  if (typeof rec.nickname === "string" && rec.nickname.trim()) acc.authors.push(rec.nickname.trim());
  for (const v of Object.values(rec)) {
    if (v && typeof v === "object") walkCopyFields(v, acc, depth + 1);
  }
}

function parseEmbeddedJson(html: string): { titles: string[]; descs: string[]; authors: string[]; durations: number[] } {
  const acc = { titles: [] as string[], descs: [] as string[], authors: [] as string[], durations: [] as number[] };
  const render = /<script[^>]*id=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  if (render) {
    try {
      walkCopyFields(JSON.parse(decodeURIComponent(render.trim())), acc);
    } catch {
      /* ignore */
    }
  }
  const router = /window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\});/.exec(html)?.[1];
  if (router) {
    try {
      walkCopyFields(JSON.parse(router), acc);
    } catch {
      /* ignore */
    }
  }
  const ldBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ldBlocks) {
    try {
      walkCopyFields(JSON.parse(m[1]!), acc);
    } catch {
      /* ignore */
    }
  }
  return acc;
}

export function extractCopyFromHtml(html: string, pageUrl: string): VideoCopy {
  const embedded = parseEmbeddedJson(html);
  const ogTitle = metaContent(html, "og:title") || metaContent(html, "twitter:title");
  const ogDesc = metaContent(html, "og:description") || metaContent(html, "description") || metaContent(html, "twitter:description");
  const title = (embedded.titles[0] || ogTitle || pageTitle(html)).slice(0, 80);
  const description = (embedded.descs.sort((a, b) => b.length - a.length)[0] || ogDesc).slice(0, 4000);
  const tags = extractHashtags(`${title}\n${description}`);
  return {
    title,
    description,
    durationMs: pickDuration(embedded.durations),
    author: embedded.authors[0] ?? null,
    tags,
    sourceUrl: pageUrl,
  };
}

function mergeCopy(base: VideoCopy, extra: Partial<VideoCopy> | null | undefined): VideoCopy {
  if (!extra) return base;
  const title = (extra.title && extra.title.length > base.title.length ? extra.title : base.title || extra.title || "").trim();
  const description = (extra.description && extra.description.length > base.description.length ? extra.description : base.description || extra.description || "").trim();
  return {
    title: title.slice(0, 80),
    description: description.slice(0, 4000),
    durationMs: base.durationMs ?? extra.durationMs ?? null,
    author: base.author || extra.author || null,
    tags: [...new Set([...base.tags, ...(extra.tags ?? [])])].slice(0, 16),
    sourceUrl: extra.sourceUrl || base.sourceUrl,
  };
}

async function fetchText(url: string): Promise<{ url: string; text: string; status: number }> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": MOBILE_UA,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
    },
    signal: AbortSignal.timeout(15_000),
  });
  return { url: res.url || url, text: await res.text(), status: res.status };
}

async function fetchDouyinItem(id: string): Promise<Partial<VideoCopy> | null> {
  const endpoints = [
    `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${id}`,
    `https://www.iesdouyin.com/share/video/${id}`,
  ];
  for (const url of endpoints) {
    try {
      const { text, url: finalUrl } = await fetchText(url);
      if (text.trim().startsWith("{")) {
        const json = JSON.parse(text) as unknown;
        const acc = { titles: [] as string[], descs: [] as string[], authors: [] as string[], durations: [] as number[] };
        walkCopyFields(json, acc);
        if (acc.descs[0] || acc.titles[0]) {
          return {
            title: acc.titles[0] || "",
            description: acc.descs.sort((a, b) => b.length - a.length)[0] || "",
            durationMs: pickDuration(acc.durations),
            author: acc.authors[0] ?? null,
            tags: extractHashtags(acc.descs[0] || ""),
          };
        }
      }
      const fromHtml = extractCopyFromHtml(text, finalUrl);
      if (fromHtml.title || fromHtml.description) return fromHtml;
    } catch {
      /* 换源 */
    }
  }
  return null;
}

async function fetchBilibili(url: string): Promise<Partial<VideoCopy> | null> {
  const id = /(?:bilibili\.com\/video\/|b23\.tv\/)(BV[\w]+|av\d+)/i.exec(url)?.[1];
  if (!id) return null;
  const qs = id.startsWith("BV") ? `bvid=${id}` : `aid=${id.slice(2)}`;
  try {
    const { text } = await fetchText(`https://api.bilibili.com/x/web-interface/view?${qs}`);
    const json = JSON.parse(text) as { data?: { title?: string; desc?: string; duration?: number; owner?: { name?: string } } };
    const d = json.data;
    if (!d) return null;
    return {
      title: d.title?.trim() || "",
      description: d.desc?.trim() || "",
      durationMs: typeof d.duration === "number" ? d.duration * 1000 : null,
      author: d.owner?.name ?? null,
      tags: extractHashtags(d.desc || ""),
    };
  } catch {
    return null;
  }
}

async function fetchOembed(url: string): Promise<Partial<VideoCopy> | null> {
  const endpoints: string[] = [];
  if (/youtu\.be|youtube\.com/i.test(url)) endpoints.push(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  if (/tiktok\.com/i.test(url)) endpoints.push(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
  for (const ep of endpoints) {
    try {
      const { text } = await fetchText(ep);
      const j = JSON.parse(text) as { title?: string; author_name?: string };
      if (j.title) return { title: j.title, description: j.title, author: j.author_name ?? null };
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function dumpYtdlpMeta(bin: string, url: string): Promise<Partial<VideoCopy> | null> {
  try {
    const proc = Bun.spawn([bin, "--skip-download", "--no-playlist", "--no-warnings", "-J", url], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    const j = JSON.parse(stdout) as {
      title?: string;
      fulltitle?: string;
      description?: string;
      duration?: number;
      uploader?: string;
      channel?: string;
      creator?: string;
      tags?: unknown;
    };
    return {
      title: String(j.title ?? j.fulltitle ?? "").trim(),
      description: String(j.description ?? "").trim(),
      durationMs: typeof j.duration === "number" ? Math.round(j.duration * 1000) : null,
      author: String(j.uploader ?? j.channel ?? j.creator ?? "").trim() || null,
      tags: Array.isArray(j.tags) ? j.tags.map(String).slice(0, 16) : [],
    };
  } catch {
    return null;
  }
}

export async function fetchVideoCopy(
  url: string,
  opts?: { ytdlpBin?: string | null },
): Promise<VideoCopy> {
  let current = url.trim();
  let html = "";
  let finalUrl = current;
  for (let hop = 0; hop < 3; hop++) {
    const page = await fetchText(current);
    finalUrl = page.url;
    html = page.text;
    const next = extractRedirect(html);
    if (next && next !== current && next !== finalUrl) {
      current = next;
      continue;
    }
    break;
  }

  let copy = extractCopyFromHtml(html, finalUrl);
  const dyId = extractDouyinId(finalUrl) || extractDouyinId(url);
  if (dyId && (!copy.description || copy.description.length < 8)) {
    copy = mergeCopy(copy, await fetchDouyinItem(dyId));
  }
  if (/bilibili\.com|b23\.tv/i.test(finalUrl) || /bilibili\.com|b23\.tv/i.test(url)) {
    copy = mergeCopy(copy, await fetchBilibili(finalUrl));
  }
  if (!copy.description && !copy.title) {
    copy = mergeCopy(copy, await fetchOembed(finalUrl));
  }
  if ((!copy.description || copy.description.length < 8) && opts?.ytdlpBin) {
    copy = mergeCopy(copy, await dumpYtdlpMeta(opts.ytdlpBin, url));
  }

  if (!copy.title && !copy.description) {
    throw new Error("没读到这条视频的标题或文案。换一条公开分享链接，或把文案直接贴进来。");
  }
  if (!copy.title) copy.title = copy.description.slice(0, 32) || "竞品视频";
  copy.sourceUrl = finalUrl || url;
  copy.tags = [...new Set([...copy.tags, ...extractHashtags(`${copy.title}\n${copy.description}`)])].slice(0, 16);
  return copy;
}
