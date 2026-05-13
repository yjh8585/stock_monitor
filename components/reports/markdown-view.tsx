'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { MermaidBlock } from './mermaid-block';

interface Props {
  content: string;
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </article>
  );
}
