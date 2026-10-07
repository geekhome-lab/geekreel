import { expect, test } from "bun:test";
import { duckBgm, emptyTimelineDoc, formatAss, layAmbience, layBgm, laySfxHits, msToAssTime, timelineDuration } from "./timeline";

test("配乐铺满整条片子，音量压低", () => {
  const doc = emptyTimelineDoc({ portrait: true });
  doc.tracks[0]!.clips.push({ id: "v", assetId: "vid", startMs: 0, inMs: 0, outMs: 8000, volume: 1 });
  const next = layBgm(doc, "bgm-1");
  const music = next.tracks.find((t) => t.name === "配乐");
  expect(music?.clips[0]?.assetId).toBe("bgm-1");
  expect(music?.clips[0]?.volume).toBe(0.22);
  expect(music?.clips[0]?.outMs).toBe(8000);
  expect(timelineDuration(next)).toBe(8000);
});

test("人声区间把配乐压下去，空镜再抬回来", () => {
  const doc = emptyTimelineDoc({ portrait: true });
  doc.tracks[0]!.clips.push({ id: "v", assetId: "vid", startMs: 0, inMs: 0, outMs: 10000, volume: 1 });
  const ducked = duckBgm(layBgm(doc, "bgm-1"), [{ startMs: 2000, endMs: 5000 }]);
  const music = ducked.tracks.find((t) => t.name === "配乐");
  expect(music?.clips).toHaveLength(3);
  expect(music?.clips[0]?.volume).toBe(0.22);
  expect(music?.clips[1]?.volume).toBe(0.07);
  expect(music?.clips[1]?.startMs).toBe(2000);
  expect(music?.clips[2]?.volume).toBe(0.22);
});

test("环境底和音效各占一条轨", () => {
  const doc = emptyTimelineDoc({ portrait: true });
  doc.tracks[0]!.clips.push({ id: "v", assetId: "vid", startMs: 0, inMs: 0, outMs: 6000, volume: 1 });
  const next = laySfxHits(layAmbience(doc, "amb-1"), [{ startMs: 1000, assetId: "sfx-door" }]);
  expect(next.tracks.find((t) => t.name === "环境底")?.clips[0]?.assetId).toBe("amb-1");
  expect(next.tracks.find((t) => t.name === "音效")?.clips[0]?.assetId).toBe("sfx-door");
});

test("ASS 按画面分辨率写字号，避免默认 288 画布把字幕放巨大", () => {
  const ass = formatAss([{ startMs: 0, endMs: 2410, text: "东汉末年，涿县街头" }], { width: 1080, height: 1920 });
  expect(ass).toContain("PlayResX: 1080");
  expect(ass).toContain("PlayResY: 1920");
  expect(ass).toContain("PingFang SC,34,");
  expect(ass).toContain("0:00:00.00,0:00:02.41");
  expect(ass).toContain("东汉末年，涿县街头");
  expect(msToAssTime(2410)).toBe("0:00:02.41");
});
