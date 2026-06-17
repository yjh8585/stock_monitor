'use client';

import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';

import { MermaidBlock } from './mermaid-block';

interface Props {
  content: string;
}

/**
 * remark 플러그인:
 *  - remark-gfm: 표/체크박스 등. `singleTilde: false` 로 단일 '~'(예: 50~60)를
 *    취소선으로 오인해 인접 강조(**)를 삼키는 문제를 방지.
 *  - remark-cjk-friendly: 한글 등 CJK 인접 강조(**'피지컬 AI'**가)가 렌더되도록 flanking 보정.
 */
const remarkPlugins: Options['remarkPlugins'] = [
  [remarkGfm, { singleTilde: false }],
  remarkCjkFriendly,
];

/**
 * 단독 줄 `<br>` 는 (뒤에 빈 줄이 없으면) 다음 문단을 HTML 블록으로 흡수해
 * 그 문단의 마크다운(**, #, - 등)을 통째로 무력화한다. 해당 줄만 제거.
 * 표 셀 안/문장 중간의 `<br>` 는 줄바꿈 용도이므로 건드리지 않는다.
 */
function preprocess(content: string): string {
  return content.replace(/^[ \t]*<br\s*\/?>[ \t]*$/gim, '');
}

const components: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? '');
    const language = match?.[1];
    const value = String(children).replace(/\n$/, '');

    if (language === 'mermaid') {
      return <MermaidBlock chart={value} />;
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

export function MarkdownView({ content }: Props) {
  return (
    <article className="prose prose-zinc dark:prose-invert prose-headings:scroll-mt-20 prose-pre:bg-muted prose-pre:text-foreground prose-table:my-4 max-w-none">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {preprocess(content)}
      </ReactMarkdown>
    </article>
  );
}
