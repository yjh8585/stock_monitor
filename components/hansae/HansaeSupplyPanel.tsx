'use client';

import type { SupplyDemandRow } from '@/lib/hansae/data';

interface Props {
  supply: SupplyDemandRow[];
  companyName: string;
}

const fmt = (n: number | null) => {
  if (n === null) return '—';
  const abs = Math.abs(n);
  if (abs >= 100_000) return `${(n / 10_000).toFixed(1)}만`;
  return new Intl.NumberFormat('ko-KR').format(n);
};

function Bar({ value, max, color }: { value: number | null; max: number; color: string }) {
  if (value === null || max === 0) {
    return <div className="h-2 w-full bg-muted/40 rounded" />;
  }
  const pct = Math.min(100, (Math.abs(value) / max) * 100);
  const negative = value < 0;
  return (
    <div className="relative h-2 w-full bg-muted/40 rounded overflow-hidden">
      <div
        className={`absolute top-0 bottom-0 ${color}`}
        style={{
          width: `${pct / 2}%`,
          [negative ? 'right' : 'left']: '50%',
        }}
      />
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
    </div>
  );
}

export default function HansaeSupplyPanel({ supply, companyName }: Props) {
  // 절대값 기준 색 농도 정규화
  const maxAbs = supply.reduce((m, r) => {
    return Math.max(
      m,
      Math.abs(r.foreignNet ?? 0),
      Math.abs(r.institutionNet ?? 0),
      Math.abs(r.individualNet ?? 0)
    );
  }, 0);

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold">수급 (외국인 / 기관 / 개인 순매수)</h2>
        <span className="text-[11px] text-muted-foreground">{companyName} · 최근 5거래일</span>
      </div>
      {supply.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          수급 데이터 없음 (PYKRX 야간 배치가 한 번 이상 실행되어야 함)
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-muted-foreground">
              <th className="text-left py-1">날짜</th>
              <th className="text-left py-1 w-1/4">외국인</th>
              <th className="text-left py-1 w-1/4">기관</th>
              <th className="text-left py-1 w-1/4">개인</th>
            </tr>
          </thead>
          <tbody>
            {supply.map((r) => (
              <tr key={r.tradeDate} className="border-t border-border/50">
                <td className="py-1 text-muted-foreground">
                  {new Date(r.tradeDate).toLocaleDateString('ko-KR', {
                    month: '2-digit',
                    day: '2-digit',
                  })}
                </td>
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <Bar value={r.foreignNet} max={maxAbs} color="bg-amber-500" />
                    <span className="w-12 text-right tabular-nums">{fmt(r.foreignNet)}</span>
                  </div>
                </td>
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <Bar value={r.institutionNet} max={maxAbs} color="bg-emerald-500" />
                    <span className="w-12 text-right tabular-nums">{fmt(r.institutionNet)}</span>
                  </div>
                </td>
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <Bar value={r.individualNet} max={maxAbs} color="bg-sky-500" />
                    <span className="w-12 text-right tabular-nums">{fmt(r.individualNet)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
