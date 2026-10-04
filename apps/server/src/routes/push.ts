import { Hono } from "hono";
import { pushChannelLabels, type PushChannelType } from "@vw/core";
import { pushFieldSpecs } from "@vw/push";
import { err, ok } from "../lib/resp";
import {
  createChannel,
  deleteChannel,
  deliver,
  getChannel,
  listChannels,
  listPushLogs,
  updateChannel,
} from "../services/push";

export const pushRoutes = new Hono();

pushRoutes.get("/types", (c) =>
  ok(
    c,
    (Object.keys(pushChannelLabels) as PushChannelType[]).map((type) => ({
      type,
      label: pushChannelLabels[type],
      fields: pushFieldSpecs[type],
    })),
  ),
);

pushRoutes.get("/channels", (c) => ok(c, listChannels()));

pushRoutes.post("/channels", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    type?: PushChannelType;
    name?: string;
    config?: Record<string, string>;
  };
  if (!body.type || !pushChannelLabels[body.type]) return err(c, "请选择推送方式");
  if (!body.name?.trim()) return err(c, "请给渠道起个名字，比如「我的微信」");
  return ok(c, createChannel({ type: body.type, name: body.name, config: body.config ?? {} }));
});

pushRoutes.patch("/channels/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    config?: Record<string, string>;
    enabled?: boolean;
  };
  const ch = updateChannel(c.req.param("id"), body);
  if (!ch) return err(c, "渠道不存在", 404);
  return ok(c, ch);
});

pushRoutes.delete("/channels/:id", (c) => {
  if (!deleteChannel(c.req.param("id"))) return err(c, "渠道不存在", 404);
  return ok(c, { deleted: true });
});

pushRoutes.post("/channels/:id/test", async (c) => {
  const ch = getChannel(c.req.param("id"));
  if (!ch) return err(c, "渠道不存在", 404);
  const log = await deliver(ch, { title: "视频工作台", body: "推送测试成功。之后热点命中会发到这里。", url: "http://127.0.0.1:4780/radar" }, null);
  if (log.status === "failed") return err(c, log.error || "发送失败", 502);
  return ok(c, log);
});

pushRoutes.get("/logs", (c) => ok(c, listPushLogs()));
