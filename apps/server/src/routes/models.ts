import { Hono } from "hono";
import { getAdapter, listAdapters, type Capability } from "@vw/models";
import { err, ok } from "../lib/resp";
import {
  createEndpoint,
  deleteEndpoint,
  getEndpoint,
  listEndpoints,
  setDefaultEndpoint,
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

modelsRoutes.post("/endpoints", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    adapterType?: string;
    capability?: Capability;
    config?: Record<string, string>;
    webSearch?: boolean;
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
  });
  return ok(c, ep);
});

modelsRoutes.patch("/endpoints/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    config?: Record<string, string>;
    webSearch?: boolean;
    enabled?: boolean;
  };
  const ep = updateEndpoint(c.req.param("id"), body);
  if (!ep) return err(c, "端点不存在", 404);
  return ok(c, ep);
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

/** 连通性测试 */
modelsRoutes.post("/endpoints/:id/test", async (c) => {
  const ep = getEndpoint(c.req.param("id"), true);
  if (!ep) return err(c, "端点不存在", 404);
  const adapter = getAdapter(ep.adapterType);
  if (!adapter) return err(c, "适配器不存在", 500);
  const result = await adapter.test(ep.config);
  return ok(c, result);
});

modelsRoutes.get("/usage", (c) => {
  const days = Math.min(365, Math.max(1, Number(c.req.query("days") ?? 30) || 30));
  return ok(c, usageSummary(days));
});
