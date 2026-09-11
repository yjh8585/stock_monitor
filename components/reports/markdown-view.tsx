'use client';

import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';

import { MermaidBlock } from './mermaid-block';
import { YoutubeBlock } from './youtube-block';

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
 * rehype 플러그인 — **순서가 전부다.**
 *
 *  - rehype-raw: 본문 안의 HTML 을 실제 노드로 판다. 이게 없으면 react-markdown 은
 *    HTML 을 **글자 그대로** 찍는다. 🔴 2026-09-11 사용자 지적(리포트 115): GFM 표 셀의
 *    줄바꿈 `<br>` 가 화면에 `<br>` 라는 글자로 그대로 보였다. GFM 표 셀 안에서
 *    줄을 바꾸는 문법은 `<br>` 뿐이라 이 플러그인 없이는 방법이 없다.
 *  - rehype-sanitize: 그 HTML 을 **반드시 뒤에서** 씻어 낸다. 본문에는 외부 PDF·웹을
 *    LLM 이 요약한 결과가 들어오므로(`report-pdf.service` · `report-web.service`)
 *    적대적 원문의 `<img onerror=…>` 가 섞일 수 있다. 기본 스키마(GitHub)가
 *    `br`·`b`·`sup` 같은 서식 태그만 남기고 스크립트·이벤트 핸들러를 걷어낸다.
 *
 * 🔴 **sanitize 를 raw 앞에 두거나 빼면 XSS 가 열린다.** 순서를 바꾸지 말 것.
 */
const rehypePlugins: Options['rehypePlugins'] = [rehypeRaw, rehypeSanitize];

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

    // ```youtube — 플레이어 + 주요 장면 표. 시각 클릭 시 제자리에서 그 지점으로 점프.
    if (language === 'youtube') {
      return <YoutubeBlock spec={value} />;
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
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {preprocess(content)}
      </ReactMarkdown>
    </article>
  );
}
