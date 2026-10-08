'use client';

import { useMemo, useState } from 'react';
import { buildPeriodColumns } from '@/lib/pnl/periodColumns';
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
  depth: 0 | 1 | 2 | 3;
  kind: RowKind;
  /**
   * header/total/footer=진한 파랑 · group=연한 파랑(개별관리·경비관리) · section=배경 녹색(매출원가·판관비)
   * · subgroup/normal=음영 없음
   */
  emphasis: 'header' | 'total' | 'footer' | 'group' | 'section' | 'subgroup' | 'normal';
  /** 금액 합산 매칭. op(영업이익)은 파생이라 null. */
  match: ((r: FixedVariableRow) => boolean) | null;
  /** 변동/고정비율 조회 키 (계정명 leaf만). */
  ratioKey: { cat2: string; cat3: string; account: string } | null;
}

const isCost = (r: FixedVariableRow) => r.cost_type === '고정비' || r.cost_type === '변동비';

/** 인건비(경비관리 › 개별관리 › 인건비합계 대상): 노무비 전체 + 판관 인건비 + 연구 인건비. */
function isLaborAccount(cat2: string, cat3: string, account: string): boolean {
  return (
    (cat2 === '매출원가' && cat3 === '노무비') ||
    (cat2 === '판매관리비' && cat3 === '판매관리비' && account === '판관 인건비') ||
    (cat2 === '판매관리비' && cat3 === '연구개발비' && account === '연구 인건비')
  );
}
/** 상각비(경비관리 › 개별관리 › 상각비합계 대상): 경비-감가상각비 + 경비-개발비상각 + 연구개발비-감가상각비. */
function isAmortAccount(cat2: string, cat3: string, account: string): boolean {
  return (
    (cat2 === '매출원가' &&
      cat3 === '경비' &&
      (account === '감가상각비' || account === '개발비상각')) ||
    (cat2 === '판매관리비' && cat3 === '연구개발비' && account === '감가상각비')
  );
}

/** 재료비(경비관리 ON 일 때 개별관리로 옮기는 대상). */
function isMaterialAccount(cat2: string, cat3: string): boolean {
  return cat2 === '매출원가' && cat3 === '재료비';
}

/** 개별관리 아래 소계(인건비합계·상각비합계). */
const INDIVIDUAL_SUBTOTALS = [
  { id: '인건비합계', label: '인건비합계', is: isLaborAccount },
  { id: '상각비합계', label: '상각비합계', is: isAmortAccount },
] as const;

/** 인건비합계·상각비합계를 펼칠 때의 계정 라벨 — 원래 그룹을 떠나므로 출처를 붙인다. */
function individualLeafLabel(cat2: string, cat3: string, account: string): string {
  if (cat3 === '노무비') return `노무비 ${account}`;
  if (account === '감가상각비') return `감가상각비(${cat2 === '매출원가' ? '매출원가' : cat3})`;
  return account;
}

/** 계정 leaf 행 — 금액 매칭 + 변동비율 키. */
function leafDef(
  cat2: string,
  cat3: string,
  account: string,
  label: string,
  depth: RowDef['depth']
): RowDef {
  return {
    id: `${cat2}|${cat3}|${account}`,
    label,
    depth,
    kind: 'leaf',
    emphasis: 'normal',
    match: (r) =>
      isCost(r) && r.category2 === cat2 && r.category3 === cat3 && r.account === account,
    ratioKey: { cat2, cat3, account },
  };
}

/** 최신연도 합계(고정+변동) 큰 순. '기타'는 금액과 무관하게 맨 아래. 동률·무데이터는 원순서(stable). */
function byLatestTotal(totals: Map<string, number>, key: (a: string) => string) {
  return (a: string, b: string) => {
    const aEtc = a === '기타';
    const bEtc = b === '기타';
    if (aEtc !== bEtc) return aEtc ? 1 : -1;
    return (totals.get(key(b)) ?? 0) - (totals.get(key(a)) ?? 0);
  };
}

