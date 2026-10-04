import { expect, test } from "bun:test";
import { sendPush } from "./index";

test("缺配置时各渠道返回人话错误", async () => {
  expect((await sendPush("webhook", {}, { title: "t", body: "b" })).error).toContain("Webhook");
  expect((await sendPush("serverchan", {}, { title: "t", body: "b" })).error).toContain("SendKey");
  expect((await sendPush("telegram", {}, { title: "t", body: "b" })).error).toContain("Token");
  expect((await sendPush("bark", {}, { title: "t", body: "b" })).error).toContain("Key");
});

test("webhook 成功投递 JSON", async () => {
  const received: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      received.push(await req.json());
      return new Response("ok");
    },
  });
  const r = await sendPush("webhook", { url: `http://127.0.0.1:${server.port}/` }, {
    title: "命中",
    body: "武松",
    url: "http://127.0.0.1:4780/radar",
  });
  server.stop();
  expect(r.ok).toBe(true);
  expect(received[0]).toEqual({ title: "命中", body: "武松", url: "http://127.0.0.1:4780/radar" });
});
