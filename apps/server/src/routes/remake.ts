import { Hono } from "hono";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";
import { getReport } from "../services/analyze";
import { getTemplate, listTemplates, templateFromReport } from "../services/remake";

export const remakeRoutes = new Hono();

remakeRoutes.get("/templates", (c) => ok(c, listTemplates()));

remakeRoutes.get("/templates/:id", (c) => {
  const tpl = getTemplate(c.req.param("id"));
  if (!tpl) return err(c, "模板不存在", 404);
  return ok(c, tpl);
});

remakeRoutes.post("/from-report", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reportId?: string };
  if (!body.reportId) return err(c, "缺少报告");
  if (!getReport(body.reportId)) return err(c, "报告不存在", 404);
  try {
    return ok(c, templateFromReport(body.reportId));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e));
  }
});

remakeRoutes.post("/run", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    templateId?: string;
    reportId?: string;
    variables?: Record<string, string>;
    endpointId?: string;
  };
  if (!body.templateId && !body.reportId) return err(c, "请先选一份报告或模板");
  const vars = body.variables ?? {};
  if (!Object.values(vars).some((v) => v.trim())) return err(c, "写一下你的主题，比如换成自己的产品");
  const job = jobQueue.submit("remake.run", body);
  return ok(c, job);
});
