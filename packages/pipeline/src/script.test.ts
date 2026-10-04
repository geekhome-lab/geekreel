import { expect, test } from "bun:test";
import { fallbackKeys, keepSceneTimes, parseKeys, parseScript, reviseScriptPrompt, scriptPrompt } from "./script";

test("读剧本 JSON", () => {
  const doc = parseScript(
    '{"title":"武松打虎","logline":"景阳冈","scenes":[{"id":"C01","heading":"酒店","action":"喝酒","lines":[{"id":"L01","speaker":"武松","text":"这酒好生有劲"}]}]}',
    "武松打虎",
  );
  expect(doc.title).toBe("武松打虎");
  expect(doc.scenes[0]!.lines[0]!.text).toBe("这酒好生有劲");
});

test("坏文本走兜底剧本", () => {
  const doc = parseScript("不是 json", "武松打虎");
  expect(doc.scenes.length).toBeGreaterThan(0);
  expect(doc.title).toContain("武松");
});

test("长剧本不被截场", () => {
  const scenes = Array.from({ length: 16 }, (_, i) => ({
    id: `C${String(i + 1).padStart(2, "0")}`,
    heading: `第${i + 1}场`,
    action: "过场",
    startSec: i * 8,
    endSec: (i + 1) * 8,
    lines: [{ id: `L${i + 1}`, speaker: "旁白", text: "往下。" }],
  }));
  const doc = parseScript(JSON.stringify({ title: "倩女幽魂", logline: "兰若寺", scenes }), "倩女幽魂");
  expect(doc.scenes).toHaveLength(16);
  expect(doc.durationSec).toBe(128);
});

test("剧本提示不写死总秒数，但带风格", () => {
  const p = scriptPrompt("武松打虎", { styleName: "手绘白板", styleRules: "暖米黄纸底示意图" });
  expect(p).toContain("手绘白板");
  expect(p).toContain("暖米黄纸底示意图");
  expect(p).not.toContain("必须是 10 秒");
  expect(p).not.toContain("不要擅自改成 5 秒");
  expect(p).toContain("不要替他规定总秒数");
});

test("改剧本提示听用户改时长", () => {
  const script = parseScript(
    '{"title":"武松打虎","logline":"x","durationSec":100,"scenes":[{"id":"C01","heading":"酒店","startSec":0,"endSec":100,"action":"喝酒","lines":[{"id":"L01","speaker":"武松","text":"这酒好生有劲"}]}]}',
    "武松打虎",
  );
  const p = reviseScriptPrompt(script, [], "压成 10 秒");
  expect(p).toContain("压成 10 秒");
  expect(p).toContain("必须改 durationSec");
  expect(p).not.toContain("不要擅自改总秒数");
});

test("已有剧情时间不改写", () => {
  const scenes = keepSceneTimes([
    { id: "C01", heading: "A", action: "", lines: [], startSec: 0, endSec: 12 },
    { id: "C02", heading: "B", action: "", lines: [], startSec: 12, endSec: 40 },
  ]);
  expect(scenes[0]!.endSec).toBe(12);
  expect(scenes[1]!.endSec).toBe(40);
});

test("抽关键资产，人物场景都有", () => {
  const script = parseScript(
    '{"title":"武松打虎","logline":"x","scenes":[{"id":"C01","heading":"景阳冈","action":"打虎","lines":[{"id":"L01","speaker":"武松","text":"来"}]}]}',
    "武松打虎",
  );
  const keys = parseKeys(
    '{"keys":[{"id":"K01","kind":"character","name":"武松","prompt":"豹头环眼"},{"id":"K02","kind":"scene","name":"景阳冈","prompt":"山岗"}]}',
    script,
  );
  expect(keys[0]!.name).toBe("武松");
  expect(fallbackKeys(script).some((k) => k.kind === "character")).toBe(true);
  expect(fallbackKeys(script, "手绘白板线稿示意图").every((k) => k.kind === "scene")).toBe(true);
});
