'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { ChartSection } from '@/components/management/plan/_selectors';
import { buildCashBridge, buildCashWaterfall, DUMMY_NOTE_PREFIX } from '@/lib/finance/aggregate';
import type {
  CashBridgeCell,
  CashBridgeRow,
  FinanceRow,
  PnlDerivedSeries,
} from '@/lib/finance/types';
import { ROW_HIGHLIGHT_CLASS, useRowHighlight } from '@/lib/useRowHighlight';
import { cn } from '@/lib/utils';

const FinanceCashWaterfallChart = dynamic(() => import('./FinanceCashWaterfallChart'), {
  ssr: false,
});

function fmt(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('ko-KR');
}

interface Props {
  rows: FinanceRow[];
  pnlDerived: PnlDerivedSeries;
}

/**
 * 3. 자금수지(Cash Bridge) — 폭포 차트(최신 기간) + 표(기간별). 전체·연결 고정.
 *
 * - 값은 현금 기준 부호(유입 +, 유출 −). 음수는 빨강.
 * - 비고: 칸에 마우스를 올리면 그 기간 비고(내역)가 뜬다(ⓘ 표시 칸). 맨 오른쪽 칸 = 최신 기간 비고.
 * - 항목 이름에 마우스를 올리면 엑셀 '재무' 시트의 어느 계정에서 오는지 안내 — 입력 담당자용.
 * - 비고가 `[더미]`로 시작하는 값 = 입력 예시용 가짜 값 → 주황 기울임. 더미가 섞인 소계도 주황.
 */
