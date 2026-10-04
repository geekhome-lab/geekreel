import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";

export type TextNodeData = { text: string };

/** 文本节点：剧本/提示词等内容载体，输出可接入生成节点 */
export function TextNode({ id, data, selected }: NodeProps<Node<TextNodeData>>) {
  const { updateNodeData } = useReactFlow();
  return (
    <div
      className={`w-64 rounded-xl border bg-panel shadow-lg transition-colors ${
        selected ? "border-accent" : "border-line"
      }`}
    >
      <div className="border-b border-line px-3 py-1.5 text-[11px] font-medium text-fg-dim">文本</div>
      <textarea
        className="nodrag h-32 w-full resize-y rounded-b-xl bg-transparent p-3 text-xs leading-relaxed outline-none placeholder:text-fg-faint"
        placeholder="写剧本、提示词…"
        value={data.text}
        onChange={(e) => updateNodeData(id, { text: e.target.value })}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="!h-3 !w-3 !border-2 !border-ink !bg-accent"
      />
    </div>
  );
}