/**
 * 매출원가·판관비 트리를 defs 에 붙인다. extracted 계정은 빼고, 비면 그룹째 생략.
 * @param offset 0=비용합계 바로 아래 · 1=경비관리 아래
 */
function pushCostTree(
  defs: RowDef[],
  offset: 0 | 1,
  extracted: (c2: string, c3: string, a: string) => boolean,
  detail: boolean,
  totals: Map<string, number>
): void {
  const extractedRow = (r: FixedVariableRow) => extracted(r.category2, r.category3, r.account);
  for (const node of COST_TREE) {
    defs.push({
      id: `g:${node.cat2}`,
      label: node.label,
      depth: offset,
      kind: 'group',
      emphasis: 'section',
      match: (r) => isCost(r) && r.category2 === node.cat2 && !extractedRow(r),
      ratioKey: null,
    });
    for (const g of node.groups) {
      const accts = g.accounts.filter((a) => !extracted(node.cat2, g.cat3, a));
      if (accts.length === 0) continue; // 그룹 전체가 개별관리로 이동
      accts.sort(byLatestTotal(totals, (a) => `${node.cat2}|${g.cat3}|${a}`));
      if (accts.length === 1 && accts[0] === g.cat3) {
        defs.push(leafDef(node.cat2, g.cat3, accts[0], g.label, (offset + 1) as 1 | 2));
        continue;
      }
      defs.push({
        id: `g:${node.cat2}|${g.cat3}`,
        label: g.label,
        depth: (offset + 1) as 1 | 2,
        kind: 'group',
        emphasis: 'subgroup',
        match: (r) =>
          isCost(r) && r.category2 === node.cat2 && r.category3 === g.cat3 && !extractedRow(r),
        ratioKey: null,
      });
      if (detail) {
        for (const account of accts) {
          defs.push(leafDef(node.cat2, g.cat3, account, account, (offset + 2) as 2 | 3));
        }
      }
    }
  }
}

/**
 * 개별관리(재료비 · 인건비합계 · 상각비합계)를 defs 에 붙인다.
 * 두 소계는 「상세」와 무관하게 한 줄이고, 개별관리상세(expand)일 때만 구성 계정으로 펼친다.
 */
function pushIndividual(defs: RowDef[], expand: boolean, totals: Map<string, number>): void {
  defs.push({
    id: '개별관리',
    label: '개별관리',
    depth: 0,
    kind: 'group',
    emphasis: 'group',
    match: (r) => isCost(r) && isIndividualAccount(r.category2, r.category3, r.account),
    ratioKey: null,
  });
  defs.push(leafDef('매출원가', '재료비', '재료비', '재료비', 1));
  for (const s of INDIVIDUAL_SUBTOTALS) {
    defs.push({
      id: s.id,
      label: s.label,
      depth: 1,
      kind: 'group',
      emphasis: 'subgroup',
      match: (r) => isCost(r) && s.is(r.category2, r.category3, r.account),
      ratioKey: null,
    });
    if (!expand) continue;
    const members: { cat2: string; cat3: string; account: string }[] = [];
    for (const node of COST_TREE) {
      for (const g of node.groups) {
        for (const account of g.accounts) {
          if (s.is(node.cat2, g.cat3, account))
            members.push({ cat2: node.cat2, cat3: g.cat3, account });
        }
      }
    }
    const key = (m: (typeof members)[number]) => `${m.cat2}|${m.cat3}|${m.account}`;
    members.sort((a, b) => (totals.get(key(b)) ?? 0) - (totals.get(key(a)) ?? 0));
    for (const m of members) {
      defs.push(
        leafDef(m.cat2, m.cat3, m.account, individualLeafLabel(m.cat2, m.cat3, m.account), 2)
      );
    }
  }
}

