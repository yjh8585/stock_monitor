'use client';

/**
 * 챗봇 답변용 가벼운 마크다운 렌더러.
 * - react-markdown + remark-gfm (테이블·체크박스·자동링크)
 * - 작은 prose 스타일로 챗 버블에 맞춤 (제목 작게, 여백 좁게, 테이블 가로 스크롤)
 * - 코드 블록은 단순 표시 (mermaid 등은 지원 안 함)
 */
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  // 헤더 — 작게 표시
  h1: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mt-1.5 mb-0.5 text-xs font-semibold first:mt-0">{children}</h6>,
  // 단락
  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
  // 리스트
  ul: ({ children }) => <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  // 강조
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  // 인용
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-border pl-2 text-muted-foreground">
      {children}
    </blockquote>
  ),
  // 링크 — 새 창
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  // 표 — 가로 스크롤 + 작은 글씨
  table: ({ children }) => (
    <div className="my-1.5 -mx-1 overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-background/60">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border/60 px-1.5 py-0.5 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-border/60 px-1.5 py-0.5 align-top">{children}</td>
  ),
  // 코드 — 단순 표시
  code: ({ className, children }) => {
    const isInline = !className?.startsWith('language-');
    if (isInline) {
      return (
        <code className="rounded bg-background/60 px-1 py-px font-mono text-[11px]">
          {children}
        </code>
      );
    }
    return (
      <code className="block overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-1.5">{children}</pre>,
  hr: () => <hr className="my-2 border-border/50" />,
};

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
