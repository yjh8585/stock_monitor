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

const fmtPrice = (n: number | null) =>
  n === null ? '—' : new Intl.NumberFormat('ko-KR').format(Math.round(n));

const fmtPct = (n: number | null) => {
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
};

const pctColor = (n: number | null) =>
  n === null
    ? 'text-muted-foreground'
    : n > 0
      ? 'text-red-500'
      : n < 0
        ? 'text-blue-500'
        : 'text-foreground';

type InvestorKey = 'foreignNet' | 'institutionNet' | 'individualNet';

// 한국 차트 관례: 매수(양수)=빨강, 매도(음수)=파랑. 모든 투자자 동일 색.
const POSITIVE_BAR = 'bg-red-500';
const NEGATIVE_BAR = 'bg-blue-500';

const INVESTORS: Array<{
  key: InvestorKey;
  label: string;
  accent: string; // 헤더 점·라벨 색 (투자자 구분용)
}> = [
  { key: 'foreignNet', label: '외국인', accent: 'bg-amber-500' },
  { key: 'institutionNet', label: '기관', accent: 'bg-emerald-500' },
  { key: 'individualNet', label: '개인', accent: 'bg-sky-500' },
];

/** 외국인/기관/개인 한 명에 대한 5일 가로 막대 차트 (양수: 오른쪽, 음수: 왼쪽). */
/** KST 기준 오늘(YYYY-MM-DD). SSR/CSR 동일 결과 보장(타임존 명시). */
function kstToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function InvestorBars({
  rows,
  investor,
  maxAbs,
  todayStr,
}: {
  rows: SupplyDemandRow[];
  investor: (typeof INVESTORS)[number];
  maxAbs: number;
  todayStr: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-block w-2.5 h-2.5 rounded ${investor.accent}`} />
        <span className="text-base font-semibold">{investor.label}</span>
      </div>
      <div className="grid grid-cols-[3.5rem_1fr_4.5rem] gap-2 items-center text-sm">
        {rows.map((r) => {
          const v = r[investor.key];
          const widthPct = v !== null && maxAbs > 0 ? (Math.abs(v) / maxAbs) * 50 : 0;
          const negative = v !== null && v < 0;
          const isToday = r.tradeDate === todayStr;
          return (
            <div key={r.tradeDate} className="contents">
              <span
                className={`tabular-nums ${isToday ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-muted-foreground'}`}
              >
                {isToday
                  ? '오늘'
                  : new Date(r.tradeDate).toLocaleDateString('ko-KR', {
                      month: '2-digit',
                      day: '2-digit',
                    })}
              </span>
              <div className="relative h-4 w-full bg-muted/30 rounded overflow-hidden">
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
                {v !== null && (
                  <div
                    className={`absolute top-0 bottom-0 ${negative ? NEGATIVE_BAR : POSITIVE_BAR}`}
                    style={{
                      width: `${widthPct}%`,
                      [negative ? 'right' : 'left']: '50%',
                    }}
                  />
                )}
              </div>
              <span
                className={`text-right tabular-nums font-medium ${
                  v === null
                    ? 'text-muted-foreground'
                    : v > 0
                      ? 'text-red-500'
                      : v < 0
                        ? 'text-blue-500'
                        : 'text-foreground'
                }`}
              >
                {fmt(v)}
              </span>
            </div>
          );
        })}
      </div>
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

  // 최신순으로 위에서 아래 (initial은 ascending 정렬 → reverse)
  const ordered = [...supply].reverse();
  const todayStr = kstToday();

  return (
    <div className="h-full rounded-md border border-border bg-card p-4 flex flex-col min-h-0 overflow-auto">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">수급 일별 (최근 5일)</h2>
        <span className="text-sm text-muted-foreground">{companyName}</span>
      </div>

      <>
        {supply.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            수급 데이터 없음 (PYKRX 야간 배치가 한 번 이상 실행되어야 함)
          </div>
        ) : (
          <>
            {/* 가격 요약 — 일자별 종가/등락 */}
            <div className="mb-4 grid grid-cols-[3.5rem_1fr_1fr] gap-2 items-center text-sm border-b border-border/50 pb-3">
              <span className="text-[11px] text-muted-foreground">날짜</span>
              <span className="text-right text-[11px] text-muted-foreground">종가</span>
              <span className="text-right text-[11px] text-muted-foreground">등락</span>
              {ordered.map((r) => (
                <div key={r.tradeDate} className="contents">
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(r.tradeDate).toLocaleDateString('ko-KR', {
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </span>
                  <span className="text-right tabular-nums">{fmtPrice(r.closePrice)}</span>
                  <span className={`text-right tabular-nums ${pctColor(r.changePct)}`}>
                    {fmtPct(r.changePct)}
                  </span>
                </div>
              ))}
            </div>

            {/* 외국인/기관/개인 각자 가로 막대 차트 */}
            <div className="space-y-4">
              {INVESTORS.map((inv) => (
                <InvestorBars
                  key={inv.key}
                  rows={ordered}
                  investor={inv}
                  maxAbs={maxAbs}
                  todayStr={todayStr}
                />
              ))}
            </div>

            <p className="mt-3 text-[11px] text-muted-foreground">
              막대 길이 = 절대값 기준 상대 강도 · 양수(오른쪽) 순매수, 음수(왼쪽) 순매도 · 오늘
              분단위 잠정 추세는 위 가격 차트(1D) 하단 pane 참조
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              * 오늘 수치는 장중 잠정값이며, 장 마감 후 야간 배치로 확정값이 갱신됩니다.
            </p>
          </>
        )}
      </>
    </div>
  );
}
