import type {
  Diagnosis,
  DiagnosisLevel,
  GapPoint,
  MonthlyFlowPoint,
  RevenueDriverAnalysis,
} from '@/lib/stellantis-forecast/types';
import { fmtSigned } from './format';

/**
 * 진단 신호 카드 (server component — 상호작용이 없어 클라이언트 JS를 태우지 않는다).
 *
 * 카드 1은 판정 **근거(reasons)를 전부** 펼친다. 3색 신호만 던지고 근거를 숨기면 사람이 검증할 수
 * 없는 블랙박스가 된다 — 이 화면은 감산 위험을 경고하는 곳이라 근거 없는 신호는 쓸모가 없다.
 *
 * 카드 2·3은 **같은 질문에 다른 소스로 답한 두 값을 나란히** 둔다(월별 생산 갭 / 분기 출하 갭).
 * 둘이 어긋나면 그 사실 자체가 정보이므로 하나로 합치지 않는다.
 */

/** 3색 신호의 시각 토큰. 신호등 의미가 곧 색이라 차트 막대 색 규칙(파란 계열)과는 별개다. */
const LEVEL_STYLE: Record<
  DiagnosisLevel,
  { label: string; badge: string; ring: string; headline: string }
> = {
  red: {
    label: '위험',
    badge: 'bg-red-600 text-white',
    ring: 'ring-red-500/40',
    headline: 'text-red-600',
  },
  yellow: {
    label: '주의',
    badge: 'bg-amber-500 text-white',
    ring: 'ring-amber-500/40',
    headline: 'text-amber-600',
  },
  green: {
    label: '양호',
    badge: 'bg-emerald-600 text-white',
    ring: 'ring-emerald-500/40',
    headline: 'text-emerald-600',
  },
};

/** 갭 부호 → 색. 축적(양수)이 나쁜 신호라 빨강이다(차트 갭 선과 같은 의미 규칙). */
function gapTone(gap: number): string {
  if (gap > 0) return 'text-red-600';
  if (gap < 0) return 'text-emerald-600';
  return '';
}

interface Props {
  diagnosis: Diagnosis;
  gap: GapPoint[];
  monthlyFlow: MonthlyFlowPoint[];
  drivers: RevenueDriverAnalysis;
}

export default function DiagnosisCards({ diagnosis, gap, monthlyFlow, drivers }: Props) {
  const level = LEVEL_STYLE[diagnosis.level];
  const latestQuarter = gap.at(-1) ?? null;
  const latestMonth = monthlyFlow.at(-1) ?? null;
  const leader = drivers.leader;

  return (
    <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {/* 카드 1 — 재고 상태(3색) + 판정 근거 전문 */}
      <div className={`rounded-xl bg-card p-4 ring-1 lg:col-span-3 ${level.ring}`}>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">재고 상태</span>
          <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${level.badge}`}>
            {level.label}
          </span>
        </div>
        <div className={`text-2xl font-semibold ${level.headline}`}>{diagnosis.headline}</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {diagnosis.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

      {/* 카드 2 — 최신 월 생산 갭. 분기 출하 갭보다 최소 한 분기 최신이다. */}
      <Card title="생산 − 소매 (월별)" sub={latestMonth ? `${latestMonth.label} 기준` : '—'}>
        {latestMonth ? (
          <>
            <div className={`text-2xl font-semibold ${gapTone(latestMonth.gap)}`}>
              {fmtSigned(latestMonth.gap)}대
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {latestMonth.gap > 0
                ? '생산 > 소매 → 파이프라인 재고 축적'
                : latestMonth.gap < 0
                  ? '생산 < 소매 → 파이프라인 재고 소진'
                  : '생산 = 소매 → 균형'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              MarkLines 단일 소스라 가장 최신입니다. 다만 공장 국가 − 판매 시장이라 근사입니다.
            </div>
          </>
        ) : (
          <div className="text-2xl font-semibold text-muted-foreground">—</div>
        )}
      </Card>

      {/* 카드 3 — 최신 분기 출하 갭. 정확한 항등식이지만 늘 한 분기 이상 늦다. */}
      <Card title="출하 − 소매 (분기)" sub={latestQuarter ? `${latestQuarter.label} 기준` : '—'}>
        {latestQuarter ? (
          <>
            <div className={`text-2xl font-semibold ${gapTone(latestQuarter.gap)}`}>
              {fmtSigned(latestQuarter.gap)}대
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {latestQuarter.gap > 0
                ? '출하 > 소매 → 딜러 재고 축적'
                : latestQuarter.gap < 0
                  ? '출하 < 소매 → 딜러 재고 소진'
                  : '출하 = 소매 → 재고 균형'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              누적 {fmtSigned(latestQuarter.cumGap)}대 (시작점이 임의라 방향만 읽습니다)
              {latestQuarter.isDerived ? ' · 이 분기 출하는 차분 도출값' : ''}
            </div>
          </>
        ) : (
          <div className="text-2xl font-semibold text-muted-foreground">—</div>
        )}
      </Card>

      {/* 카드 4 — 자사 매출이 따라가는 축. r·n을 함께 보여야 채택 근거를 검증할 수 있다. */}
      <Card title="자사 매출이 따라가는 축" sub={leader ? leader.axisLabel : '표본 부족'}>
        {leader?.lag ? (
          <>
            <div className="text-2xl font-semibold">
              {leader.lag.lagMonths === 0
                ? '동행'
                : `${Math.abs(leader.lag.lagMonths)}개월 ${leader.lag.lagMonths > 0 ? '선행' : '후행'}`}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              자사 매출이 {leader.axisLabel}보다{' '}
              {leader.lag.lagMonths > 0 ? '먼저' : leader.lag.lagMonths < 0 ? '나중에' : '같이'}{' '}
              움직입니다 · r = {leader.lag.r.toFixed(2)} · 표본 {leader.lag.n}개
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              YoY 증감률 기준 |r| 최대 시차. 3축 전체 프로파일은 아래 표에 있습니다.
            </div>
          </>
        ) : (
          <>
            <div className="text-2xl font-semibold text-muted-foreground">표본 부족</div>
            <div className="mt-1 text-sm text-muted-foreground">
              어느 축에서도 시차를 채택할 만한 표본이 나오지 않았습니다.
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

/** KPI 카드 껍데기 — 경영관리 다른 탭(`InventoryKpiCards`)과 같은 형태. */
function Card({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
      {children}
    </div>
  );
}
