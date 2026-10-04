import type { ReactNode } from "react";
import { iconX } from "../lib/icons";

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={props.onClose}
    >
      <div
        className={`flex max-h-[85vh] flex-col rounded-xl border border-line bg-panel shadow-2xl ${props.width ?? "w-[560px]"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="text-sm font-medium">{props.title}</h3>
          <button
            className="rounded-md p-1 text-fg-dim hover:bg-panel-2 hover:text-fg"
            onClick={props.onClose}
          >
            {iconX({})}
          </button>
        </div>
        <div className="overflow-y-auto p-5">{props.children}</div>
      </div>
    </div>
  );
}
