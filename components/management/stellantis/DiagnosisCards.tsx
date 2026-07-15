import { MIN_LAG_SAMPLES } from '@/lib/stellantis-forecast/aggregate';
import type {
  Diagnosis,
  DiagnosisLevel,
  ForecastSeries,
  GapPoint,
  LagResult,
} from '@/lib/stellantis-forecast/types';
import { fmt, fmtSigned } from './format';

/**
 * 진단 신호 카드 4장 (server component — 상호작용이 없어 클라이언트 JS를 태우지 않는다).
 *
 * 카드 1은 판정 **근거(reasons)를 전부** 펼친다. 3색 신호만 던지고 근거를 숨기면 사람이 검증할 수
 * 없는 블랙박스가 된다 — 이 화면은 감산 위험을 경고하는 곳이라 근거 없는 신호는 쓸모가 없다.
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

interface Props {
  diagnosis: Diagnosis;
  gap: GapPoint[];
  lag: LagResult | null;
  forecast: ForecastSeries;
}

export default function DiagnosisCards({ diagnosis, gap, lag, forecast }: Props) {
  const level = LEVEL_STYLE[diagnosis.level];
  const latest = gap.at(-1) ?? null;
  // 카드 4는 '재고 유지' 시나리오 기준. 배열 순서에 기대지 않고 key로 찾는다(순서가 바뀌어도 의미 유지).
  const hold = forecast.scenarios.find((s) => s.key === 'inventoryHold') ?? forecast.scenarios[0];
  const nextQuarter = hold?.points[0] ?? null;

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

      {/* 카드 2 — 최신 분기 출하 vs 소매 갭 */}
      <Card title="출하 vs 소매 갭" sub={latest ? `${latest.label} 기준` : '—'}>
        {latest ? (
          <>
            <div
              className={`text-2xl font-semibold ${latest.gap > 0 ? 'text-red-600' : latest.gap < 0 ? 'text-emerald-600' : ''}`}
            >
              {fmtSigned(latest.gap)}대
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {latest.gap > 0
                ? '출하 > 소매 → 딜러 재고 축적'
                : latest.gap < 0
                  ? '출하 < 소매 → 딜러 재고 소진'
                  : '출하 = 소매 → 재고 균형'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              누적 재고 증감 {fmtSigned(latest.cumGap)}대 (시작점이 임의라 방향만 읽습니다)
            </div>
          </>
        ) : (
          <div className="text-2xl font-semibold text-muted-foreground">—</div>
        )}
      </Card>

      {/* 카드 3 — 탐지 시차. r·n을 함께 보여야 채택 근거를 검증할 수 있다. */}
      <Card title="탐지 시차" sub="자사 매출 → 소매">
        {lag === null ? (
          <>
            <div className="text-2xl font-semibold text-muted-foreground">표본 부족</div>
            <div className="mt-1 text-sm text-muted-foreground">
              겹치는 표본이 최소 {MIN_LAG_SAMPLES}개월에 못 미쳐 시차를 채택하지 않았습니다.
            </div>
          </>
        ) : (
          <>
            <div className="text-2xl font-semibold">{fmtSigned(lag.lagMonths)}개월</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {lag.lagMonths > 0
                ? '자사 매출이 소매보다 선행'
                : lag.lagMonths < 0
                  ? '자사 매출이 소매보다 후행'
                  : '자사 매출과 소매가 동행'}{' '}
              · 상관계수 r = {lag.r.toFixed(2)} · 표본 {lag.n}개월
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              양수 = 자사 매출 선행. YoY 증감률 기준 |r| 최대 시차를 채택했습니다.
            </div>
          </>
        )}
      </Card>

      {/* 카드 4 — 다음 분기 매출 전망(재고 유지 시나리오) */}
      <Card
        title="다음 분기 매출 전망"
        sub={nextQuarter ? `${nextQuarter.label} · 재고 유지` : '—'}
      >
        {nextQuarter ? (
          <>
            <div className="text-2xl font-semibold">{fmt(nextQuarter.revenueEok)} 억원</div>
            {forecast.lowConfidence ? (
              <div className="mt-1 text-sm font-medium text-amber-600">원단위 변동 큼 — 참고용</div>
            ) : (
              <div className="mt-1 text-sm text-muted-foreground">출하 전망 × 대당 원단위</div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              출하를 최근 소매 수준에 맞춰 재고를 동결한다는 가정 (다른 시나리오는 4번 차트)
            </div>
          </>
        ) : (
          <div className="text-2xl font-semibold text-muted-foreground">—</div>
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
