'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Search } from 'lucide-react';

import type { ResearchGroup, ResearchReportRow } from '@/lib/humanoid/research';

interface Props {
  groups: ResearchGroup[];
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

/** 카드에 미리 보여 줄 요약 길이. 넘치면 잘라 「자세히」로 넘긴다. */
const EXCERPT_CHARS = 180;

/** 오늘로부터 n개월 전 날짜(YYYY-MM-DD). n=0 이면 null(=제한 없음). */
function monthsAgo(n: number): string | null {
  if (n <= 0) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * 마크다운 요약에서 카드용 한 문단을 뽑는다.
 *
 * 요약 본문은 `## 투자포인트` 같은 헤딩과 `- **볼드**` 목록으로 시작하는 경우가 많아,
 * 그대로 잘라 내면 카드에 기호만 보인다. 상세 페이지는 MarkdownView 가 제대로 그리므로
 * 여기서는 **미리보기 전용**으로 기호만 걷어낸다.
 */
function excerpt(markdown: string): string {
  const plain = markdown
    // 🔴 헤딩은 기호만 떼면 안 된다. `## 투자포인트` + 다음 문단이 한 줄로 이어져
    //    "투자포인트 미래에셋증권은…" 처럼 읽힌다 — 줄 자체를 지운다.
    .replace(/^#{1,6}[^\n]*$/gm, '')
    .replace(/^[-*]\s+/gm, '') // 목록 기호
    .replace(/\*\*(.+?)\*\*/g, '$1') // 볼드
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > EXCERPT_CHARS ? `${plain.slice(0, EXCERPT_CHARS)}…` : plain;
}

function ReportMeta({ row }: { row: ResearchReportRow }) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span>{row.publishedAt ?? '날짜 미상'}</span>
      {row.opinion && <span className="text-foreground font-medium">{row.opinion}</span>}
      {row.targetPrice !== null && <span>목표 {row.targetPrice.toLocaleString()}원</span>}
      {row.isDelta && <span className="bg-muted rounded px-1.5 py-0.5">변화분</span>}
      {row.pdfUrl && (
        <a
          href={row.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 underline"
        >
          <FileText className="h-3 w-3" />
          PDF
        </a>
      )}
    </div>
  );
}

/**
 * 증권사 리포트 목록 — (증권사, 대상) 묶음을 카드로 보여 준다.
 *
 * 본문은 상세 페이지(`/humanoid/research/[id]`)에서 읽는다. 카드에는 요약 앞부분만
 * 싣는다 — 목록에서 전문을 접었다 펴던 때는 마크다운이 평문으로 뭉개졌다.
 *
 * 필터는 서버 왕복 없이 클라이언트에서 건다. 데이터가 이미 전량 내려와 있어
 * URL 을 오갈 이유가 없고, 그 편이 훑어보는 흐름이 끊기지 않는다.
 */
export function ResearchList({ groups, brokers, targets, total, summarized }: Props) {
  const [broker, setBroker] = useState('');
  const [target, setTarget] = useState('');
  const [term, setTerm] = useState('');
  const [months, setMonths] = useState(0);
  const [onlySummarized, setOnlySummarized] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const floor = monthsAgo(months);
    const needle = term.trim().toLowerCase();

    return groups.filter((g) => {
      if (broker && g.broker !== broker) return false;
      if (target && g.targetName !== target) return false;
      if (onlySummarized && g.latest.summary === null) return false;
      if (floor && (g.latest.publishedAt ?? '') < floor) return false;
      if (needle) {
        const hay = `${g.targetName} ${g.ticker ?? ''} ${g.latest.title}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [groups, broker, target, term, months, onlySummarized]);

  const toggleGroup = (key: string) => {
    const next = new Set(openGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenGroups(next);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 필터 바 */}
      <div className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="종목·업종·제목"
            className="border-border h-8 w-48 rounded border bg-transparent pr-2 pl-7 text-xs"
          />
        </div>

        <select
          value={broker}
          onChange={(e) => setBroker(e.target.value)}
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
          onChange={(e) => setTarget(e.target.value)}
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
              onClick={() => setMonths(p.months)}
              className={`h-8 rounded px-2 text-xs ${
                months === p.months ? 'bg-foreground text-background' : 'border-border border'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={onlySummarized}
            onChange={(e) => setOnlySummarized(e.target.checked)}
          />
          정리된 것만
        </label>

        <span className="text-muted-foreground ml-auto text-xs">
          묶음 {filtered.length.toLocaleString()} · 리포트 {total.toLocaleString()}건 (정리{' '}
          {summarized.toLocaleString()}건)
        </span>
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground py-12 text-center text-sm">
            조건에 맞는 리포트가 없습니다.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {filtered.map((g) => {
              const historyOpen = openGroups.has(g.key);
              return (
                <li key={g.key} className="px-6 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{g.targetName}</span>
                    {g.ticker && <span className="text-muted-foreground text-xs">{g.ticker}</span>}
                    {g.tracked && (
                      <span className="bg-foreground text-background rounded px-1.5 py-0.5 text-[10px]">
                        추적
                      </span>
                    )}
                    <span className="text-muted-foreground text-xs">{g.broker}</span>
                  </div>

                  <Link
                    href={`/humanoid/research/${g.latest.id}`}
                    className="mt-0.5 block text-sm hover:underline"
                  >
                    {g.latest.title}
                  </Link>

                  <div className="mt-1">
                    <ReportMeta row={g.latest} />
                  </div>

                  {g.latest.summary && (
                    <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                      {excerpt(g.latest.summary)}{' '}
                      <Link
                        href={`/humanoid/research/${g.latest.id}`}
                        className="text-foreground whitespace-nowrap underline"
                      >
                        자세히
                      </Link>
                    </p>
                  )}

                  {g.history.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.key)}
                      className="text-muted-foreground mt-1.5 inline-flex items-center gap-1 text-xs underline"
                    >
                      {historyOpen ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      이전 리포트 {g.history.length}건
                    </button>
                  )}

                  {historyOpen && (
                    <ul className="border-border mt-2 ml-4 space-y-2 border-l pl-4">
                      {g.history.map((h) => (
                        <li key={h.id}>
                          <Link
                            href={`/humanoid/research/${h.id}`}
                            className="block text-xs hover:underline"
                          >
                            {h.title}
                          </Link>
                          <ReportMeta row={h} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
