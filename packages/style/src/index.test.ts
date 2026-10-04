import { expect, test } from "bun:test";
import type { PaletteDoc } from "@vw/core";
import { discoverStylePacks, injectImagePrompt, paletteLine } from "./index";

test("扫描到上美影和白板包", () => {
  const packs = discoverStylePacks();
  const ids = packs.map((p) => p.public.id);
  expect(ids).toContain("smy-animation");
  expect(ids).toContain("whiteboard");
  const smy = packs.find((p) => p.public.id === "smy-animation")!;
  expect(smy.public.ready).toBe(true);
  expect(smy.public.substyles.length).toBeGreaterThanOrEqual(3);
  const board = packs.find((p) => p.public.id === "whiteboard")!;
  expect(board.public.ready).toBe(true);
  expect(board.public.requiredCapabilities).toEqual([]);
  expect(board.styleBlock).toContain("纸");
});

test("色盘与风格块强制注入", () => {
  const pack = discoverStylePacks().find((p) => p.public.id === "smy-animation")!;
  const palette: PaletteDoc = {
    note: "",
    colors: [{ name: "朱砂", hex: "#C23A2B", role: "主" }],
  };
  const out = injectImagePrompt({ pack, raw: "武松打虎近景", palette, substyle: "flat" });
  expect(out).toContain("武松打虎近景");
  expect(out).toContain("#C23A2B");
  expect(out).toContain("2D");
  expect(paletteLine(palette)).toContain("朱砂");
});

test("白板提示词注入纸底约束", () => {
  const pack = discoverStylePacks().find((p) => p.public.id === "whiteboard")!;
  const out = injectImagePrompt({ pack, raw: "先把问题画成三步", palette: { note: "", colors: [{ name: "宣纸", hex: "#F5EBD7", role: "底" }] } });
  expect(out).toContain("先把问题画成三步");
  expect(out).toContain("#F5EBD7");
  expect(out).toContain("线稿");
});
