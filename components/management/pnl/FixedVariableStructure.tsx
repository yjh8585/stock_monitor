'use client';

import { useMemo, useState } from 'react';
import type { FixedVariableRow } from '@/lib/pnl/types';

interface Props {
  fixedVariable: FixedVariableRow[];
}

/**
 * 계정 계층 — '고정비' 시트 구조(매출원가/판매관리비 → 분류3 → 계정명). 안정적이라 하드코딩.
 * 단일 계정(재료비)은 분류3 행이 곧 계정명 leaf.
 */
const COST_TREE = [
  {
    cat2: '매출원가',
    label: '매출원가',
    groups: [
      { cat3: '재료비', label: '재료비', accounts: ['재료비'] },
      { cat3: '노무비', label: '노무비', accounts: ['사무', '생산'] },
      {
        cat3: '경비',
        label: '경비',
        accounts: [
          '감가상각비',
          '개발비상각',
          '외주가공비',
          '포장비',
          '유틸리티비',
          '수선비',
          '소모품비',
          '기타',
        ],
      },
    ],
  },
  {
    cat2: '판매관리비',
    label: '판관비',
    groups: [
      {
        cat3: '판매관리비',
        label: '판매관리비',
        accounts: ['판관 인건비', '운반비', '지급수수료', '워런티', '관리용역비', '기타'],
      },
      {
        cat3: '연구개발비',
        label: '연구개발비',
        accounts: ['연구 인건비', '개발비', '감가상각비', '기타'],
      },
    ],
  },
] as const;

type RowKind = 'revenue' | 'total' | 'op' | 'group' | 'leaf';

interface RowDef {
  id: string;
  label: string;
  depth: 0 | 1 | 2;
  kind: RowKind;
  emphasis: 'header' | 'total' | 'footer' | 'group' | 'subgroup' | 'normal';
  /** 금액 합산 매칭. op(영업이익)은 파생이라 null. */
  match: ((r: FixedVariableRow) => boolean) | null;
  /** 변동/고정비율 조회 키 (계정명 leaf만). */
  ratioKey: { cat2: string; cat3: string; account: string } | null;
}

const isCost = (r: FixedVariableRow) => r.cost_type === '고정비' || r.cost_type === '변동비';

/** 인건비(인건비 버튼으로 묶는 대상): 노무비 전체 + 판관 인건비 + 연구 인건비. */
function isLaborAccount(cat2: string, cat3: string, account: string): boolean {
  return (
    (cat2 === '매출원가' && cat3 === '노무비') ||
    (cat2 === '판매관리비' && cat3 === '판매관리비' && account === '판관 인건비') ||
    (cat2 === '판매관리비' && cat3 === '연구개발비' && account === '연구 인건비')
  );
}
/** 상각비(상각비 버튼으로 묶는 대상): 경비-감가상각비 + 경비-개발비상각 + 연구개발비-감가상각비. */
function isAmortAccount(cat2: string, cat3: string, account: string): boolean {
  return (
    (cat2 === '매출원가' &&
      cat3 === '경비' &&
      (account === '감가상각비' || account === '개발비상각')) ||
    (cat2 === '판매관리비' && cat3 === '연구개발비' && account === '감가상각비')
  );
}

/**
 * 행 정의 — 매출액 → 비용합계 → (인건비합계 · 상각비합계) → 비용 상세 → 영업이익.
 * @param detail true=상세(계정명까지) / false=기본(분류3까지)
 * @param labor  true=인건비 묶기(노무비·판관/연구 인건비 → 인건비합계)
 * @param amort  true=상각비 묶기(경비 감가상각비·개발비상각 + 연구개발비 감가상각비 → 상각비합계)
 *
 * 인건비합계·상각비합계는 비용 상단(매출원가 위)에 배치하고, 해당 계정은 원래 그룹(매출원가/판관비)에서 제외.
 */
