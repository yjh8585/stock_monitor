// 서버 컴포넌트 — 상호작용은 원문 인용 접기뿐이라 <details> 로 충분하다.
import { cn } from '@/lib/utils';
import type { GuidanceCard, GuidanceRowTs, GuidanceTarget, ReportedRow } from '@/lib/customers/ir';
import {
  amountText,
  approxPrefix,
  guidanceDirection,
  latestActual,
  mergeGuidanceChains,
  METRIC_INFO,
  metricKo,
  periodText,
  rangeText,
  STATED_LABEL,
  toUnit,
  type DirectionTone,
} from '@/lib/customers/format';
import { guidanceSignal, SIGNAL_LABEL, type SignalColor } from '@/lib/customers/signals';
import type { CustomerEarningsPoint } from '@/lib/customers/types';

/** 신호등 색(A10) — 기존 상승·하락 토큰(emerald·rose)에 노랑(amber)만 더한다. 카드 왼쪽 띠 + 점. */
const SIGNAL: Record<SignalColor, { bar: string; dot: string; label: string }> = {
  red: { bar: 'border-l-rose-600', dot: 'bg-rose-600', label: SIGNAL_LABEL.red },
  yellow: { bar: 'border-l-amber-500', dot: 'bg-amber-500', label: SIGNAL_LABEL.yellow },
  green: { bar: 'border-l-emerald-600', dot: 'bg-emerald-600', label: SIGNAL_LABEL.green },
  gray: { bar: 'border-l-border', dot: 'bg-muted-foreground/40', label: SIGNAL_LABEL.gray },
};

// 색은 기존 상승·하락 토큰(pctClass 와 같은 emerald·rose) — 새 색을 정의하지 않는다.
const TONE: Record<DirectionTone, string> = {
  up: 'border-emerald-600/40 text-emerald-600',
  down: 'border-rose-600/40 text-rose-600',
  flat: 'border-border text-muted-foreground',
  new: 'border-blue-600/40 text-blue-600',
};

interface Props {
  cards: GuidanceCard[];
  /** 상태 행(metric='other' — 철회·「가이던스 확인」) — 날짜순. */
  notes: GuidanceRowTs[];
  /** 「최근 실적」 한 줄 재료 — 서버에서만 쓴다(원본을 화면에 뿌리지 않는다). */
  reported: ReportedRow[];
  /** 신호등의 「전년 실적」 — 상세 실적 표와 같은 연간 점(회사 공시 우선)과 그 통화. */
  annual: CustomerEarningsPoint[];
  earningsCurrency: string | null;
}

const AI_TITLE = '원문에서 AI 가 뽑고 검증을 통과한 값';

/** chainStart = 전망 기준이 바뀐 사슬의 뒤쪽 지표 첫 행(→ 「기준 변경」 배지). */
function Badge({
  row,
  notes,
  chainStart = false,
}: {
  row: GuidanceRowTs;
  notes: GuidanceRowTs[];
  chainStart?: boolean;
}) {
  const d = guidanceDirection(row, notes, { chainStart });
  return (
    <span className={cn('rounded border px-1.5 text-[11px] leading-5', TONE[d.tone])}>
      {d.label}
    </span>
  );
}

/** 범위(숫자가 없으면 원문 문구). 통화: 행 currency → 카드 통화(회사 보고 통화). */
function valueText(row: GuidanceRowTs, currency: string | null): string {
  if (row.low == null && row.high == null) return row.value_text ?? '—';
  return (
    approxPrefix(row.value_text) + rangeText(row.low, row.high, row.unit, row.currency ?? currency)
  );
}

function RowMeta({ row }: { row: GuidanceRowTs }) {
  return (
    <>
      {row.basis && <span>{row.basis === 'adjusted' ? '조정' : '장부'}</span>}
      <span>{row.published_at} 공시</span>
      {row.extractor === 'llm' && <span title={AI_TITLE}>AI 추출</span>}
    </>
  );
}

