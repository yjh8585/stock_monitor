// 서버 컴포넌트 — 요약 한 줄의 핵심 구절(`**…**`)을 굵게 + 노란 음영으로 그린다(2026-11-13 사용자 선택).
import { splitHighlight } from '@/lib/customers/summaries';

// 표 행 강조(lib/useRowHighlight.ts ROW_HIGHLIGHT_CLASS)와 같은 노란 음영 — 그 파일은 'use client' 라
// 서버 컴포넌트가 상수를 가져오면 문자열이 아니라 클라이언트 참조가 된다. 그래서 값을 옮겨 적는다.
const MARK_CLASS = 'bg-yellow-100/70 dark:bg-yellow-900/30';

/** 문서 요약·주간 뉴스 요약이 같이 쓴다. 표시가 없는 옛 요약은 글 그대로(별표는 지운다). */
export default function SummaryLine({ line }: { line: string }) {
  const s = splitHighlight(line);
  if (typeof s === 'string') return <>{s}</>;
  return (
    <>
      {s.before}
      <strong className={`rounded-sm px-0.5 font-semibold ${MARK_CLASS}`}>{s.mark}</strong>
      {s.after}
    </>
  );
}