export default function FinanceCashBridge({ rows, pnlDerived }: Props) {
  const bridge = useMemo(() => buildCashBridge(rows, pnlDerived, '전체'), [rows, pnlDerived]);
  const steps = useMemo(() => buildCashWaterfall(bridge), [bridge]);
  const { highlighted, rowToggleProps } = useRowHighlight();

  if (bridge.periods.length === 0) {
    return (
      <ChartSection title="3. 자금수지" unit="억원 · 전체/연결">
        <div className="py-12 text-center text-base text-muted-foreground">
          {rows.length === 0
            ? '데이터가 없습니다.'
            : '비교할 직전 연말 잔액이 없어 자금수지를 계산할 수 없습니다(전년 12월 행 필요).'}
        </div>
      </ChartSection>
    );
  }

  const last = bridge.periods.length - 1;
  const hasDummy = bridge.rows.some((r) => r.cells.some((c) => c.dummy));
  const periodHead = (i: number) =>
    bridge.isYtd[i] ? `${bridge.periods[i]} 누계` : `${bridge.periods[i].slice(0, 4)} 연간`;

  return (
    <ChartSection title="3. 자금수지" unit="억원 · 전체/연결">
      {hasDummy ? (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <b>주황 기울임 숫자는 더미(입력 예시)입니다.</b> 실제 값이 아니라 「이런 값을 이렇게
          넣는다」는 예시이며, 엑셀 비고가 <code>{DUMMY_NOTE_PREFIX}</code>로 시작합니다. 실제 값을
          넣고 <code>{DUMMY_NOTE_PREFIX}</code>를 지우면 일반 숫자로 바뀝니다.
        </p>
      ) : null}

      {steps.length > 0 ? (
        <div className="mb-4">
          <FinanceCashWaterfallChart steps={steps} periodLabel={periodHead(last)} />
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-muted-foreground">
              <th className="px-2 py-2 text-left font-medium">구분</th>
              {bridge.periods.map((p, i) => (
                <th
                  key={p}
                  className="px-2 py-2 text-right font-semibold text-foreground whitespace-nowrap"
                >
                  {periodHead(i)}
                </th>
              ))}
              <th className="px-2 py-2 text-left font-medium">비고 ({bridge.periods[last]})</th>
            </tr>
          </thead>
          <tbody>
            {bridge.rows.map((r, idx) => (
              <BridgeRow
                key={r.key}
                row={r}
                // 아래쪽 행은 설명 상자를 위로 연다 — 가로 스크롤 상자(overflow-x-auto) 밑으로 잘리지 않게.
                up={idx >= bridge.rows.length - 4}
                periods={bridge.periods.map((_, i) => periodHead(i))}
                isHl={highlighted.has(r.key)}
                toggleProps={rowToggleProps(r.key, r.label)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        <li>
          부호 = 현금 기준(들어오면 +, 나가면 −) · 과거는 연간, 올해는 해당 월까지 누계 · 항목
          이름에 마우스를 올리면 엑셀 어디에 입력하는지, ⓘ 칸에 올리면 비고(내역)가 보입니다.
        </li>
        <li>
          「미설명 차이」 = 실제 현금 변화 − 나머지 항목 합계. 크면 엑셀에 빠진 항목이 있다는
          뜻입니다(법인세·일회성 지급 등).
        </li>
        <li>
          엑셀 입력: <b>&apos;재무&apos; 시트</b>, 연결/별도=연결 · 자회사=전체 행에 계정별로 그
          달까지 누계를 적고, 내역은 8열 「비고」에 적습니다.
        </li>
      </ul>
    </ChartSection>
  );
}

function BridgeRow({
  row,
  up,
  periods,
  isHl,
  toggleProps,
}: {
  row: CashBridgeRow;
  up: boolean;
  periods: string[];
  isHl: boolean;
  toggleProps: ReturnType<ReturnType<typeof useRowHighlight>['rowToggleProps']>;
}) {
  const isSub = row.kind === 'subtotal';
  const isTotal = row.kind === 'total';
  const latestNote = row.cells[row.cells.length - 1]?.note ?? null;
  return (
    <tr
      className={cn(
        'border-b border-border/60 cursor-pointer',
        (isSub || isTotal) && 'font-semibold',
        isTotal && 'border-t-2 border-border',
        isHl
          ? ROW_HIGHLIGHT_CLASS
          : cn(
              isSub && 'bg-blue-50 dark:bg-blue-950/30',
              isTotal && 'bg-blue-100 dark:bg-blue-900/40',
              row.kind === 'balance' && 'bg-muted/50'
            )
      )}
      {...toggleProps}
    >
      <td
        className={cn(
          'py-1.5 pr-2 text-left whitespace-nowrap',
          isSub || isTotal ? 'pl-2' : 'pl-5'
        )}
      >
        <HoverInfo label={row.label} body={row.source} align="left" up={up}>
          <span className="border-b border-dotted border-muted-foreground/50">{row.label}</span>
        </HoverInfo>
      </td>
      {row.cells.map((c, i) => (
        <ValueCell key={periods[i]} cell={c} title={`${row.label} · ${periods[i]}`} up={up} />
      ))}
      <td className="px-2 py-1.5 text-left text-xs text-muted-foreground max-w-[320px]">
        {latestNote ? <span className="line-clamp-2 whitespace-pre-line">{latestNote}</span> : null}
      </td>
    </tr>
  );
}

function ValueCell({ cell, title, up }: { cell: CashBridgeCell; title: string; up: boolean }) {
  const neg = cell.value !== null && cell.value < 0;
  const text = (
    <span
      className={cn(
        'tabular-nums',
        cell.dummy ? 'italic text-amber-600 dark:text-amber-400' : neg ? 'text-red-600' : undefined
      )}
    >
      {fmt(cell.value)}
      {cell.note ? (
        <span className="ml-0.5 align-super text-[10px] text-muted-foreground">ⓘ</span>
      ) : null}
    </span>
  );
  return (
    <td className="px-2 py-1.5 text-right whitespace-nowrap">
      {cell.note || cell.dummy ? (
        <HoverInfo
          label={title}
          body={[cell.dummy ? '더미(입력 예시) 값이 들어 있습니다.' : null, cell.note]
            .filter(Boolean)
            .join('\n')}
          align="right"
          up={up}
        >
          {text}
        </HoverInfo>
      ) : (
        text
      )}
    </td>
  );
}

/** 마우스를 올리거나 키보드로 초점을 주면 뜨는 작은 설명 상자(CSS 만 — 외부 툴팁 라이브러리 없음). */
function HoverInfo({
  label,
  body,
  align,
  up,
  children,
}: {
  label: string;
  body: string;
  align: 'left' | 'right';
  up: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className="group/info relative inline-block"
      tabIndex={0}
      // 설명 상자에 초점을 둔 채 Enter·Space 를 눌러도 행 강조(useRowHighlight)가 같이 켜지지 않게.
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none invisible absolute z-30 w-72 rounded-md border border-border bg-card p-2 text-left text-sm font-normal not-italic text-foreground shadow-lg whitespace-pre-line',
          'group-hover/info:visible group-focus/info:visible',
          up ? 'bottom-full mb-1' : 'top-full mt-1',
          align === 'right' ? 'right-0' : 'left-0'
        )}
      >
        <span className="mb-1 block font-semibold">{label}</span>
        {body}
      </span>
    </span>
  );
}
