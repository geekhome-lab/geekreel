import { expect, test } from "bun:test";
import { applyShotLanguage, inferShotSize, parseShotSize, shotLanguageLine } from "./shotLang";
import { parseShotQa, shouldRetryQa } from "./qa";
import { matchLibraryEntity } from "./libraryMatch";
import { suggestSfxCue } from "./sfx";
import type { DramaBible } from "@vw/core";

test("画面里的特写推近写成镜头语言", () => {
  expect(inferShotSize("武松面部特写")).toBe("cu");
  expect(parseShotSize("全景")).toBe("fs");
  expect(parseShotSize("大远景")).toBe("els");
  expect(parseShotSize("远景")).toBe("ls");
  expect(shotLanguageLine({ shotSize: "cu", cameraMove: "push", angle: "low" })).toContain("特写");
  expect(shotLanguageLine({ shotSize: "cu", cameraMove: "push", angle: "low" })).toContain("推进");
});

test("没写景别就从画面补上", () => {
  const bible: DramaBible = {
    title: "武松",
    packId: null,
    substyle: null,
    palette: { note: "", colors: [] },
    assets: [],
    episodes: [
      {
        index: 1,
        title: "一",
        synopsis: "",
        narrator: "",
        lastFrame: "",
        shots: [{ startSec: 0, endSec: 5, visual: "酒店门口全身站着", line: "", imagePrompt: "推进到脸上" }],
      },
    ],
  };
  const next = applyShotLanguage(bible);
  expect(next.episodes[0]!.shots[0]!.shotSize).toBe("fs");
  expect(next.episodes[0]!.shots[0]!.cameraMove).toBe("push");
});

test("质检 JSON 漂了就打回", () => {
  const qa = parseShotQa('{"ok":false,"score":0.2,"note":"漂脸了"}');
  expect(qa.ok).toBe(false);
  expect(shouldRetryQa(qa)).toBe(true);
  expect(shouldRetryQa({ ...qa, retries: 1 })).toBe(false);
});

test("资产库按名字对上定妆视图", () => {
  const hit = matchLibraryEntity({
    name: "武松",
    kind: "character",
    assets: [
      { id: "a1", title: "武松脸", kind: "character" },
      { id: "a2", title: "武松侧面", kind: "character" },
    ],
  });
  expect(hit?.views.map((v) => v.kind)).toEqual(["face", "side"]);
});

test("喝酒画面给出酒碗音效", () => {
  expect(suggestSfxCue("武松举碗喝酒", "这酒好")).toBe("酒碗");
  expect(suggestSfxCue("空镜夜色")).toBeNull();
});
