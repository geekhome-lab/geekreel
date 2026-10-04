import { expect, test } from "bun:test";
import { assetWorkFolder, assetWorkLabel, buildAssetFolderTree, buildAssetRelPath, parseAssetFileName } from "./index";

test("新资产落到作品夹和集", () => {
  const path = buildAssetRelPath({
    type: "image",
    title: "聂小倩",
    id: "a3f2xxxx",
    ext: "png",
    workFolder: "works/倩女幽魂/第01集",
  });
  expect(path).toBe("works/倩女幽魂/第01集/image_聂小倩_a3f2.png");
  expect(assetWorkFolder(path)).toBe("works/倩女幽魂/第01集");
  expect(assetWorkLabel("works/倩女幽魂/第01集")).toBe("倩女幽魂 · 第01集");
});

test("旧年月路径归到未归类", () => {
  expect(assetWorkFolder("image/2026-10/1004_武松打虎_a3f2.png")).toBe("未归类/image");
  expect(assetWorkLabel("未归类/image")).toBe("未归类 · 图片");
});

test("重命名能认出新旧文件名", () => {
  expect(parseAssetFileName("image_聂小倩_a3f2.png")?.title).toBe("聂小倩");
  expect(parseAssetFileName("1004_武松打虎_a3f2.png")?.title).toBe("武松打虎");
});

test("作品夹收成树，一百部也只是一层列表", () => {
  const tree = buildAssetFolderTree([
    { folder: "works/倩女幽魂/第01集", count: 7 },
    { folder: "works/倩女幽魂/第02集", count: 3 },
    { folder: "works/武松打虎", count: 2 },
    { folder: "未归类/image", count: 15 },
  ]);
  expect(tree.map((n) => n.label)).toEqual(["作品", "未归类"]);
  expect(tree[0]!.count).toBe(12);
  expect(tree[0]!.children.map((n) => n.label)).toEqual(["倩女幽魂", "武松打虎"]);
  expect(tree[0]!.children[0]!.children.map((n) => n.label)).toEqual(["第01集", "第02集"]);
  expect(tree[1]!.children[0]!.label).toBe("图片");
});
