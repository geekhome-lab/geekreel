import { expect, test } from "bun:test";
import { parseRemakeShots } from "./index";

test("parseRemakeShots 按槽位对齐", () => {
  const tpl = {
    name: "t",
    variables: ["主题"],
    slots: [
      { id: "hook", maxSec: 3, shotDesc: "钩子", lineSlot: "问句" },
      { id: "cta", maxSec: 2, shotDesc: "结尾", lineSlot: "关注" },
    ],
  };
  const shots = parseRemakeShots(
    '{"shots":[{"slotId":"hook","line":"你还在用旧方法？","imagePrompt":"近景质问","maxSec":3},{"slotId":"cta","line":"点个关注","imagePrompt":"产品特写"}]}',
    tpl,
  );
  expect(shots).toHaveLength(2);
  expect(shots[0]!.line).toContain("旧方法");
  expect(shots[1]!.imagePrompt).toContain("字幕");
});
