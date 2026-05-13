'use client';

import { useEffect, useId, useRef, useState } from 'react';

interface Props {
  chart: string;
}

/**
 * Markdown 의 ```mermaid``` 코드 블록을 SVG 다이어그램으로 렌더링한다.
 * mermaid 는 클라이언트 전용이라 동적 import 로 번들 비용을 줄인다.
 */
export function MermaidBlock({ chart }: Props) {
  const id = useId().replace(/[:]/g, '-');
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          fontFamily: 'inherit',
        });
        const { svg } = await mermaid.render(`mermaid-${id}`, chart);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '다이어그램 렌더 실패');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <div className="my-4 rounded-md border border-dashed p-3 text-sm">
        <p className="text-muted-foreground mb-2">다이어그램을 표시하지 못했습니다.</p>
        <pre className="overflow-x-auto text-xs">
          <code>{chart}</code>
        </pre>
      </div>
    );
  }

  return <div ref={containerRef} className="my-4 flex w-full justify-center overflow-x-auto" />;
}
