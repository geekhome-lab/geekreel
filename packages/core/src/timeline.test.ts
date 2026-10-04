import { expect, test } from "bun:test";
import { formatAss, msToAssTime } from "./timeline";

test("ASS 按画面分辨率写字号，避免默认 288 画布把字幕放巨大", () => {
  const ass = formatAss([{ startMs: 0, endMs: 2410, text: "东汉末年，涿县街头" }], { width: 1080, height: 1920 });
  expect(ass).toContain("PlayResX: 1080");
  expect(ass).toContain("PlayResY: 1920");
  expect(ass).toContain("PingFang SC,34,");
  expect(ass).toContain("0:00:00.00,0:00:02.41");
  expect(ass).toContain("东汉末年，涿县街头");
  expect(msToAssTime(2410)).toBe("0:00:02.41");
});
