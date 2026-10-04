import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyTimelineDoc, formatSrt } from "@vw/core";
import { buildRenderPlan, detectBins, executeRender, probe } from "./index";

const tmp = join("/tmp", `vw-m3-e2e-${process.pid}`);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("短剧竖屏画布是 1080×1920", () => {
  const doc = emptyTimelineDoc({ portrait: true });
  expect(doc.width).toBe(1080);
  expect(doc.height).toBe(1920);
});

test("buildRenderPlan：空视频轨抛错", () => {
  expect(() =>
    buildRenderPlan(emptyTimelineDoc(), new Map(), { burnSubs: false, outPath: "/tmp/x.mp4" }),
  ).toThrow("时间线为空");
});

test("buildRenderPlan：静帧 + 字幕生成 loop 输入与 concat", () => {
  const doc = emptyTimelineDoc();
  doc.tracks[0]!.clips.push({
    id: "c1",
    assetId: "img1",
    startMs: 0,
    inMs: 0,
    outMs: 3000,
    volume: 1,
  });
  doc.tracks[2]!.clips.push({
    id: "s1",
    text: "你好",
    startMs: 0,
    inMs: 0,
    outMs: 3000,
    volume: 1,
  });
  const assets = new Map([
    ["img1", { absPath: "/tmp/a.png", hasAudio: false, isStill: true }],
  ]);
  const plan = buildRenderPlan(doc, assets, {
    srtPath: "/tmp/a.srt",
    burnSubs: false,
    outPath: "/tmp/out.mp4",
  });
  expect(plan.videoClipCount).toBe(1);
  expect(plan.outputDurationMs).toBe(3000);
  expect(plan.subtitles).toBe("soft");
  expect(plan.args).toContain("-loop");
  expect(plan.args).toContain("-t");
  expect(plan.args.join(" ")).toContain("concat=n=1");
});

test("buildRenderPlan：变速和淡入淡出会进滤镜", () => {
  const doc = emptyTimelineDoc();
  doc.tracks[0]!.clips.push({
    id: "c1",
    assetId: "vid1",
    startMs: 0,
    inMs: 0,
    outMs: 4000,
    volume: 1,
    speed: 2,
    transition: "fade",
    transitionMs: 300,
  });
  const assets = new Map([["vid1", { absPath: "/tmp/a.mp4", hasAudio: false, isStill: false }]]);
  const plan = buildRenderPlan(doc, assets, { burnSubs: false, outPath: "/tmp/out.mp4" });
  const fc = plan.args[plan.args.indexOf("-filter_complex") + 1] ?? "";
  expect(fc).toContain("setpts=(PTS-STARTPTS)/2");
  expect(fc).toContain("fade=t=in");
  expect(plan.outputDurationMs).toBe(2000);
});

test("executeRender E2E：两张静帧 + 一段视频 + SRT 导出可播 mp4", async () => {
  const bins = await detectBins();
  expect(bins.available && bins.ffmpeg && bins.ffprobe).toBeTruthy();
  mkdirSync(tmp, { recursive: true });

  const red = join(tmp, "red.png");
  const blue = join(tmp, "blue.png");
  const clip = join(tmp, "clip.mp4");
  const srt = join(tmp, "subs.srt");
  const out = join(tmp, "out.mp4");

  const run = (args: string[]) => {
    const p = Bun.spawnSync([bins.ffmpeg!, "-y", "-hide_banner", ...args], {
      stdout: "ignore",
      stderr: "pipe",
    });
    if (p.exitCode !== 0) throw new Error(p.stderr.toString().slice(-400));
  };

  run(["-f", "lavfi", "-i", "color=c=red:s=640x360:d=0.04", "-frames:v", "1", red]);
  run(["-f", "lavfi", "-i", "color=c=blue:s=640x360:d=0.04", "-frames:v", "1", blue]);
  run([
    "-f", "lavfi", "-i", "testsrc=s=640x360:d=2:r=30",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest",
    clip,
  ]);
  writeFileSync(
    srt,
    formatSrt([
      { startMs: 0, endMs: 2000, text: "第一镜" },
      { startMs: 2000, endMs: 4000, text: "第二镜" },
      { startMs: 4000, endMs: 6000, text: "第三镜" },
    ]),
  );

  const doc = emptyTimelineDoc();
  doc.tracks[0]!.clips = [
    { id: "v0", assetId: "red", startMs: 0, inMs: 0, outMs: 2000, volume: 1 },
    { id: "v1", assetId: "vid", startMs: 2000, inMs: 0, outMs: 2000, volume: 1 },
    { id: "v2", assetId: "blue", startMs: 4000, inMs: 0, outMs: 2000, volume: 1 },
  ];
  doc.tracks[2]!.clips = [
    { id: "s0", text: "第一镜", startMs: 0, inMs: 0, outMs: 2000, volume: 1 },
    { id: "s1", text: "第二镜", startMs: 2000, inMs: 0, outMs: 2000, volume: 1 },
    { id: "s2", text: "第三镜", startMs: 4000, inMs: 0, outMs: 2000, volume: 1 },
  ];

  const assets = new Map([
    ["red", { absPath: red, hasAudio: false, isStill: true }],
    ["blue", { absPath: blue, hasAudio: false, isStill: true }],
    ["vid", { absPath: clip, hasAudio: true, isStill: false }],
  ]);

  const plan = buildRenderPlan(doc, assets, { srtPath: srt, burnSubs: false, outPath: out });
  expect(plan.videoClipCount).toBe(3);
  expect(plan.outputDurationMs).toBe(6000);

  await executeRender(bins.ffmpeg!, plan, () => {});

  const info = await probe(bins.ffprobe!, out);
  expect(info).toBeTruthy();
  expect(info!.width).toBe(1280);
  expect(info!.height).toBe(720);
  expect(info!.durationMs).toBeGreaterThan(5500);
  expect(info!.durationMs).toBeLessThan(6500);
  expect(info!.videoCodec).toBe("h264");
}, 60_000);
