import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";

export type ShotNodeData = { visual: string; line: string };

export function ShotNode({ id, data, selected }: NodeProps<Node<ShotNodeData>>) {
  const { updateNodeData } = useReactFlow();
  return (
    <div className={`w-64 rounded-xl border bg-panel shadow-lg ${selected ? "border-accent" : "border-line"}`}>
      <div className="border-b border-line px-3 py-1.5 text-[11px] font-medium text-fg-dim">分镜卡</div>
      <div className="space-y-1.5 p-3">
        <textarea
          className="nodrag h-16 w-full resize-y rounded-lg border border-line bg-panel-2 p-2 text-xs outline-none"
          placeholder="画面"
          value={data.visual}
          onChange={(e) => updateNodeData(id, { visual: e.target.value })}
        />
        <textarea
          className="nodrag h-12 w-full resize-y rounded-lg border border-line bg-panel-2 p-2 text-xs outline-none"
          placeholder="台词 / 旁白"
          value={data.line}
          onChange={(e) => updateNodeData(id, { line: e.target.value })}
        />
      </div>
      <Handle type="source" position={Position.Right} id="out" className="!h-3 !w-3 !border-2 !border-ink !bg-accent" />
    </div>
  );
}

export function shotPrompt(data: ShotNodeData): string {
  return [data.visual.trim(), data.line.trim() && `台词：${data.line.trim()}`].filter(Boolean).join("\n");
}