/** 개별관리 대상 = 인건비 ∪ 상각비 ∪ 재료비. */
function isIndividualAccount(cat2: string, cat3: string, account: string): boolean {
  return (
    isLaborAccount(cat2, cat3, account) ||
    isAmortAccount(cat2, cat3, account) ||
    isMaterialAccount(cat2, cat3)
  );
}

/**
 * 행 정의 — 매출액 → 비용합계 → 비용 상세 → 영업이익.
 * @param detail      true=상세(계정명까지) / false=기본(분류3까지)
 * @param expenseMgmt true=경비관리 보기 — 비용을 개별관리(인건비·상각비·재료비)와
 *                    경비관리(나머지 매출원가·판관비)로 나눈다. 옮긴 계정은 원래 자리에서 빠져 이중 집계가 없다.
 * @param individualDetail true=개별관리상세 — 인건비합계·상각비합계를 구성 계정까지 펼친다
 */
function buildRowDefs(
  detail: boolean,
  expenseMgmt: boolean,
  individualDetail: boolean,
  totals: Map<string, number>
): RowDef[] {
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

  if (expenseMgmt) {
    pushIndividual(defs, individualDetail, totals);
    defs.push({
      id: '경비관리',
      label: '경비관리',
      depth: 0,
      kind: 'group',
      emphasis: 'group',
      match: (r) => isCost(r) && !isIndividualAccount(r.category2, r.category3, r.account),
      ratioKey: null,
    });
    pushCostTree(defs, 1, isIndividualAccount, detail, totals);
  } else {
    pushCostTree(defs, 0, () => false, detail, totals);
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

/** 눌림 상태가 유지되는 단일 토글 버튼(경비관리 · 개별관리상세). */
function PressToggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={value}
      onClick={() => onChange(!value)}
      className={`text-sm px-2.5 py-1.5 rounded-md border transition-colors ${
        value
          ? 'bg-primary text-primary-foreground border-primary'
          : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * 2-2. 전사 고정비·변동비 구조 — 비용 계정을 고정비/변동비로 분해.
 *
 * - 우상단 토글: 기본(분류3까지)/상세(계정명까지) · 합계/고정비(열 구성) · 경비관리(개별관리·경비관리로 나눔)
 *   · 개별관리상세(경비관리일 때만 — 인건비합계·상각비합계를 구성 계정으로 펼침)
 * - 구분 우측 「기준」 아래 변동비(%)·고정비(%) 열(기준 변동비율, 계정명 행에만. 고정비% = 1 − 변동비%).
 *   합계 모드에선 숨긴다
 * - 행: 매출액 → 비용합계 → (개별관리 · 경비관리) → 비용 상세 → 영업이익(= 매출 − 비용합계)
 * - 연도 열(2023~2026 YTD) × 합계/고정비/변동비(합계 모드면 합계만). 각 금액 아래 매출 대비 %
 */
export default function FixedVariableStructure({ fixedVariable }: Props) {
  const [detail, setDetail] = useState(false); // false=기본(분류3), true=상세(계정명)
  const [breakdown, setBreakdown] = useState(true); // false=합계만, true=합계·고정비·변동비 + 기준열
  const [expenseMgmt, setExpenseMgmt] = useState(false);
  const [individualDetail, setIndividualDetail] = useState(false); // 인건비합계·상각비합계 펼침
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
        m.set(k, (m.get(k) ?? 0) + r.value_mwon); // 진행 연도면 월 누적, 그 외 연간
      }
    }
    return m;
  }, [fixedVariable]);

  const rowDefs = useMemo(
    () => buildRowDefs(detail, expenseMgmt, individualDetail, accountTotals),
    [detail, expenseMgmt, individualDetail, accountTotals]
  );

  // 변동비율 기준행은 period_year=0 · period_kind='annual'로 저장돼 있어 그대로 두면
  // 존재하지 않는 "0"년 연간 열이 생긴다 — 열 파생에서 제외한다.
  const yearGroups = useMemo(
    () =>
      buildPeriodColumns(fixedVariable, (r) => r.cost_type !== '변동비율').map((g) => ({
        ...g,
        rows: fixedVariable.filter(g.match),
      })),
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

  const ytdGroup = yearGroups.find((g) => g.ytdMonths !== null);
  const costCols = breakdown ? COST_COLS : COST_COLS.filter((c) => c.costType === null);
  const dataColCount = yearGroups.length * costCols.length;

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">2-2. 전사 고정비·변동비 구조</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            연결 기준 · 단위 백만원 · 합계 = 고정비 + 변동비 · 영업이익 = 매출액 − 비용합계 ·
            변동비(%)는 기준 가정치(고정비% = 1 − 변동비%)
            {ytdGroup
              ? ` · ${ytdGroup.label.slice(0, 4)}은 1~${ytdGroup.ytdMonths}월 누적(YTD)`
              : ''}
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
          <SegToggle
            value={breakdown}
            onChange={setBreakdown}
            options={[
              { v: false, label: '합계' },
              { v: true, label: '고정비' },
            ]}
          />
          <PressToggle value={expenseMgmt} onChange={setExpenseMgmt} label="경비관리" />
          {/* 개별관리 행은 경비관리 보기에만 있으므로 그때만 노출 */}
          {expenseMgmt && (
            <PressToggle
              value={individualDetail}
              onChange={setIndividualDetail}
              label="개별관리상세"
            />
          )}
        </div>
      </header>
      <div className="overflow-x-auto">
        <table
          className="text-base"
          style={{ minWidth: `${10 + (breakdown ? 4.5 * 2 : 0) + dataColCount * 6}rem` }}
        >
          <colgroup>
            <col style={{ minWidth: '10rem' }} />
            {breakdown && <col style={{ minWidth: '4.5rem' }} />}
            {breakdown && <col style={{ minWidth: '4.5rem' }} />}
            {yearGroups.map((g) =>
              costCols.map((c) => (
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
              {breakdown && (
                <th
                  colSpan={2}
                  className="border-l border-border px-2 py-2 text-center font-medium"
                >
                  기준
                </th>
              )}
              {yearGroups.map((g) => (
                <th
                  key={g.label}
                  colSpan={costCols.length}
                  className="border-l border-border px-3 py-2 text-center font-medium"
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr>
              {breakdown && (
                <>
                  <th className="border-l border-border px-2 py-2 text-center font-medium">
                    변동비(%)
                  </th>
                  <th className="px-2 py-2 text-center font-medium">고정비(%)</th>
                </>
              )}
              {yearGroups.map((g) =>
                costCols.map((c, ci) => (
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
                row.emphasis === 'group' ||
                row.emphasis === 'section';
              // 진한 파랑(매출액·비용합계·영업이익) · 연한 파랑(개별관리·경비관리)
              // · 연한 녹색(매출원가·판관비 = 테마 배경 bg-background, 4. 전사 실적 연도 칸과 같은 토큰)
              const rowBg =
                row.emphasis === 'header' || row.emphasis === 'total' || row.emphasis === 'footer'
                  ? 'bg-blue-100 dark:bg-blue-900/40'
                  : row.emphasis === 'group'
                    ? 'bg-blue-50 dark:bg-blue-950/30'
                    : row.emphasis === 'section'
                      ? 'bg-background'
                      : '';
              const rowExtra =
                row.emphasis === 'total'
                  ? 'border-t border-border'
                  : row.emphasis === 'footer'
                    ? 'border-t-2 border-border'
                    : row.emphasis === 'group' || row.emphasis === 'section'
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
                  {breakdown && (
                    <>
                      <td className="border-l border-border px-2 py-2 text-center align-middle tabular-nums text-muted-foreground">
                        {varPct}
                      </td>
                      <td className="px-2 py-2 text-center align-middle tabular-nums text-muted-foreground">
                        {fixPct}
                      </td>
                    </>
                  )}
                  {yearGroups.map((g, gi) =>
                    costCols.map((c, ci) => {
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
