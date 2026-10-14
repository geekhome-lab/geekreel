import { expect, test } from "bun:test";
import {
  applyPlaceholders,
  collectComfyOutputs,
  customWorkflowHint,
  explainComfyError,
  injectComfyPrompt,
  needsCustomWorkflow,
  parseComfyWorkflow,
  parseSize,
  pickCheckpoints,
  validateComfyConfig,
} from "./comfyui";

test("拒收普通工作流，只要 API Format", () => {
  expect(() => parseComfyWorkflow("{")).toThrow(/合法 JSON/);
  expect(() => parseComfyWorkflow(JSON.stringify({ nodes: [{ id: 1 }] }))).toThrow(/API Format/);
});

test("{{prompt}} 占位会替换，正向 CLIP 也会写入", () => {
  const graph = parseComfyWorkflow(
    JSON.stringify({
      "1": { class_type: "CLIPTextEncode", _meta: { title: "正向提示词" }, inputs: { text: "{{prompt}}" } },
      "2": { class_type: "CLIPTextEncode", _meta: { title: "负向提示词" }, inputs: { text: "neg" } },
      "3": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "old.safetensors" } },
    }),
  );
  const next = injectComfyPrompt(graph, { text: "一只猫", model: "flux.safetensors" });
  expect(next["1"]?.inputs?.text).toBe("一只猫");
  expect(next["2"]?.inputs?.text).toBe("neg");
  expect(next["3"]?.inputs?.ckpt_name).toBe("flux.safetensors");
});

test("没有占位时把提示词写进非负向 CLIP", () => {
  const next = injectComfyPrompt(
    {
      "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "7": { class_type: "CLIPTextEncode", _meta: { title: "Negative" }, inputs: { text: "bad" } },
    },
    { text: "城市夜景" },
  );
  expect(next["6"]?.inputs?.text).toBe("城市夜景");
  expect(next["7"]?.inputs?.text).toBe("bad");
});

test("从 object_info 抽出 checkpoint 文件名", () => {
  const names = pickCheckpoints({
    CheckpointLoaderSimple: {
      input: { required: { ckpt_name: [["a.safetensors", "b.ckpt"], {}] } },
    },
  });
  expect(names).toEqual(["a.safetensors", "b.ckpt"]);
});

test("探测别把 yaml 配置当成 checkpoint", () => {
  const names = pickCheckpoints({
    CheckpointLoader: {
      input: {
        required: {
          config_name: [["v1-inference.yaml", "v2-inpainting-inference.yaml", "anything_v3.yaml"], {}],
          ckpt_name: [["real.safetensors", "legacy.ckpt"], {}],
        },
      },
    },
  });
  expect(names).toEqual(["legacy.ckpt", "real.safetensors"]);
  expect(names.some((n) => n.endsWith(".yaml"))).toBe(false);
});

test("ComfyUI 校验失败翻成中文", () => {
  expect(explainComfyError("Prompt outputs failed validation")).toContain("工作流");
  expect(explainComfyError("Prompt outputs failed validation", ["ckpt_name: 'v1-inference.yaml' not in list"])).toContain(
    "探测本机模型",
  );
  expect(explainComfyError("Prompt outputs failed validation")).not.toMatch(/不要选|yaml/i);
});

test("Flux 模型必须贴专用工作流", () => {
  expect(needsCustomWorkflow("flux-2-klein-base-4b.safetensors")).toBe(true);
  expect(needsCustomWorkflow("sd_xl_base_1.0.safetensors")).toBe(false);
  expect(customWorkflowHint("flux-2-klein-base-4b.safetensors")).toContain("Save (API Format)");
  expect(explainComfyError("Prompt outputs failed validation", [], "flux-2-klein-base-4b.safetensors")).toContain(
    "工作流",
  );
  expect(
    validateComfyConfig({ model: "flux-2-klein-base-4b.safetensors" }, "image"),
  ).toContain("必须贴工作流");
  expect(
    validateComfyConfig({ model: "flux-2-klein-base-4b.safetensors", workflow: '{"1":{}}' }, "image"),
  ).toBeNull();
  expect(validateComfyConfig({ model: "a.safetensors" }, "video")).toContain("必须贴工作流");
});

test("收集出图和出视频文件", () => {
  const files = collectComfyOutputs({
    "9": { images: [{ filename: "out.png", type: "output" }] },
    "10": { videos: [{ filename: "clip.mp4", subfolder: "video", type: "output" }] },
  });
  expect(files.map((f) => f.filename)).toEqual(["out.png", "clip.mp4"]);
  expect(files[1]?.kind).toBe("video");
});

test("尺寸写成 宽x高", () => {
  expect(parseSize("1024x768")).toEqual({ width: 1024, height: 768 });
  expect(parseSize("bad")).toBeNull();
});

test("占位替换不会把引号弄坏 JSON", () => {
  const next = applyPlaceholders(
    { "1": { class_type: "CLIPTextEncode", inputs: { text: "say {{prompt}}" } } },
    { prompt: 'a "cat"' },
  );
  expect(next["1"]?.inputs?.text).toBe('say a "cat"');
});
