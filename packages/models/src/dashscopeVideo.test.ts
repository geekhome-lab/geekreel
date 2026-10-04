import { expect, test } from "bun:test";
import { pickWanVideoModel, wanVideoChunks, wanVideoParams } from "./dashscopeVideo";

test("有参考图时文生视频模型改成图生视频", () => {
  expect(pickWanVideoModel("wan2.2-t2v-plus", false)).toBe("wan2.2-t2v-plus");
  expect(pickWanVideoModel("wan2.2-t2v-plus", true)).toBe("wan2.2-i2v-plus");
  expect(pickWanVideoModel("wan2.2-i2v-plus", true)).toBe("wan2.2-i2v-plus");
});

test("2.2 用尺寸，2.6 用分辨率和时长", () => {
  expect(wanVideoParams("wan2.2-t2v-plus")).toEqual({ size: "1920*1080", duration: 5, prompt_extend: true });
  expect(wanVideoParams("wan2.6-t2v", 12)).toMatchObject({ resolution: "720P", duration: 12 });
});

test("2.2 一次 5 秒，10 秒要两段", () => {
  expect(wanVideoChunks("wan2.2-t2v-plus", 10)).toEqual([5, 5]);
  expect(wanVideoChunks("wan2.5-t2v-preview", 10)).toEqual([10]);
  expect(wanVideoChunks("wan2.6-t2v", 8)).toEqual([8]);
});
