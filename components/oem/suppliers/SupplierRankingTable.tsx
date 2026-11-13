'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ROW_HIGHLIGHT_CLASS, useRowHighlight } from '@/lib/useRowHighlight';
import type { MatchLevel, SupplierRow } from '@/lib/sourcing/types';

/**
 * 표에 넘기는 얇은 행 — client 컴포넌트라 props 가 그대로 브라우저로 직렬화된다.
 * 순위 결과 전체(`score.groupLevels` 등)를 넘기면 2,000행에 약 1.1MB 라 표에 쓰는 칸만 담는다(page 가 만든다).
 */
export interface SupplierTableRow {
  id: number;
  name: string;
  country: string | null;
  total: number;
  bestLevel: MatchLevel;
  employees: number | null;
  /** 'IATF 16949' · 'ISO 9001' · null(없음) — 점수표의 인증 배점과 같은 판정. */
  cert: string | null;
  source: SupplierRow['source'];
  competitorNames: string[];
  affiliateNames: string[];
}

const LEVEL_LABEL: Record<MatchLevel, string | null> = {
  named: '품목 명시',
  category: '분류 일치',
  process: '공정만',
  none: null,
};

const SOURCE_LABEL: Record<SupplierRow['source'], string> = {
  marklines: 'MarkLines',
  web: '웹 조사',
};

const TD = 'px-3 py-2 whitespace-nowrap';
const NUM = `${TD} text-right tabular-nums`;
const BADGE = 'rounded px-1.5 py-0.5 text-[11px]';
const DASH = <span className="text-muted-foreground">—</span>;

interface Props {
  rows: SupplierTableRow[];
  /** 거른 뒤 전체 건수 — rows 는 그중 상위 일부만 온다. */
  total: number;
  productSlug: string;
}

/** 협력사 후보 순위표 — 총점 내림차순(page 가 정렬된 채로 넘긴다) · 행 클릭으로 노란 강조. */
export default function SupplierRankingTable({ rows, total, productSlug }: Props) {
  const { highlighted, rowToggleProps } = useRowHighlight();

  return (
    <div className="space-y-1">
      {total > rows.length && (
        <p className="text-xs text-muted-foreground">
          {total.toLocaleString('ko-KR')}곳 중 {rows.length.toLocaleString('ko-KR')}곳 표시
        </p>
      )}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className={`${TD} text-right`}>순위</th>
              <th className={`${TD} text-left`}>업체명</th>
              <th className={`${TD} text-left`}>국가</th>
              <th className={`${TD} text-right`}>점수</th>
              <th className={`${TD} text-left`}>경쟁사 납품</th>
              <th className={`${TD} text-left`}>일치 단계</th>
              <th className={`${TD} text-right`}>종업원</th>
              <th className={`${TD} text-left`}>인증</th>
              <th className={`${TD} text-left`}>출처</th>
              <th className={`${TD} text-left`}>계열 가능성</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const key = String(r.id);
              const level = LEVEL_LABEL[r.bestLevel];
              return (
                <tr
                  key={r.id}
                  {...rowToggleProps(key, r.name)}
                  className={cn(
                    'cursor-pointer border-t border-border hover:bg-muted/30',
                    highlighted.has(key) && ROW_HIGHLIGHT_CLASS
                  )}
                >
                  <td className={cn(NUM, 'text-muted-foreground')}>{i + 1}</td>
                  <td className={TD}>
                    <Link
                      href={`/oem/suppliers/${r.id}?product=${encodeURIComponent(productSlug)}`}
                      className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className={TD}>{r.country ?? DASH}</td>
                  <td className={cn(NUM, 'font-semibold')}>{r.total}</td>
                  <td className={TD}>
                    {r.competitorNames.length ? (
                      <span className="flex flex-wrap gap-1">
                        {r.competitorNames.map((n) => (
                          <span
                            key={n}
                            className={cn(
                              BADGE,
                              'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                            )}
                          >
                            {n}
                          </span>
                        ))}
                      </span>
                    ) : (
                      DASH
                    )}
                  </td>
                  <td className={TD}>{level ?? DASH}</td>
                  <td className={NUM}>
                    {r.employees == null ? DASH : r.employees.toLocaleString('ko-KR')}
                  </td>
                  <td className={TD}>{r.cert ?? DASH}</td>
                  <td className={TD}>{SOURCE_LABEL[r.source]}</td>
                  <td className={TD}>
                    {r.affiliateNames.length ? (
                      <span
                        className={cn(
                          BADGE,
                          'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                        )}
                      >
                        계열 가능성: {r.affiliateNames.join(', ')}
                      </span>
                    ) : (
                      DASH
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
