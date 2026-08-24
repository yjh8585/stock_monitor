'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Search } from 'lucide-react';

import type { ResearchGroup, ResearchReportRow } from '@/lib/humanoid/research';

interface Props {
  groups: ResearchGroup[];
  brokers: string[];
  total: number;
  summarized: number;
}

const PERIODS = [
  { label: '전체', months: 0 },
  { label: '1개월', months: 1 },
  { label: '3개월', months: 3 },
] as const;

/** 오늘로부터 n개월 전 날짜(YYYY-MM-DD). n=0 이면 null(=제한 없음). */
function monthsAgo(n: number): string | null {
  if (n <= 0) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function ReportMeta({ row }: { row: ResearchReportRow }) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span>{row.publishedAt ?? '날짜 미상'}</span>
      {row.opinion && <span className="text-foreground font-medium">{row.opinion}</span>}
      {row.targetPrice !== null && <span>목표 {row.targetPrice.toLocaleString()}</span>}
      {row.isPeriodic && <span className="rounded bg-muted px-1.5 py-0.5">정기물</span>}
      {row.isDelta && <span className="rounded bg-muted px-1.5 py-0.5">변화분</span>}
      {row.pdfUrl && (
        <a
          href={row.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
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
 * 증권사 리포트 목록 — (증권사, 대상) 묶음을 접어서 보여 준다.
 *
 * 필터는 서버 왕복 없이 클라이언트에서 건다. 데이터가 이미 전량 내려와 있어
 * URL 을 오갈 이유가 없고, 그 편이 훑어보는 흐름이 끊기지 않는다.
 */
export function ResearchList({ groups, brokers, total, summarized }: Props) {
  const [broker, setBroker] = useState('');
  const [term, setTerm] = useState('');
  const [months, setMonths] = useState(0);
  const [onlySummarized, setOnlySummarized] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [openSummaries, setOpenSummaries] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const floor = monthsAgo(months);
    const needle = term.trim().toLowerCase();

    return groups.filter((g) => {
      if (broker && g.broker !== broker) return false;
      if (onlySummarized && g.latest.summary === null) return false;
      if (floor && (g.latest.publishedAt ?? '') < floor) return false;
      if (needle) {
        const hay = `${g.targetName} ${g.ticker ?? ''} ${g.latest.title}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [groups, broker, term, months, onlySummarized]);

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
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
          요약된 것만
        </label>

        <span className="text-muted-foreground ml-auto text-xs">
          묶음 {filtered.length.toLocaleString()} · 리포트 {total.toLocaleString()}건 (요약{' '}
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
              const summaryOpen = openSummaries.has(g.latest.id);
              return (
                <li key={g.key} className="px-6 py-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{g.targetName}</span>
                        {g.ticker && (
                          <span className="text-muted-foreground text-xs">{g.ticker}</span>
                        )}
                        {g.tracked && (
                          <span className="bg-foreground text-background rounded px-1.5 py-0.5 text-[10px]">
                            추적
                          </span>
                        )}
                        <span className="text-muted-foreground text-xs">{g.broker}</span>
                      </div>

                      <p className="mt-0.5 text-sm">{g.latest.title}</p>
                      <div className="mt-1">
                        <ReportMeta row={g.latest} />
                      </div>

                      {g.latest.summary && (
                        <button
                          type="button"
                          onClick={() => toggle(openSummaries, g.latest.id, setOpenSummaries)}
                          className="text-muted-foreground mt-1.5 inline-flex items-center gap-1 text-xs underline"
                        >
                          {summaryOpen ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          요약 {summaryOpen ? '접기' : '펼치기'}
                        </button>
                      )}

                      {summaryOpen && g.latest.summary && (
                        <div className="bg-muted/40 mt-2 rounded p-3 text-xs leading-relaxed whitespace-pre-wrap">
                          {g.latest.summary}
                        </div>
                      )}

                      {g.history.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggle(openGroups, g.key, setOpenGroups)}
                          className="text-muted-foreground mt-1.5 ml-3 inline-flex items-center gap-1 text-xs underline"
                        >
                          {historyOpen ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          이전 리포트 {g.history.length}건
                        </button>
                      )}
                    </div>
                  </div>

                  {historyOpen && (
                    <ul className="border-border mt-2 ml-4 space-y-2 border-l pl-4">
                      {g.history.map((h) => (
                        <li key={h.id}>
                          <p className="text-xs">{h.title}</p>
                          <ReportMeta row={h} />
                          {h.summary && (
                            <details className="mt-1">
                              <summary className="text-muted-foreground cursor-pointer text-xs underline">
                                요약
                              </summary>
                              <div className="bg-muted/40 mt-1 rounded p-2 text-xs leading-relaxed whitespace-pre-wrap">
                                {h.summary}
                              </div>
                            </details>
                          )}
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
