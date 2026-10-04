export function BrandMark(props: { size?: "sm" | "md" | "lg"; compact?: boolean; stacked?: boolean }) {
  const px = props.size === "lg" ? 56 : props.size === "md" ? 40 : 32;
  return (
    <div className={`flex items-center ${props.stacked ? "flex-col" : "gap-2.5"} ${props.compact ? "justify-center" : ""}`}>
      <img
        src="/logo.jpg"
        alt="GeekReel AI Studio"
        width={px}
        height={px}
        className="shrink-0 rounded-xl object-cover"
        style={{ width: px, height: px }}
      />
      {!props.compact ? (
        <div className={props.stacked ? "mt-2 text-center" : "min-w-0"}>
          <div className="text-sm font-semibold leading-tight tracking-wide">GeekReel</div>
          <div className="text-[10px] text-fg-faint">AI Studio</div>
        </div>
      ) : null}
    </div>
  );
}