function buildRowDefs(
  detail: boolean,
  labor: boolean,
  amort: boolean,
  totals: Map<string, number>
): RowDef[] {
  const extractors: {
    id: string;
    label: string;
    is: (c2: string, c3: string, a: string) => boolean;
  }[] = [];
  if (labor) extractors.push({ id: '인건비합계', label: '인건비합계', is: isLaborAccount });
  if (amort) extractors.push({ id: '상각비합계', label: '상각비합계', is: isAmortAccount });
  const extracted = (c2: string, c3: string, a: string) => extractors.some((e) => e.is(c2, c3, a));
  const extractedRow = (r: FixedVariableRow) => extracted(r.category2, r.category3, r.account);

  const defs: RowDef[] = [
    {
      id: '매출액',
      label: '매출액',
      depth: 0,
      kind: 'revenue',
      emphasis: 'header',
      match: (r) => r.cost_type === '매출',
      ratioKey: null,
    },
    {
      id: '비용합계',
      label: '비용합계',
      depth: 0,
      kind: 'total',
      emphasis: 'total',
      match: isCost,
      ratioKey: null,
    },
  ];

  // 인건비합계 · 상각비합계 (비용 상단)
  for (const e of extractors) {
    defs.push({
      id: e.id,
      label: e.label,
      depth: 0,
      kind: 'group',
      emphasis: 'group',
      match: (r) => isCost(r) && e.is(r.category2, r.category3, r.account),
      ratioKey: null,
    });
  }

  for (const node of COST_TREE) {
    defs.push({
      id: `g:${node.cat2}`,
      label: node.label,
      depth: 0,
      kind: 'group',
      emphasis: 'group',
      match: (r) => isCost(r) && r.category2 === node.cat2 && !extractedRow(r),
      ratioKey: null,
    });
    for (const g of node.groups) {
      const accts = g.accounts.filter((a) => !extracted(node.cat2, g.cat3, a));
      if (accts.length === 0) continue; // 그룹 전체가 인건비/상각비로 이동
      // 계정명을 최신연도 합계(고정+변동) 큰 순으로 내림차순. 단 '기타'는 금액과 무관하게 항상 맨 아래.
      // 동률·무데이터는 원순서 유지(stable sort).
      accts.sort((a, b) => {
        const aEtc = a === '기타';
        const bEtc = b === '기타';
        if (aEtc !== bEtc) return aEtc ? 1 : -1;
        return (
          (totals.get(`${node.cat2}|${g.cat3}|${b}`) ?? 0) -
          (totals.get(`${node.cat2}|${g.cat3}|${a}`) ?? 0)
        );
      });
      const single = accts.length === 1 && accts[0] === g.cat3;
      if (single) {
        const account = accts[0];
        defs.push({
          id: `${node.cat2}|${g.cat3}|${account}`,
          label: g.label,
          depth: 1,
          kind: 'leaf',
          emphasis: 'normal',
          match: (r) =>
            isCost(r) &&
            r.category2 === node.cat2 &&
            r.category3 === g.cat3 &&
            r.account === account,
          ratioKey: { cat2: node.cat2, cat3: g.cat3, account },
        });
      } else {
        defs.push({
          id: `g:${node.cat2}|${g.cat3}`,
          label: g.label,
          depth: 1,
          kind: 'group',
          emphasis: 'subgroup',
          match: (r) =>
            isCost(r) && r.category2 === node.cat2 && r.category3 === g.cat3 && !extractedRow(r),
          ratioKey: null,
        });
        if (detail) {
          for (const account of accts) {
            defs.push({
              id: `${node.cat2}|${g.cat3}|${account}`,
              label: account,
              depth: 2,
              kind: 'leaf',
              emphasis: 'normal',
              match: (r) =>
                isCost(r) &&
                r.category2 === node.cat2 &&
                r.category3 === g.cat3 &&
                r.account === account,
              ratioKey: { cat2: node.cat2, cat3: g.cat3, account },
            });
          }
        }
      }
    }
  }

  defs.push({
    id: '영업이익',
    label: '영업이익',
    depth: 0,
    kind: 'op',
    emphasis: 'footer',
    match: null,
    ratioKey: null,
  });
  return defs;
}

