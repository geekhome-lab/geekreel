import { useReactFlow, type NodeProps, type Node } from "@xyflow/react";

export type NoteNodeData = { text: string };

export function NoteNode({ id, data, selected }: NodeProps<Node<NoteNodeData>>) {
  const { updateNodeData } = useReactFlow();
  return (
    <div className={`w-56 rounded-xl border bg-amber-950/30 shadow-lg ${selected ? "border-accent" : "border-amber-900/40"}`}>
      <div className="border-b border-amber-900/40 px-3 py-1.5 text-[11px] font-medium text-amber-200/80">注释</div>
      <textarea
        className="nodrag h-24 w-full resize-y bg-transparent p-3 text-xs leading-relaxed outline-none placeholder:text-fg-faint"
        placeholder="给自己留一句…"
        value={data.text}
        onChange={(e) => updateNodeData(id, { text: e.target.value })}
      />
    </div>
  );
}