/** chained = 이 이력이 사슬의 뒤쪽 지표 — 첫 행이 「기준 변경」. */
function History({
  rows,
  currency,
  notes,
  chained,
}: {
  rows: GuidanceRowTs[];
  currency: string | null;
  notes: GuidanceRowTs[];
  chained: boolean;
}) {
  return (
    <ol className="space-y-0.5">
      {rows.map((h, i) => (
        <li
          key={`${h.metric}|${h.published_at}|${h.extractor}|${i}`}
          className="flex flex-wrap items-center gap-x-2 tabular-nums"
        >
          <span className="text-muted-foreground">{h.published_at}</span>
          <Badge row={h} notes={notes} chainStart={chained && i === 0} />
          <span>{valueText(h, currency)}</span>
          {h.extractor === 'llm' && (
            <span className="text-muted-foreground" title={AI_TITLE}>
              AI 추출
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function LongerTerm({ targets, currency }: { targets: GuidanceTarget[]; currency: string | null }) {
  if (targets.length === 0) return null;
  return (
    <p className="text-xs">
      <span className="text-muted-foreground">중장기 · </span>
      {targets.map((t, i) => (
        <span key={t.period} className={cn(t.withdrawn_at && 'line-through text-muted-foreground')}>
          {i > 0 && ' · '}
          {t.period} {valueText(t.current, currency)}
          {t.withdrawn_at && ` (${t.withdrawn_at} 철회)`}
        </span>
      ))}
    </p>
  );
}

function Card({
  card,
  predecessors,
  notes,
  reported,
  annual,
  earningsCurrency,
}: {
  card: GuidanceCard;
  predecessors: GuidanceCard[];
  notes: GuidanceRowTs[];
  reported: ReportedRow[];
  annual: CustomerEarningsPoint[];
  earningsCurrency: string | null;
}) {
  const cur = card.current;
  const actual = latestActual(reported, card.metric, card.currency);
  const withdrawn = card.withdrawn_at != null;
  const fy = Number(card.period.replace(/^FY/, ''));
  const prior = annual.find((p) => p.fiscal_year === fy - 1) ?? null;
  const signal = guidanceSignal(card, prior, earningsCurrency);
  const sig = SIGNAL[signal.color];
  const desc = METRIC_INFO[card.metric]?.desc;
  return (
    <div
      className={cn(
        'rounded-md border border-border border-l-4 p-3 space-y-2 text-sm',
        sig.bar,
        withdrawn && 'bg-muted/30'
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn('inline-block size-2.5 rounded-full', sig.dot)}
          role="img"
          aria-label={`신호 ${sig.label}`}
        />
        <span className="font-medium" title={desc}>
          {metricKo(card.metric, cur.metric_label)}
          {desc && <span className="ml-0.5 text-xs text-muted-foreground">ⓘ</span>}
        </span>
        {METRIC_INFO[card.metric] && (
          <span className="text-xs text-muted-foreground">{cur.metric_label}</span>
        )}
        <span className="text-xs text-muted-foreground">{card.period}</span>
        {withdrawn ? (
          <span className={cn('rounded border px-1.5 text-[11px] leading-5', TONE.down)}>
            철회됨
          </span>
        ) : (
          <Badge
            row={cur}
            notes={notes}
            chainStart={predecessors.length > 0 && cur === card.history[0]}
          />
        )}
      </div>
      <p
        className={cn(
          'text-base font-semibold tabular-nums',
          withdrawn && 'line-through text-muted-foreground'
        )}
      >
        {valueText(cur, card.currency)}
      </p>
      <p className="text-xs">
        <span className="font-medium">{sig.label}</span>
        <span className="text-muted-foreground"> · {signal.reason}</span>
      </p>
      {desc && (
        // A11 — 용어 설명(special effects 등). 펼쳐 읽는다.
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">ⓘ 용어 설명</summary>
          <p className="mt-1 text-muted-foreground">{desc}</p>
        </details>
      )}
      <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <RowMeta row={cur} />
        {withdrawn && <span>{card.withdrawn_at} 철회</span>}
      </p>
      {actual && (
        <p className="text-xs tabular-nums">
          <span className="text-muted-foreground">최근 실적 · </span>
          {periodText(actual.period)} {actual.metric_name}{' '}
          {/* 전망이 십억·조 단위면 실적(백만)도 같은 단위로 맞춰 눈으로 견주게 한다 */}
          {(() => {
            const a = toUnit(actual.value, actual.unit, cur.unit);
            return amountText(a.value, a.unit, actual.currency);
          })()}
        </p>
      )}
      <LongerTerm targets={card.longer_term} currency={card.currency} />
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          이력 {predecessors.reduce((n, p) => n + p.history.length, card.history.length)}건 · 원문
          인용
        </summary>
        <div className="mt-2 space-y-2">
          {predecessors.map((p, i) => (
            <div key={p.metric} className="space-y-1">
              <p className="text-muted-foreground">
                {p.current.metric_label} ({p.metric})
              </p>
              <History rows={p.history} currency={p.currency} notes={notes} chained={i > 0} />
              <LongerTerm targets={p.longer_term} currency={p.currency} />
              <p className="rounded bg-muted px-1.5 py-0.5">
                전망 기준 변경 → {(predecessors[i + 1] ?? card).current.metric_label}
              </p>
            </div>
          ))}
          <History
            rows={card.history}
            currency={card.currency}
            notes={notes}
            chained={predecessors.length > 0}
          />
          <blockquote className="border-l-2 border-border pl-2 text-muted-foreground whitespace-pre-line">
            {cur.quote}
          </blockquote>
        </div>
      </details>
      {predecessors.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          전망 기준 변경 — {predecessors.map((p) => p.current.metric_label).join(' → ')} →{' '}
          {cur.metric_label}
        </p>
      )}
    </div>
  );
}

/**
 * 가이던스 카드 — (지표, 통화) 별 대표 FY 전망 + 이력 · 중장기 목표 · 철회 묶음 · 상태 메모.
 * 같은 FY 에 철회가 있으면 그 FY 의 카드를 「FY 전망 철회」 묶음으로 따로 모은다.
 */
export default function CustomerGuidanceCards({
  cards,
  notes,
  reported,
  annual,
  earningsCurrency,
}: Props) {
  if (cards.length === 0 && notes.length === 0)
    return <p className="text-sm text-muted-foreground">검증된 가이던스가 없다.</p>;
  const views = mergeGuidanceChains(cards);
  const live = views.filter((v) => v.card.withdrawn_at == null);
  const withdrawnByFy = new Map<string, typeof views>();
  for (const v of views.filter((x) => x.card.withdrawn_at != null))
    withdrawnByFy.set(v.card.period, [...(withdrawnByFy.get(v.card.period) ?? []), v]);
  const grid = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3';
  return (
    <div className="space-y-3">
      {live.length > 0 && (
        <div className={grid}>
          {live.map((v) => (
            <Card
              key={`${v.card.metric}|${v.card.currency}`}
              card={v.card}
              predecessors={v.predecessors}
              notes={notes}
              reported={reported}
              annual={annual}
              earningsCurrency={earningsCurrency}
            />
          ))}
        </div>
      )}
      {[...withdrawnByFy].map(([fy, list]) => (
        <div key={fy} className="space-y-2">
          <p className="text-sm font-medium text-rose-600">
            {fy} 전망 철회 ({list.map((v) => v.card.withdrawn_at).sort()[0]})
          </p>
          <div className={grid}>
            {list.map((v) => (
              <Card
                key={`${v.card.metric}|${v.card.currency}`}
                card={v.card}
                predecessors={v.predecessors}
                notes={notes}
                reported={reported}
                annual={annual}
                earningsCurrency={earningsCurrency}
              />
            ))}
          </div>
        </div>
      ))}
      {notes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {notes.map((n, i) => (
            <li key={`${n.period}|${n.published_at}|${n.metric_label}|${n.extractor}|${i}`}>
              {n.published_at} · {n.period} {n.metric_label} —{' '}
              {STATED_LABEL[n.stated ?? ''] ?? n.stated ?? '상태 미상'}
              {n.value_text && ` (원문 「${n.value_text}」)`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
