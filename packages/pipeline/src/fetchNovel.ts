/** 拉可访问的小说页，抽纯文本。站点要登录或是 SPA 的，请改上传 txt。 */

export const MAX_NOVEL_CHARS = 20_000;

export function looksLikeHttpUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function clipNovel(text: string): { text: string; clipped: boolean } {
  const t = text.replace(/\r/g, "").trim();
  if (t.length <= MAX_NOVEL_CHARS) return { text: t, clipped: false };
  return { text: t.slice(0, MAX_NOVEL_CHARS), clipped: true };
}

export async function fetchNovelText(url: string, signal?: AbortSignal): Promise<{ title: string; text: string; clipped: boolean }> {
  const href = url.trim();
  if (!looksLikeHttpUrl(href)) throw new Error("这不是能打开的链接。请用 http 或 https。");
  const res = await fetch(href, {
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 VideoWorkbench/0.1",
      Accept: "text/html,text/plain,*/*",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`打不开这篇：HTTP ${res.status}。改成上传 txt，或把正文贴进来。`);
  const raw = await res.text();
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1]?.replace(/\s+/g, " ").trim() || "未命名小说";
  const plain = raw.includes("<html") || raw.includes("<HTML") ? stripHtml(raw) : raw;
  const clipped = clipNovel(plain);
  if (clipped.text.length < 40) throw new Error("这个页面几乎没有正文。多半要登录或是动态页，请改成上传 txt。");
  return { title: title.slice(0, 40), text: clipped.text, clipped: clipped.clipped };
}
