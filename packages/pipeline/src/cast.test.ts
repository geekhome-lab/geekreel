import { expect, test } from "bun:test";
import {
  assetsFromCast,
  dossierPrompt,
  parseBibleRevise,
  parseCastDoc,
  parseOneCharacter,
  parseOneEvent,
  reviseBiblePrompt,
} from "./cast";

test("parseCastDoc 抽人物和事件", () => {
  const doc = parseCastDoc(
    `废话
\`\`\`json
{"title":"武松","cast":[{"id":"C01","name":"武松","identity":"行者","personality":"刚猛","appearance":"身高八尺","outfit":"头巾短褐"}],"events":[{"id":"E01","chapter":"景阳冈","title":"打虎","summary":"酒后遇虎","characters":["C01"]}]}
\`\`\``,
    "武松打虎",
  );
  expect(doc.title).toBe("武松");
  expect(doc.cast[0]!.name).toBe("武松");
  expect(doc.cast[0]!.outfit).toBe("头巾短褐");
  expect(doc.events[0]!.title).toBe("打虎");
  expect(doc.cast[0]!.prompt).toContain("武松");
});

test("坏 JSON 走兜底人物", () => {
  const doc = parseCastDoc("不是 json", "景阳冈武松打虎");
  expect(doc.cast[0]!.name).toBe("主角");
  expect(doc.events.length).toBeGreaterThan(0);
});

test("parseOneCharacter 保住 id", () => {
  const next = parseOneCharacter(
    '{"name":"武松","appearance":"豹头环眼","outfit":"青衣"}',
    { id: "C01", name: "武", identity: "", personality: "", appearance: "", outfit: "", prompt: "", imageAssetId: null },
  );
  expect(next.id).toBe("C01");
  expect(next.appearance).toContain("豹头");
});

test("parseOneEvent 保住 id", () => {
  const next = parseOneEvent('{"title":"过冈","summary":"酒后上山"}', {
    id: "E02",
    chapter: "二",
    index: 2,
    title: "旧",
    summary: "旧",
    characters: ["C01"],
  });
  expect(next.id).toBe("E02");
  expect(next.title).toBe("过冈");
});

test("档案拼出图提示", () => {
  const p = dossierPrompt({
    id: "C01",
    name: "武松",
    identity: "行者",
    personality: "刚猛",
    appearance: "豹头",
    outfit: "青衣",
    prompt: "",
  });
  expect(p).toContain("行者");
  expect(assetsFromCast([{ id: "C01", name: "武松", identity: "", personality: "", appearance: "", outfit: "", prompt: p }])[0]!.kind).toBe(
    "character",
  );
});

test("整份改写保住 id 和定妆图", () => {
  const p = reviseBiblePrompt(
    {
      title: "Wu Song",
      palette: { note: "ink", colors: [] },
      cast: [{ id: "C01", name: "Wu Song", identity: "hero", personality: "", appearance: "", outfit: "", prompt: "", imageAssetId: "img-1" }],
      events: [{ id: "E01", chapter: "1", index: 1, title: "Tiger", summary: "fights", characters: ["C01"] }],
    },
    "全部改成中文",
  );
  expect(p).toContain("全部改成中文");
  expect(p).toContain("C01");
  const next = parseBibleRevise(
    '{"title":"武松","cast":[{"id":"C01","name":"武松","identity":"行者","appearance":"豹头","outfit":"青衣"}],"events":[{"id":"E01","chapter":"一","index":1,"title":"打虎","summary":"酒后遇虎","characters":["C01"]}]}',
    {
      title: "Wu Song",
      packId: null,
      substyle: null,
      palette: { note: "ink", colors: [] },
      assets: [],
      episodes: [],
      cast: [{ id: "C01", name: "Wu Song", identity: "hero", personality: "", appearance: "", outfit: "", prompt: "", imageAssetId: "img-1" }],
      events: [{ id: "E01", chapter: "1", index: 1, title: "Tiger", summary: "fights", characters: ["C01"] }],
    },
  );
  expect(next.title).toBe("武松");
  expect(next.cast?.[0]?.id).toBe("C01");
  expect(next.cast?.[0]?.name).toBe("武松");
  expect(next.cast?.[0]?.imageAssetId).toBe("img-1");
  expect(next.events?.[0]?.title).toBe("打虎");
});
