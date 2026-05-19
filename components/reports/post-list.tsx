import Link from 'next/link';
import dayjs from 'dayjs';
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';

import { PostSourceBadge } from '@/components/reports/post-source-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PostRow } from '@/lib/reports/types';

type SortKey = 'created_at' | 'source_published_at';
type SortOrder = 'asc' | 'desc';

interface FilterParams {
  sourceType?: string;
  category?: string;
  sourceName?: string;
}

interface Props {
  rows: PostRow[];
  /** 전체 게시글 수. 표시 번호 계산에 사용. */
  total: number;
  /** 현재 페이지의 시작 인덱스(0-based). */
  startIndex?: number;
  /** 현재 정렬 기준 컬럼 */
  sort: SortKey;
  /** 현재 정렬 방향 */
  order: SortOrder;
  /** 필터 상태 — sortHref 에 유지할 파라미터 */
  filters: FilterParams;
}

/**
 * 헤더 클릭 시 이동할 URL. 필터·페이지 파라미터를 유지하고 sort/order/page 만 교체.
 */
function buildSortHref(
  currentSort: SortKey,
  currentOrder: SortOrder,
  targetSort: SortKey,
  filters: FilterParams
): string {
  const nextOrder: SortOrder =
    currentSort === targetSort ? (currentOrder === 'desc' ? 'asc' : 'desc') : 'desc';
  const params = new URLSearchParams();
  params.set('sort', targetSort);
  params.set('order', nextOrder);
  params.set('page', '1');
  if (filters.sourceType) params.set('sourceType', filters.sourceType);
  if (filters.category) params.set('category', filters.category);
  if (filters.sourceName) params.set('sourceName', filters.sourceName);
  return `/reports?${params.toString()}`;
}

/**
 * 제목 끝의 출처 괄호를 표시 시점에 제거.
 * 예: "글로벌 자동차 부품사 TOP 100 시장 현황 보고서 (2026-05-19)" → "글로벌 자동차 부품사 TOP 100 시장 현황 보고서"
 *      "차량 동향 (차플레이 Chaplay)" → "차량 동향"
 * DB 원본은 그대로 유지하고 UI 표시만 정리한다.
 */
function stripTrailingParens(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/u, '').trim();
}

function SortIcon({ active, order }: { active: boolean; order: SortOrder }) {
  if (!active) {
    return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-40" aria-hidden />;
  }
  return order === 'asc' ? (
    <ChevronUp className="ml-1 inline h-3 w-3" aria-hidden />
  ) : (
    <ChevronDown className="ml-1 inline h-3 w-3" aria-hidden />
  );
}

export function PostList({ rows, total, startIndex = 0, sort, order, filters }: Props) {
  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground rounded-md border border-dashed py-16 text-center">
        게시글이 없습니다.
      </div>
    );
  }

  const isCreatedActive = sort === 'created_at';
  const isSourceActive = sort === 'source_published_at';

  return (
    <div className="rounded-md border">
      <Table className="w-full table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead
              className="w-12 text-center"
              aria-sort={isCreatedActive ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              <Link
                href={buildSortHref(sort, order, 'created_at', filters)}
                className="hover:text-primary inline-flex items-center"
                scroll={false}
              >
                No.
                <SortIcon active={isCreatedActive} order={order} />
              </Link>
            </TableHead>
            <TableHead className="w-16">구분</TableHead>
            <TableHead className="w-32">카테고리</TableHead>
            <TableHead>제목</TableHead>
            <TableHead className="hidden w-32 md:table-cell">출처</TableHead>
            <TableHead
              className="hidden w-24 md:table-cell"
              aria-sort={isSourceActive ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              <Link
                href={buildSortHref(sort, order, 'source_published_at', filters)}
                className="hover:text-primary inline-flex items-center"
                scroll={false}
              >
                작성일
                <SortIcon active={isSourceActive} order={order} />
              </Link>
            </TableHead>
            <TableHead
              className="w-20"
              aria-sort={isCreatedActive ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              <Link
                href={buildSortHref(sort, order, 'created_at', filters)}
                className="hover:text-primary inline-flex items-center"
                scroll={false}
              >
                게시일
                <SortIcon active={isCreatedActive} order={order} />
              </Link>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.id}>
              <TableCell className="text-muted-foreground text-center">
                {isCreatedActive && order === 'asc'
                  ? startIndex + index + 1
                  : total - startIndex - index}
              </TableCell>
              <TableCell>
                <PostSourceBadge sourceType={row.source_type} />
              </TableCell>
              <TableCell className="text-muted-foreground truncate text-sm" title={row.category ?? undefined}>
                {row.category ?? '—'}
              </TableCell>
              <TableCell className="whitespace-normal">
                <Link
                  href={`/reports/${row.id}`}
                  className="hover:text-primary line-clamp-2 font-medium break-words"
                  title={row.title}
                >
                  {stripTrailingParens(row.title)}
                </Link>
                <div className="text-muted-foreground mt-0.5 line-clamp-1 text-sm md:hidden">
                  {row.source_name ?? '—'}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground hidden whitespace-normal md:table-cell">
                <span className="line-clamp-1">{row.source_name ?? '—'}</span>
              </TableCell>
              <TableCell className="text-muted-foreground hidden text-sm md:table-cell">
                {row.source_published_at
                  ? dayjs(row.source_published_at).format('YYYY.MM.DD')
                  : '—'}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {dayjs(row.created_at).format('YYYY.MM.DD')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
