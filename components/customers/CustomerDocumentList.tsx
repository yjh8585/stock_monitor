// 서버 컴포넌트 — 링크 목록뿐이라 클라이언트 코드가 필요 없다.
import type { CollectStatusItem, CustomerDocumentItem } from '@/lib/customers/source';
import { docTypeLabel, seoulDate } from '@/lib/customers/format';

const SOURCE: Record<string, string> = { dart: 'DART', edgar: 'SEC EDGAR', ir: '회사 IR' };
const PROBLEM: Record<string, string> = {
  blocked: '차단',
  parse_failed: '읽기 실패',
  error: '오류',
};

interface Props {
  documents: CustomerDocumentItem[];
  collectStatus: CollectStatusItem[];
}

/** 수집이 막히거나 읽기에 실패한 수집기 — 절 머리 한 줄(예: IR 사이트 403). */
export function CollectProblems({ items }: { items: CollectStatusItem[] }) {
  const bad = items.filter((s) => s.status in PROBLEM);
  if (bad.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs text-rose-600">
      {bad.map((s) => (
        <li key={s.collector}>
          수집 {PROBLEM[s.status]}({s.collector} · {seoulDate(s.checked_at)} 확인) —{' '}
          {s.reason ?? '사유 미기록'}
        </li>
      ))}
    </ul>
  );
}

/** 자료실 — 공시·IR 문서 목록(종류 배지 · 날짜 · 원문 새 창). 최근 40건. */
export default function CustomerDocumentList({ documents, collectStatus }: Props) {
  return (
    <div className="space-y-2">
      <CollectProblems items={collectStatus} />
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">수집된 문서가 없다.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5">
              <span className="w-24 shrink-0 tabular-nums text-xs text-muted-foreground">
                {d.published_at}
              </span>
              <span className="rounded bg-muted px-1.5 text-[11px] leading-5">
                {docTypeLabel(d.doc_type)}
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
              <span className="text-[11px] text-muted-foreground">
                {SOURCE[d.source] ?? d.source}
                {/* IR 행의 form 은 목록 페이지 이름(releaseList 등)이라 공시 양식(8-K·I002)만 보인다 */}
                {d.form && d.source !== 'ir' && d.form !== d.title ? ` · ${d.form}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