/** 비용 유형 하위 컬럼 (각 연도 그룹 아래 반복). null = 고정+변동 합계. */
const COST_COLS: readonly { label: string; costType: '고정비' | '변동비' | null }[] = [
  { label: '합계', costType: null },
  { label: '고정비', costType: '고정비' },
  { label: '변동비', costType: '변동비' },
];

/** 2026 monthly 행의 최대 월(YTD). 없으면 0. */
function maxYtdMonth(rows: readonly FixedVariableRow[]): number {
  let m = 0;
  for (const r of rows) {
    if (r.period_year === 2026 && r.period_kind === 'monthly' && r.period_month > m)
      m = r.period_month;
  }
  return m;
}

function buildYearGroups(rows: readonly FixedVariableRow[]) {
  const ytd = maxYtdMonth(rows);
  return [
    {
      label: '2023',
      match: (r: FixedVariableRow) => r.period_year === 2023 && r.period_kind === 'annual',
    },
    {
      label: '2024',
      match: (r: FixedVariableRow) => r.period_year === 2024 && r.period_kind === 'annual',
    },
    {
      label: '2025',
      match: (r: FixedVariableRow) => r.period_year === 2025 && r.period_kind === 'annual',
    },
    {
      label: ytd === 12 ? '2026' : '2026 YTD',
      match: (r: FixedVariableRow) =>
        r.period_year === 2026 &&
        r.period_kind === 'monthly' &&
        r.period_month >= 1 &&
        r.period_month <= ytd,
    },
  ];
}

/** 백만원 금액 — null/NaN은 '—'. */
function fmtMillion(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—';
  return Math.round(v).toLocaleString('ko-KR');
}

/** (match ∧ costType) 합산. 매칭 행 value가 전부 null이면 null. */
function sumCell(
  rows: readonly FixedVariableRow[],
  match: ((r: FixedVariableRow) => boolean) | null,
  costType: '고정비' | '변동비' | null
): number | null {
  if (!match) return null;
  let has = false;
  let sum = 0;
  for (const r of rows) {
    if (!match(r)) continue;
    if (costType !== null && r.cost_type !== costType) continue;
    if (r.value_mwon === null) continue;
    sum += r.value_mwon;
    has = true;
  }
  return has ? sum : null;
}

