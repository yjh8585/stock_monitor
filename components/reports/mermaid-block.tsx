'use client';

import { useTheme } from 'next-themes';
import { useEffect, useId, useRef, useState } from 'react';

interface Props {
  chart: string;
}

/**
 * 본문이 `%%{init: …}%%` 로 색을 직접 지정한 다이어그램인가.
 * 이런 도표(리포트 80·81 의 파이·순서도)는 흰 바탕을 전제로 색을 박아 두어
 * 다크 테마로 바꾸면 오히려 색이 어긋난다 → 다크모드에서는 흰 카드 위에 그대로 그린다.
 */
const OWN_THEME_RE = /%%\{\s*init/;

/**
 * Markdown 의 ```mermaid``` 코드 블록을 SVG 다이어그램으로 렌더링한다.
 * mermaid 는 클라이언트 전용이라 동적 import 로 번들 비용을 줄인다.
 *
 * 🔴 다크모드(2026-11-20 사용자 지적 — 경영표준 순서도 화살표가 안 보임):
 * mermaid 는 SVG 에 색을 직접 박으므로 사이트 테마를 따라오지 않는다. 예전엔 `default`
 * 고정이라 검정 배경 위에 #333 화살표가 묻혔다. 사이트 테마가 dark 면 mermaid `dark`
 * 테마로 다시 그리고, 색을 직접 지정한 다이어그램만 흰 카드로 감싼다.
 */
export function MermaidBlock({ chart }: Props) {
  const id = useId().replace(/[:]/g, '-');
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const ownsTheme = OWN_THEME_RE.test(chart);

  useEffect(() => {
    // next-themes 는 마운트 전 resolvedTheme 가 undefined — 밝은 그림을 먼저 그렸다 다시 그리지 않게 기다린다.
    if (!resolvedTheme) return;
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
          theme: resolvedTheme === 'dark' && !ownsTheme ? 'dark' : 'default',
          // 🔴 'loose' 로 되돌리지 말 것(2026-11-20 코드 리뷰) — loose 면 `click` 의 javascript: 링크를
          // 거르지 않는다. 본문은 외부 원문의 LLM 요약이라 악성 블록이 섞일 수 있다. 게시글의 클릭 사용 0.
          securityLevel: 'strict',
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
  }, [chart, id, resolvedTheme, ownsTheme]);

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

  // 색을 직접 지정한 다이어그램: 다크모드에서 흰 카드 + 짙은 글자(HTML 라벨은 본문 글자색을 물려받아
  // prose-invert 의 흰 글자가 밝은 상자 위에 묻힌다).
  const cardClass = ownsTheme ? ' dark:rounded-md dark:bg-white dark:p-3 dark:text-zinc-900' : '';
  return (
    <div
      ref={containerRef}
      className={`my-4 flex w-full justify-center overflow-x-auto${cardClass}`}
    />
  );
}
