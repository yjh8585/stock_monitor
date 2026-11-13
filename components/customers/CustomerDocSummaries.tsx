// 서버 컴포넌트 — 요약 줄·쪽 목록만 그린다(캡처 썸네일만 클라이언트 부품).
import type { DocSummary, Importance } from '@/lib/customers/summaries';
import { docTypeLabel } from '@/lib/customers/format';
import CustomerDocPageGallery from './CustomerDocPageGallery';
import ScrollToDocHash from './ScrollToDocHash';
import SummaryLine from './SummaryLine';

const SHOWN = 6;

const IMPORTANCE: Record<Importance, { label: string; cls: string }> = {
  high: { label: '중요도 상', cls: 'text-rose-600' },
  mid: { label: '중요도 중', cls: 'text-muted-foreground' },
  low: { label: '중요도 하', cls: 'text-muted-foreground' },
};

function SummaryCard({ d }: { d: DocSummary }) {
  const imp = IMPORTANCE[d.importance];
  return (
    // id = 요약 표 「최근 중요 문서」 링크의 앵커(#doc-<docId>)
    <li id={`doc-${d.docId}`} className="scroll-mt-4 space-y-2 px-3 py-2.5">
      {/* 머리 줄 — 자료실(CustomerDocumentList)과 같은 모양: 날짜 · 종류 배지 · 제목 원문 링크 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <span className="w-24 shrink-0 tabular-nums text-xs text-muted-foreground">
          {d.publishedAt}
        </span>
        <span className="rounded bg-muted px-1.5 text-[11px] leading-5">
          {docTypeLabel(d.docType)}
        </span>
        <a
          href={d.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate hover:underline"
          title={d.title}
        >
          {d.title}
        </a>
        <span
          className={`rounded bg-muted px-1.5 text-[11px] leading-5 ${imp.cls}`}
          title={d.importance === 'high' && d.importanceReason ? d.importanceReason : undefined}
        >
          {imp.label}
        </span>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {d.lines.map((line, i) => (
          <li key={i}>
            <SummaryLine line={line} />
          </li>
        ))}
      </ul>
      <CustomerDocPageGallery docId={d.docId} pages={d.pages} />
    </li>
  );
}

/**
 * 「공식 문서 요약」 — 공식 문서마다 한국어 3~5줄(API 요약 · 코드 검사 통과분만) + 근거 쪽 캡처.
 * 최근 6건 + 나머지는 「더 보기」. 0건이면 절을 통째로 숨긴다.
 */
export default function CustomerDocSummaries({ summaries }: { summaries: DocSummary[] }) {
  if (summaries.length === 0) return null;
  const head = summaries.slice(0, SHOWN);
  const rest = summaries.slice(SHOWN);
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">공식 문서 요약</h2>
      <ul className="divide-y divide-border rounded-md border border-border">
        {head.map((d) => (
          <SummaryCard key={d.docId} d={d} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            더 보기({rest.length}건)
          </summary>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {rest.map((d) => (
              <SummaryCard key={d.docId} d={d} />
            ))}
          </ul>
        </details>
      )}
      <ScrollToDocHash />
      <p className="text-xs text-muted-foreground">
        회사 공식 문서를 AI 가 한국어로 요약하고 숫자를 원문과 대조한 것만 싣는다 — 판단 전 원문
        확인.
      </p>
    </section>
  );
}
