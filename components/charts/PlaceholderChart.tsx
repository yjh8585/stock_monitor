interface PlaceholderChartProps {
  title: string;
  unit: string;
  note?: string;
  height?: number;
}

/** 데이터 수집 미구현 시리즈 자리에 들어가는 안내 카드. */
export default function PlaceholderChart({
  title,
  unit,
  note,
  height = 240,
}: PlaceholderChartProps) {
  return (
    <div
      className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10"
      style={{ minHeight: height + 80 }}
    >
      <div className="text-base font-medium truncate">{title}</div>
      <div
        className="flex-1 flex flex-col items-center justify-center text-center gap-1 rounded-md border border-dashed border-border bg-muted/20"
        style={{ minHeight: height }}
      >
        <div className="text-sm text-muted-foreground">데이터 수집 준비 중</div>
        {note && <div className="text-[10px] text-muted-foreground px-3">{note}</div>}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>단위: {unit}</span>
        <span>출처: —</span>
      </div>
    </div>
  );
}
