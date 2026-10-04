export interface ChannelPrices {
  priceInput?: string;
  priceOutput?: string;
  priceImage?: string;
  priceTts?: string;
  priceVideo?: string;
}

export interface PriceQuote extends ChannelPrices {
  source: string;
  model: string;
  note?: string;
}

export interface DashScopePriceItem {
  type?: string;
  price?: string | number;
  price_unit?: string;
  price_name?: string;
}

export interface DashScopePriceRange {
  range_name?: string;
  prices?: DashScopePriceItem[];
}

export interface DashScopeModel {
  model?: string;
  name?: string;
  prices?: DashScopePriceRange[];
}

function num(raw: string | number | undefined): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function formatYuan(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  const t = Math.round(n * 1e8) / 1e8;
  return String(t);
}

function unitNorm(unit: string): string {
  return unit.replace(/\s+/g, "").toLowerCase();
}

/** 渠道价 → 元/千 tokens */
export function yuanPerThousandTokens(price: number, unit: string): number | null {
  const u = unitNorm(unit);
  if (/百万|million|1m|\/mtoken|\/mtok/.test(u)) return price / 1000;
  if (/千|thousand|1k|\/ktoken/.test(u)) return price;
  if (/pertoken|\/token|每个token/.test(u) && !/百万|千|million|thousand/.test(u)) return price * 1000;
  return null;
}

/** 渠道价 → 元/千字 */
export function yuanPerThousandChars(price: number, unit: string): number | null {
  const u = unitNorm(unit);
  if (/万字|万字符|10000/.test(u)) return price / 10;
  if (/千字|千字符|1000/.test(u)) return price;
  if (/(每字|percharacter|\/char)/.test(u) && !/万|千/.test(u)) return price * 1000;
  return null;
}

function pickRange(ranges: DashScopePriceRange[] | undefined): DashScopePriceItem[] {
  if (!ranges?.length) return [];
  const def = ranges.find((r) => !r.range_name || /^default$/i.test(r.range_name));
  const chosen = def ?? ranges[0];
  return chosen?.prices ?? [];
}

function isType(item: DashScopePriceItem, ...needles: string[]): boolean {
  const blob = `${item.type ?? ""} ${item.price_name ?? ""}`.toLowerCase();
  return needles.some((n) => blob.includes(n));
}

export function pricesFromDashScopeModel(model: DashScopeModel): ChannelPrices {
  const out: ChannelPrices = {};
  for (const item of pickRange(model.prices)) {
    const p = num(item.price);
    if (p == null) continue;
    const unit = item.price_unit ?? "";
    if (isType(item, "input_token", "输入") && !isType(item, "output", "输出", "cached", "缓存")) {
      const v = yuanPerThousandTokens(p, unit);
      if (v != null) out.priceInput = formatYuan(v);
    } else if (isType(item, "output_token", "输出") && !isType(item, "image", "video", "图", "视频")) {
      const v = yuanPerThousandTokens(p, unit);
      if (v != null) out.priceOutput = formatYuan(v);
    } else if (isType(item, "image_number", "image", "图像", "出图") && /张|image/.test(unitNorm(unit) + item.type)) {
      out.priceImage = formatYuan(p);
    } else if (isType(item, "video", "视频", "duration") && /秒|second|sec/.test(unitNorm(unit))) {
      out.priceVideo = formatYuan(p);
    } else if (isType(item, "character", "tts", "语音", "配音", "字")) {
      const v = yuanPerThousandChars(p, unit);
      if (v != null) out.priceTts = formatYuan(v);
    } else if (/每张/.test(unit)) {
      out.priceImage = formatYuan(p);
    } else if (/每秒/.test(unit)) {
      out.priceVideo = formatYuan(p);
    }
  }
  return out;
}

export function pickDashScopeModel(models: DashScopeModel[], want: string): DashScopeModel | null {
  const id = want.trim();
  if (!id) return null;
  return (
    models.find((m) => m.model === id) ??
    models.find((m) => (m.model ?? "").toLowerCase() === id.toLowerCase()) ??
    models.find((m) => (m.model ?? "").startsWith(id) || id.startsWith(m.model ?? "")) ??
    models[0] ??
    null
  );
}

export function pricesFromOpenRouter(pricing: { prompt?: string; completion?: string; image?: string }, usdCny = 7.2): ChannelPrices {
  const out: ChannelPrices = {};
  const prompt = num(pricing.prompt);
  const completion = num(pricing.completion);
  const image = num(pricing.image);
  // OpenRouter 是美元 / token
  if (prompt != null) out.priceInput = formatYuan(prompt * 1000 * usdCny);
  if (completion != null) out.priceOutput = formatYuan(completion * 1000 * usdCny);
  if (image != null && image > 0) out.priceImage = formatYuan(image * usdCny);
  return out;
}

export function hasAnyPrice(p: ChannelPrices): boolean {
  return Boolean(p.priceInput || p.priceOutput || p.priceImage || p.priceTts || p.priceVideo);
}

export function missingUnitPrice(ep: { capability: string; config: Record<string, string> }): boolean {
  const c = ep.config;
  if (ep.capability === "llm") return !c.priceInput && !c.priceOutput;
  if (ep.capability === "image") return !c.priceImage;
  if (ep.capability === "video") return !c.priceVideo;
  if (ep.capability === "tts") return !c.priceTts;
  return !hasAnyPrice(c);
}
