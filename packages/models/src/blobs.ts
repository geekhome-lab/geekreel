export type ImageBlob = { mime: string; data: Uint8Array };

export interface ImageGenRequest {
  prompt: string;
  size?: string;
  signal?: AbortSignal;
  refs?: ImageBlob[];
}

export interface VideoGenRequest {
  prompt: string;
  durationSec?: number;
  signal?: AbortSignal;
  image?: ImageBlob;
  lastFrame?: ImageBlob;
  refs?: ImageBlob[];
  dialogue?: string;
  audio?: boolean;
  voice?: ImageBlob;
}

/** 首帧 + 尾帧 + 主体库，去重后最多 9 张。 */
export function collectVideoImages(req: { image?: ImageBlob; lastFrame?: ImageBlob; refs?: ImageBlob[] }): ImageBlob[] {
  const out: ImageBlob[] = [];
  const seen = new Set<number>();
  for (const img of [req.image, req.lastFrame, ...(req.refs ?? [])]) {
    if (!img?.data?.length) continue;
    const mid = img.data[Math.floor(img.data.length / 2)] ?? 0;
    const key = img.data.length * 104729 + (img.data[0] ?? 0) * 257 + mid * 17 + (img.data[img.data.length - 1] ?? 0);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(img);
    if (out.length >= 9) break;
  }
  return out;
}
