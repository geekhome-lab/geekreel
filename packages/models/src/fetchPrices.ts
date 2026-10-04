import { dashscopeOrigin, isDashScope } from "./dashscopeImage";
import {
  hasAnyPrice,
  pickDashScopeModel,
  pricesFromDashScopeModel,
  pricesFromOpenRouter,
  type DashScopeModel,
  type PriceQuote,
} from "./prices";

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(text.slice(0, 160) || `HTTP ${res.status}`);
  }
}

async function fetchDashScopePrices(baseUrl: string, apiKey: string, model: string): Promise<PriceQuote> {
  const origin = dashscopeOrigin(baseUrl);
  const url = `${origin}/api/v1/models?model=${encodeURIComponent(model)}&language=zh-CN&page_no=1&page_size=20`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const json = (await readJson(res)) as {
    success?: boolean;
    message?: string;
    code?: string;
    output?: { models?: DashScopeModel[]; total?: number };
  };
  if (!res.ok || json.success === false) {
    throw new Error(json.message || json.code || `百炼报价 ${res.status}`);
  }
  const hit = pickDashScopeModel(json.output?.models ?? [], model);
  if (!hit) throw new Error(`百炼列表里没有「${model}」`);
  const prices = pricesFromDashScopeModel(hit);
  if (!hasAnyPrice(prices)) throw new Error(`百炼没给「${hit.model ?? model}」单价`);
  return { source: "dashscope", model: hit.model ?? model, ...prices };
}

async function fetchOpenRouterPrices(apiKey: string, model: string): Promise<PriceQuote> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const json = (await readJson(res)) as {
    data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string; image?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(json.error?.message || `OpenRouter ${res.status}`);
  const hit = (json.data ?? []).find((m) => m.id === model) ?? (json.data ?? []).find((m) => (m.id ?? "").endsWith(`/${model}`));
  if (!hit?.pricing) throw new Error(`OpenRouter 没有「${model}」报价`);
  const prices = pricesFromOpenRouter(hit.pricing);
  if (!hasAnyPrice(prices)) throw new Error(`OpenRouter 没给「${model}」单价`);
  return { source: "openrouter", model: hit.id ?? model, note: "按约 7.2 折成人民币", ...prices };
}

export function channelPriceHint(baseUrl: string): string | null {
  if (isDashScope(baseUrl)) return "百炼";
  if (/openrouter\.ai/i.test(baseUrl)) return "OpenRouter";
  return null;
}

export async function fetchChannelPrices(config: Record<string, string>): Promise<PriceQuote> {
  const baseUrl = (config.baseUrl ?? "").trim();
  const model = (config.model ?? "").trim();
  const apiKey = (config.apiKey ?? "").trim();
  if (!model) throw new Error("先填模型名");
  if (!apiKey) throw new Error("先填密钥");
  if (isDashScope(baseUrl)) return fetchDashScopePrices(baseUrl, apiKey, model);
  if (/openrouter\.ai/i.test(baseUrl)) return fetchOpenRouterPrices(apiKey, model);
  throw new Error("这个渠道没有报价接口，单价还是要手填");
}
