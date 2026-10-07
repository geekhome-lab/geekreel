import { expect, test } from "bun:test";
import { buildJianyingDraft } from "./jianying";
import { emptyTimelineDoc } from "./timeline";

test("剪映草稿按微秒写下视频、配乐和字幕", () => {
  const doc = emptyTimelineDoc({ portrait: true });
  doc.tracks[0]!.clips.push({ id: "v", assetId: "vid", startMs: 0, inMs: 0, outMs: 5000, volume: 1 });
  doc.tracks[1]!.clips.push({ id: "a", assetId: "bgm", startMs: 0, inMs: 0, outMs: 5000, volume: 0.22 });
  doc.tracks[2]!.clips.push({ id: "s", text: "这酒好", startMs: 0, inMs: 0, outMs: 5000, volume: 1 });
  const { draftContent, draftMeta } = buildJianyingDraft({
    name: "武松",
    doc,
    media: [
      { assetId: "vid", path: "/tmp/v.mp4", title: "镜1", type: "video", durationMs: 5000, width: 1080, height: 1920 },
      { assetId: "bgm", path: "/tmp/b.mp3", title: "配乐", type: "audio", durationMs: 5000 },
    ],
    createdAt: 1_700_000_000_000,
  });
  expect(draftContent.duration).toBe(5_000_000);
  const materials = draftContent.materials as { videos: Array<{ path: string }>; audios: Array<{ path: string }>; texts: Array<{ content: string }> };
  expect(materials.videos[0]!.path).toBe("/tmp/v.mp4");
  expect(materials.audios[0]!.path).toBe("/tmp/b.mp3");
  expect(materials.texts[0]!.content).toBe("这酒好");
  expect((draftContent.tracks as unknown[]).length).toBe(3);
  expect(draftMeta.draft_name).toBe("武松");
  expect((draftContent.canvas_config as { ratio: string }).ratio).toBe("9:16");
});
