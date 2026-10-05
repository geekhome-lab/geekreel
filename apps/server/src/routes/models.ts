import { Hono } from "hono";
import {
  FAMILY_LABELS,
  VOICE_FAMILIES,
  getAdapter,
  listAdapters,
  missingUnitPrice,
  voiceFamilyOf,
  voicesForConfig,
  voicesForFamily,
  type Capability,
  type VoiceFamily,
} from "@vw/models";
import { err, ok } from "../lib/resp";
import {
  applyChannelPrices,
  attachChannelPrices,
  createEndpoint,
  deleteEndpoint,
  getEndpoint,
  importFromEnv,
  listEndpoints,
  setDefaultEndpoint,
  syncChannelPrices,
  updateEndpoint,
} from "../services/models";
import { usageSummary } from "../services/usage";

export const modelsRoutes = new Hono();

/** 适配器清单（含配置表单定义，前端动态渲染） */
modelsRoutes.get("/adapters", (c) =>
  ok(
    c,
    listAdapters().map((a) => ({
      type: a.type,
      label: a.label,
      capabilities: a.capabilities,
      configFields: a.configFields,
    })),
  ),
);

modelsRoutes.get("/endpoints", (c) => {
  const capability = c.req.query("capability") as Capability | undefined;
  return ok(c, listEndpoints(capability));
});

modelsRoutes.post("/import-env", async (c) => ok(c, await importFromEnv()));

/** 探测本机已装模型（Ollama / LM Studio / ComfyUI checkpoint） */
modelsRoutes.post("/probe", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    adapterType?: string;
    config?: Record<string, string>;
  };
  const adapter = body.adapterType ? getAdapter(body.adapterType) : null;
  if (!adapter) return err(c, "未知适配器");
  if (!adapter.listModels) return err(c, `「${adapter.label}」不会列模型，模型名请手填`);
  try {
    const models = await adapter.listModels(body.config ?? {});
    if (!models.length) return err(c, "这个地址上还没有模型。Ollama 先 pull，LM Studio 先加载，ComfyUI 看 models 文件夹。");
    return ok(c, { models });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(c, /fetch failed|ECONNREFUSED|Unable to connect/i.test(msg) ? "连不上这个地址。先把本机服务开起来。" : msg);
  }
});

modelsRoutes.post("/endpoints", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    adapterType?: string;
    capability?: Capability;
    config?: Record<string, string>;
    webSearch?: boolean;
    vision?: boolean;
  };
  if (!body.name?.trim()) return err(c, "请填写端点名称");
  if (!body.adapterType || !getAdapter(body.adapterType)) return err(c, "未知适配器");
  if (!body.capability) return err(c, "请选择能力类型");
  const adapter = getAdapter(body.adapterType)!;
  if (!adapter.capabilities.includes(body.capability)) {
    return err(c, `适配器「${adapter.label}」不支持 ${body.capability} 能力`);
  }
  for (const field of adapter.configFields) {
    if (field.required && !body.config?.[field.key]?.trim()) return err(c, `请填写 ${field.label}`);
  }
  const ep = createEndpoint({
    name: body.name.trim(),
    adapterType: body.adapterType,
    capability: body.capability,
    config: body.config ?? {},
    webSearch: body.webSearch,
    vision: body.vision,
  });
  const priceStatus = missingUnitPrice(ep) ? await attachChannelPrices(ep.id) : { ok: true as const };
  return ok(c, { ...getEndpoint(ep.id)!, priceStatus });
});

modelsRoutes.patch("/endpoints/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    config?: Record<string, string>;
    webSearch?: boolean;
    vision?: boolean;
    enabled?: boolean;
  };
  const ep = updateEndpoint(c.req.param("id"), body);
  if (!ep) return err(c, "端点不存在", 404);
  const fresh = getEndpoint(ep.id)!;
  const priceStatus = missingUnitPrice(fresh) ? await attachChannelPrices(ep.id) : { ok: true as const };
  return ok(c, { ...getEndpoint(ep.id)!, priceStatus });
});

modelsRoutes.delete("/endpoints/:id", (c) => {
  if (!deleteEndpoint(c.req.param("id"))) return err(c, "端点不存在", 404);
  return ok(c, { deleted: true });
});

modelsRoutes.post("/endpoints/:id/default", (c) => {
  const ep = setDefaultEndpoint(c.req.param("id"));
  if (!ep) return err(c, "端点不存在", 404);
  return ok(c, ep);
});

modelsRoutes.post("/prices/sync", async (c) => ok(c, await syncChannelPrices()));

modelsRoutes.post("/endpoints/:id/prices", async (c) => {
  try {
    return ok(c, await applyChannelPrices(c.req.param("id")));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(c, msg, msg === "端点不存在" ? 404 : 400);
  }
});

/** 连通性测试 */
modelsRoutes.post("/endpoints/:id/test", async (c) => {
  const ep = getEndpoint(c.req.param("id"), true);
  if (!ep) return err(c, "端点不存在", 404);
  const adapter = getAdapter(ep.adapterType);
  if (!adapter) return err(c, "适配器不存在", 500);
  const result = await adapter.test(ep.config);
  return ok(c, result);
});

modelsRoutes.get("/voices", (c) => {
  const wanted = c.req.query("endpointId");
  const wantedFamily = c.req.query("family") as VoiceFamily | undefined;
  const list = listEndpoints("tts").filter((e) => e.enabled);
  const families = VOICE_FAMILIES.map((f) => {
    const match = list.find((e) => voiceFamilyOf(e.config) === f.id);
    return {
      id: f.id,
      name: f.name,
      voices: voicesForFamily(f.id),
      endpointId: match?.id ?? null,
      endpointName: match?.name ?? null,
    };
  });
  const selected =
    (wanted && list.find((e) => e.id === wanted)) ||
    (wantedFamily && list.find((e) => voiceFamilyOf(e.config) === wantedFamily)) ||
    list.find((e) => e.isDefault) ||
    list[0] ||
    null;
  const family = selected ? voiceFamilyOf(selected.config) : wantedFamily && wantedFamily !== "generic" ? wantedFamily : "qwen";
  return ok(c, {
    endpointId: selected?.id ?? null,
    endpointName: selected?.name ?? null,
    family,
    voices: selected ? voicesForConfig(selected.config) : voicesForFamily(family === "generic" ? "qwen" : family),
    families,
    endpoints: list.map((e) => ({
      id: e.id,
      name: e.name,
      family: voiceFamilyOf(e.config),
      familyName: FAMILY_LABELS[voiceFamilyOf(e.config)],
      voiceCount: voicesForConfig(e.config).length,
    })),
  });
});

modelsRoutes.get("/usage", (c) => {
  const days = Math.min(365, Math.max(1, Number(c.req.query("days") ?? 30) || 30));
  return ok(c, usageSummary(days));
});