/** 우상단 2-state 토글 (BasisToggle 양식). */
function SegToggle({
  value,
  onChange,
  options,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  options: [{ v: boolean; label: string }, { v: boolean; label: string }];
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5">
      {options.map((opt) => {
        const active = opt.v === value;
        return (
          <button
            key={opt.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.v)}
            className={`text-sm px-2.5 py-1 rounded-sm transition-colors ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 2-2. 전사 고정비·변동비 구조 — 비용 계정을 고정비/변동비로 분해.
 *
 * - 우상단 토글: 기본(분류3까지)/상세(계정명까지), 인건비·상각비(해당 계정을 합쳐 비용 상단 소계로)
 * - 구분 우측에 변동비(%)·고정비(%) 열(기준 변동비율, 계정명 행에만. 고정비% = 1 − 변동비%)
 * - 행: 매출액 → 비용합계 → (인건비합계·상각비합계) → 비용 상세 → 영업이익(= 매출 − 비용합계)
 * - 연도 열(2023~2026 YTD) × 합계/고정비/변동비. 각 금액 아래 매출 대비 %
 */
export default function FixedVariableStructure({ fixedVariable }: Props) {
  const [detail, setDetail] = useState(false); // false=기본(분류3), true=상세(계정명)
  const [labor, setLabor] = useState(false);
  const [amort, setAmort] = useState(false);
  const [highlighted, setHighlighted] = useState<Set<string>>(() => new Set());

  const toggleHighlight = (id: string) =>
    setHighlighted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** 계정명 정렬용: `cat2|cat3|account` → 최신연도 합계(고정+변동). 데이터 있는 최대 period_year 기준. */
  const accountTotals = useMemo(() => {
    let maxYear = 0;
    for (const r of fixedVariable) {
      if (isCost(r) && r.value_mwon !== null && r.period_year > maxYear) maxYear = r.period_year;
    }
    const m = new Map<string, number>();
    if (maxYear === 0) return m; // 데이터 없음 → 정의 순서 유지
    for (const r of fixedVariable) {
      if (isCost(r) && r.value_mwon !== null && r.period_year === maxYear) {
        const k = `${r.category2}|${r.category3}|${r.account}`;
        m.set(k, (m.get(k) ?? 0) + r.value_mwon); // 2026이면 월 누적, 그 외 연간
      }
    }
    return m;
  }, [fixedVariable]);

  const rowDefs = useMemo(
    () => buildRowDefs(detail, labor, amort, accountTotals),
    [detail, labor, amort, accountTotals]
  );

  const yearGroups = useMemo(
    () =>
      buildYearGroups(fixedVariable).map((g) => ({ ...g, rows: fixedVariable.filter(g.match) })),
    [fixedVariable]
  );

  /** 연도별 매출/총비용 사전계산 (매출대비% · 영업이익용). */
  const perYear = useMemo(
    () =>
      yearGroups.map((g) => ({
        revenue: sumCell(g.rows, (r) => r.cost_type === '매출', null),
        totalCost: sumCell(g.rows, isCost, null),
      })),
    [yearGroups]
  );

  /** 변동비율 맵: `cat2|cat3|account` → 변동비율(0~1). period_year=0 기준 행. */
  const ratioMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of fixedVariable) {
      if (r.cost_type === '변동비율' && r.value_mwon !== null) {
        m.set(`${r.category2}|${r.category3}|${r.account}`, r.value_mwon);
      }
    }
    return m;
  }, [fixedVariable]);

  const ytdMonth = useMemo(() => maxYtdMonth(fixedVariable), [fixedVariable]);
  const dataColCount = yearGroups.length * COST_COLS.length;

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">2-2. 전사 고정비·변동비 구조</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            연결 기준 · 단위 백만원 · 합계 = 고정비 + 변동비 · 영업이익 = 매출액 − 비용합계 ·
            변동비(%)는 기준 가정치(고정비% = 1 − 변동비%)
            {ytdMonth > 0 ? ` · 2026은 1~${ytdMonth}월 누적(YTD)` : ' · 2026은 YTD(누적)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SegToggle
            value={detail}
            onChange={setDetail}
            options={[
              { v: false, label: '기본' },
              { v: true, label: '상세' },
            ]}
          />
          <button
            type="button"
            aria-pressed={labor}
            onClick={() => setLabor((v) => !v)}
            className={`text-sm px-2.5 py-1.5 rounded-md border transition-colors ${
              labor
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
            }`}
          >
            인건비
          </button>
          <button
            type="button"
            aria-pressed={amort}
            onClick={() => setAmort((v) => !v)}
            className={`text-sm px-2.5 py-1.5 rounded-md border transition-colors ${
              amort
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
            }`}
          >
            상각비
          </button>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="text-base" style={{ minWidth: `${10 + 4.5 * 2 + dataColCount * 6}rem` }}>
          <colgroup>
            <col style={{ minWidth: '10rem' }} />
            <col style={{ minWidth: '4.5rem' }} />
            <col style={{ minWidth: '4.5rem' }} />
            {yearGroups.map((g) =>
              COST_COLS.map((c) => (
                <col key={`${g.label}-${c.label}`} style={{ minWidth: '6rem' }} />
              ))
            )}
          </colgroup>
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-10 bg-muted border-r border-border px-3 py-2 text-center font-medium align-bottom"
              >
                구분
              </th>
              <th
                rowSpan={2}
                className="border-l border-border px-2 py-2 text-center font-medium align-bottom"
              >
                변동비(%)
              </th>
              <th rowSpan={2} className="px-2 py-2 text-center font-medium align-bottom">
                고정비(%)
              </th>
              {yearGroups.map((g) => (
                <th
                  key={g.label}
                  colSpan={COST_COLS.length}
                  className="border-l border-border px-3 py-2 text-center font-medium"
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr>
              {yearGroups.map((g) =>
                COST_COLS.map((c, ci) => (
                  <th
                    key={`${g.label}-${c.label}`}
                    className={`px-3 py-2 text-center font-medium ${ci === 0 ? 'border-l border-border' : ''}`}
                  >
                    {c.label}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {rowDefs.map((row) => {
              const emphasized =
                row.emphasis === 'header' ||
                row.emphasis === 'total' ||
                row.emphasis === 'footer' ||
                row.emphasis === 'group';
              const rowBg =
                row.emphasis === 'header' || row.emphasis === 'total' || row.emphasis === 'footer'
                  ? 'bg-blue-100 dark:bg-blue-900/40'
                  : row.emphasis === 'group'
                    ? 'bg-blue-50 dark:bg-blue-950/30'
                    : '';
              const rowExtra =
                row.emphasis === 'total'
                  ? 'border-t border-border'
                  : row.emphasis === 'footer'
                    ? 'border-t-2 border-border'
                    : row.emphasis === 'group'
                      ? 'border-t border-border/60'
                      : '';
              const isHl = highlighted.has(row.id);
              const HL = 'bg-yellow-100/70 dark:bg-yellow-900/30';
              const rowClass = `${isHl ? HL : rowBg} ${rowExtra} ${
                emphasized ? 'font-semibold' : ''
              } ${isHl || emphasized ? '' : 'hover:bg-muted/30'} cursor-pointer`
                .replace(/\s+/g, ' ')
                .trim();
              const labelBg = isHl ? HL : rowBg || 'bg-card';
              const indentStyle = { paddingLeft: `${0.75 + row.depth * 1.25}rem` };

              const vr = row.ratioKey
                ? ratioMap.get(`${row.ratioKey.cat2}|${row.ratioKey.cat3}|${row.ratioKey.account}`)
                : undefined;
              const varPct = vr !== undefined && vr > 0 ? `${Math.round(vr * 100)}%` : '';
              const fixPct = vr !== undefined && 1 - vr > 0 ? `${Math.round((1 - vr) * 100)}%` : '';

              return (
                <tr
                  key={row.id}
                  className={rowClass}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isHl}
                  aria-label={`${row.label} 행 — 클릭/Enter로 강조 토글`}
                  onClick={() => toggleHighlight(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleHighlight(row.id);
                    }
                  }}
                >
                  <td
                    className={`sticky left-0 z-10 ${labelBg} border-r border-border py-2 pr-3 align-middle`}
                    style={indentStyle}
                  >
                    {row.label}
                  </td>
                  <td className="border-l border-border px-2 py-2 text-center align-middle tabular-nums text-muted-foreground">
                    {varPct}
                  </td>
                  <td className="px-2 py-2 text-center align-middle tabular-nums text-muted-foreground">
                    {fixPct}
                  </td>
                  {yearGroups.map((g, gi) =>
                    COST_COLS.map((c, ci) => {
                      let value: number | null;
                      if (row.kind === 'op') {
                        const { revenue, totalCost } = perYear[gi];
                        value =
                          c.costType !== null || (revenue === null && totalCost === null)
                            ? null
                            : (revenue ?? 0) - (totalCost ?? 0);
                      } else {
                        value = sumCell(g.rows, row.match, c.costType);
                      }
                      const rev = perYear[gi].revenue;
                      const ratioText =
                        value !== null && rev !== null && rev !== 0
                          ? `${((value / rev) * 100).toFixed(1)}%`
                          : null;
                      const negative = value !== null && value < 0;
                      return (
                        <td
                          key={`${g.label}-${c.label}`}
                          className={`px-3 py-2 text-right align-middle tabular-nums ${ci === 0 ? 'border-l border-border' : ''}`}
                        >
                          <div className={negative ? 'text-red-500' : ''}>{fmtMillion(value)}</div>
                          {ratioText ? (
                            <div
                              className={
                                negative ? 'text-sm text-red-500' : 'text-sm text-muted-foreground'
                              }
                            >
                              {ratioText}
                            </div>
                          ) : null}
                        </td>
                      );
                    })
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
