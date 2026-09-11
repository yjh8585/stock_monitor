'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText, Search } from 'lucide-react';

import { buildPageRange } from '@/components/reports/post-pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ResearchReportRow } from '@/lib/humanoid/research';

interface Props {
  rows: ResearchReportRow[];
  brokers: string[];
  targets: string[];
  total: number;
  summarized: number;
}

const PERIODS = [
  { label: '전체', months: 0 },
  { label: '1개월', months: 1 },
  { label: '3개월', months: 3 },
] as const;

/** 보고서 게시판(`/reports`)과 같은 한 페이지 분량. */
const PAGE_SIZE = 20;

/** 제목 아래에 한 줄로 붙는 요약 미리보기 길이. */
const EXCERPT_CHARS = 110;

type SortOrder = 'asc' | 'desc';

/** 오늘로부터 n개월 전 날짜(YYYY-MM-DD). n=0 이면 null(=제한 없음). */
function monthsAgo(n: number): string | null {
  if (n <= 0) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * 마크다운 요약에서 한 줄 미리보기를 뽑는다.
 *
 * 요약 본문은 `## 투자포인트` 같은 헤딩과 `- **볼드**` 목록으로 시작하는 경우가 많아,
 * 그대로 잘라 내면 기호만 보인다. 상세 페이지는 MarkdownView 가 제대로 그리므로
 * 여기서는 **미리보기 전용**으로 기호만 걷어낸다.
 */
function excerpt(markdown: string): string {
  const plain = markdown
    // 🔴 헤딩은 기호만 떼면 안 된다. `## 투자포인트` + 다음 문단이 한 줄로 이어져
    //    "투자포인트 미래에셋증권은…" 처럼 읽힌다 — 줄 자체를 지운다.
    .replace(/^#{1,6}[^\n]*$/gm, '')
    // 정리본은 「> 한 줄 핵심 요약」으로 시작한다(2026-08-25 규격). 그 문장이 곧 최고의
    // 발췌라 지우지 않고 **인용 기호만** 뗀다.
    .replace(/^>\s?/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 이미지 — 발췌에 URL 이 튀어나오면 안 된다
    .replace(/^\|.*$/gm, '') // 표 행
    .replace(/^[-*]\s+/gm, '') // 목록 기호
    .replace(/\*\*(.+?)\*\*/g, '$1') // 볼드
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > EXCERPT_CHARS ? `${plain.slice(0, EXCERPT_CHARS)}…` : plain;
}

/** 발행일 문자열(YYYY-MM-DD) → `2026.08.25`. 없으면 대시. */
function formatDate(value: string | null): string {
  if (!value) return '—';
  return value.slice(0, 10).replace(/-/g, '.');
}

function SortIcon({ order }: { order: SortOrder }) {
  return order === 'asc' ? (
    <ChevronUp className="ml-1 inline h-3 w-3" aria-hidden />
  ) : (
    <ChevronDown className="ml-1 inline h-3 w-3" aria-hidden />
  );
}

/**
 * 증권사 리포트 목록 — 보고서 게시판(`/reports`)과 같은 표 UI.
 *
 * 리포트 1건 = 1행이다(사용자 결정 2026-09-11 「완전 평면화」). 종전에는 (증권사, 대상)
 * 묶음을 카드로 접어 보여 줬는데, 게시판과 조작감이 달라 통일했다. 같은 증권사가 같은 종목을
 * 이어 다룬 회차는 **상세 페이지의 「이전 리포트」**가 그대로 보여 준다.
 *
 * 필터·페이지 넘김은 서버 왕복 없이 클라이언트에서 건다(결정 5). 데이터가 이미 전량
 * 내려와 있고, URL 방식으로 바꾸면 증권사×종목×기간×페이지 조합마다 `'use cache'` 엔트리가
 * 쌓여 ISR Write 한도가 다시 문제가 된다(`docs/isr-write-optimization.md`).
 */
export function ResearchList({ rows, brokers, targets, total, summarized }: Props) {
  const [broker, setBroker] = useState('');
  const [target, setTarget] = useState('');
  const [term, setTerm] = useState('');
  const [months, setMonths] = useState(0);
  const [order, setOrder] = useState<SortOrder>('desc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const floor = monthsAgo(months);
    const needle = term.trim().toLowerCase();

    const kept = rows.filter((r) => {
      if (broker && r.broker !== broker) return false;
      if (target && r.targetName !== target) return false;
      if (floor && (r.publishedAt ?? '') < floor) return false;
      if (needle) {
        const hay = `${r.targetName} ${r.ticker ?? ''} ${r.title}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    // 서버가 이미 발행일 내림차순으로 보내 준다. 오름차순은 여기서만 뒤집는다.
    return order === 'desc' ? kept : [...kept].reverse();
  }, [rows, broker, target, term, months, order]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // 필터를 좁혀 페이지 수가 줄면 지금 페이지가 범위를 벗어난다 — 렌더 중에 당겨 온다
  // (effect 로 하면 빈 화면이 한 프레임 스친다).
  const current = Math.min(page, totalPages);
  const startIndex = (current - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  /** 필터를 바꾸면 1페이지로 되돌린다 — 3페이지를 보다 필터를 좁히면 빈 화면이 된다. */
  function withReset<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setPage(1);
    };
  }

  return (
    <div className="flex h-full flex-col">
      {/* 필터 바 */}
      {/* 좌우 여백은 게시판(`app/reports/layout.tsx`)과 «같은 값» 을 쓴다 —
          같은 성격의 목록이 탭마다 다른 폭으로 보이면 안 된다(2026-09-11 사용자 지적). */}
      <div className="border-border mx-auto flex w-full max-w-7xl shrink-0 flex-wrap items-center gap-2 border-b px-12 py-3 sm:px-20 lg:px-24">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            value={term}
            onChange={(e) => withReset(setTerm)(e.target.value)}
            placeholder="종목·업종·제목"
            className="border-border h-8 w-48 rounded border bg-transparent pr-2 pl-7 text-xs"
          />
        </div>

        <select
          value={broker}
          onChange={(e) => withReset(setBroker)(e.target.value)}
          className="border-border h-8 rounded border bg-transparent px-2 text-xs"
        >
          <option value="">증권사 전체</option>
          {brokers.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        {/* 종목·업종 드롭다운 (사용자 지시 2026-08-25). 리포트가 많은 순으로 정렬돼 온다. */}
        <select
          value={target}
          onChange={(e) => withReset(setTarget)(e.target.value)}
          className="border-border h-8 rounded border bg-transparent px-2 text-xs"
        >
          <option value="">종목·업종 전체</option>
          {targets.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => withReset(setMonths)(p.months)}
              className={`h-8 rounded px-2 text-xs ${
                months === p.months ? 'bg-foreground text-background' : 'border-border border'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <span className="text-muted-foreground ml-auto text-xs">
          {filtered.length.toLocaleString()}건 · 정리된 리포트 {summarized.toLocaleString()}건 /
          수집 {total.toLocaleString()}건
        </span>
      </div>

      {/* 목록 */}
      <div className="mx-auto w-full max-w-7xl flex-1 overflow-auto px-12 py-6 sm:px-20 lg:px-24">
        {filtered.length === 0 ? (
          <div className="text-muted-foreground rounded-md border border-dashed py-16 text-center">
            조건에 맞는 리포트가 없습니다.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border">
              <Table className="w-full table-fixed">
                <TableHeader>
                  <TableRow className="bg-blue-50 hover:bg-blue-50">
                    <TableHead className="w-12 text-center">No.</TableHead>
                    <TableHead className="w-36 text-center">종목·업종</TableHead>
                    <TableHead className="text-center">제목</TableHead>
                    <TableHead className="hidden w-28 text-center md:table-cell">증권사</TableHead>
                    <TableHead className="hidden w-20 text-center md:table-cell">의견</TableHead>
                    <TableHead className="hidden w-24 text-center md:table-cell">목표가</TableHead>
                    <TableHead
                      className="w-24 text-center"
                      aria-sort={order === 'asc' ? 'ascending' : 'descending'}
                    >
                      <button
                        type="button"
                        onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}
                        className="hover:text-primary inline-flex items-center justify-center"
                      >
                        작성일
                        <SortIcon order={order} />
                      </button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row, index) => (
                    <TableRow key={row.id} className="bg-white">
                      <TableCell className="text-muted-foreground text-center">
                        {filtered.length - startIndex - index}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          <span className="text-sm">{row.targetName}</span>
                          {row.companyId !== null && (
                            <span className="bg-foreground text-background rounded px-1 py-0.5 text-[10px]">
                              추적
                            </span>
                          )}
                        </div>
                        {row.ticker && (
                          <div className="text-muted-foreground text-center text-xs">
                            {row.ticker}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="flex items-start gap-2">
                          <Link
                            href={`/humanoid/research/${row.id}`}
                            className="hover:text-primary line-clamp-2 font-medium break-words"
                            title={row.title}
                          >
                            {row.title}
                          </Link>
                          {row.isDelta && (
                            <span className="bg-muted mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px]">
                              변화분
                            </span>
                          )}
                          {row.pdfUrl && (
                            <a
                              href={row.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-primary mt-0.5 shrink-0"
                              title="원문 PDF"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                        {row.summaryExcerpt && (
                          <div className="text-muted-foreground mt-0.5 line-clamp-1 text-sm">
                            {excerpt(row.summaryExcerpt)}
                          </div>
                        )}
                        <div className="text-muted-foreground mt-0.5 line-clamp-1 text-sm md:hidden">
                          {row.broker ?? '—'}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-center text-sm whitespace-normal md:table-cell">
                        {row.broker ?? '—'}
                      </TableCell>
                      <TableCell className="hidden text-center text-sm md:table-cell">
                        {row.opinion ?? '—'}
                      </TableCell>
                      <TableCell className="hidden text-center text-sm md:table-cell">
                        {row.targetPrice !== null ? row.targetPrice.toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-center text-sm">
                        {formatDate(row.publishedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(current - 1)}
                  disabled={current <= 1}
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    current <= 1 && 'pointer-events-none opacity-40'
                  )}
                  aria-label="이전 페이지"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                {buildPageRange(current, totalPages).map((p, i) =>
                  p === null ? (
                    <span key={`ellipsis-${i}`} className="text-muted-foreground px-1 text-sm">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={cn(
                        buttonVariants({
                          variant: current === p ? 'default' : 'outline',
                          size: 'sm',
                        }),
                        'min-w-[2.25rem]'
                      )}
                    >
                      {p}
                    </button>
                  )
                )}

                <button
                  type="button"
                  onClick={() => setPage(current + 1)}
                  disabled={current >= totalPages}
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    current >= totalPages && 'pointer-events-none opacity-40'
                  )}
                  aria-label="다음 페이지"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
