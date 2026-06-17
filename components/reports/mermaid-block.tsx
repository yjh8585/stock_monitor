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
        // 한글 라벨이 상자 밖으로 잘리는 문제 방지:
        //  - htmlLabels=true → 라벨을 foreignObject(HTML)로 렌더해 노드가 내용 크기에 맞춰 확장.
        //  - fontFamily 를 'inherit' 대신 한글 글꼴 포함 구체값으로 고정 → mermaid 의 텍스트 폭
        //    측정 글꼴과 실제 렌더 글꼴이 일치해 폭이 좁게 계산되지 않음.
        const fontStack =
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", Pretendard, Roboto, sans-serif';
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          fontFamily: fontStack,
          themeVariables: { fontFamily: fontStack },
          flowchart: { htmlLabels: true, useMaxWidth: true, padding: 12 },
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
        <pre className="overflow-x-auto text-sm">
          <code>{chart}</code>
        </pre>
      </div>
    );
  }

  return <div ref={containerRef} className="my-4 flex w-full justify-center overflow-x-auto" />;
}
