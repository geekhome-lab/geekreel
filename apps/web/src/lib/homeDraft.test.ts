import { expect, test } from "bun:test";
import { actualStep, sameWork, type HomeDraft } from "./homeDraft";

function draft(partial: Partial<HomeDraft>): HomeDraft {
  return {
    idea: "李世民的一生",
    script: { title: "李世民的一生", logline: "", durationSec: 10, scenes: [] },
    notes: [],
    packId: null,
    packLabel: "",
    keys: [],
    projectId: null,
    step: "script",
    asSeries: false,
    durationSec: 10,
    updatedAt: 1,
    ...partial,
  };
}

test("建项目后仍是同一部片子", () => {
  const before = draft({ projectId: null, step: "script" });
  const after = draft({ projectId: "p1", step: "keys", packId: "whiteboard" });
  expect(sameWork(before, after)).toBe(true);
});

test("剧本跑完并建了项目，状态是待出片不是待确认剧本", () => {
  expect(actualStep(draft({ step: "script" }))).toBe("script");
  expect(actualStep(draft({ step: "script", projectId: "p1" }))).toBe("keys");
  expect(actualStep(draft({ step: "script", keys: [{ id: "K01", kind: "scene", name: "示意", prompt: "线稿" }] }))).toBe("keys");
});

test("写想法时选过风格，剧本跑完还是确认剧本，不退回选风格", () => {
  expect(actualStep(draft({ step: "script", packId: "whiteboard", packLabel: "手绘白板" }))).toBe("script");
  expect(actualStep(draft({ step: "style", packId: "whiteboard", packLabel: "手绘白板" }))).toBe("script");
  expect(actualStep(draft({ step: "style" }))).toBe("style");
});

test("定妆跑完是待出片", () => {
  expect(actualStep(draft({ step: "style", packId: "whiteboard", packLabel: "手绘白板", projectId: "p1", keys: [{ id: "K01", kind: "scene", name: "示意", prompt: "线稿" }] }))).toBe("keys");
});
