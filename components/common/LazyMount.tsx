'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface LazyMountProps {
  /**
   * 마운트 전 placeholder의 최소 높이.
   * number → px, string → CSS 값(예: 'min-h-[1200px] lg:h-[960px]' 사용 시엔 `placeholderClassName` 권장).
   * 마운트 후에도 동일 minHeight를 유지해 CLS 점프를 막는다.
   */
  minHeight?: number | string;
  /**
   * placeholder + 마운트 후 컨테이너에 함께 적용할 Tailwind class.
   * 반응형 minHeight가 필요할 때 사용(예: 'min-h-[1200px] lg:min-h-[960px]').
   * 지정 시 `minHeight` prop은 무시한다.
   */
  className?: string;
  /** viewport 진입 감지 마진. '200px' = viewport 위/아래 200px 전부터 미리 마운트 */
  rootMargin?: string;
  /** 마운트 전 placeholder 노드 (없으면 빈 div) */
  placeholder?: ReactNode;
  children: ReactNode;
}

/**
 * IntersectionObserver 기반 viewport-진입 시 1회 마운트 래퍼.
 *
 * - 한번 마운트되면 다시 unmount하지 않는다(스크롤 왕복 시 재마운트 비용 회피).
 * - SSR / IntersectionObserver 미지원 환경에서는 다음 프레임에 즉시 마운트.
 * - 마운트 후에도 동일 `minHeight`/`className` 유지 → 컨텐츠가 더 작아도 위 점프 없음.
 *   (`min-height`이므로 컨텐츠가 더 크면 자연스럽게 늘어난다.)
 */
export default function LazyMount({
  minHeight = 280,
  className,
  rootMargin = '200px',
  placeholder,
  children,
}: LazyMountProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    if (typeof IntersectionObserver === 'undefined') {
      const raf = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(raf);
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setMounted(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, rootMargin]);

  const style = className ? undefined : { minHeight };

  return (
    <div ref={ref} className={className} style={style}>
      {mounted ? children : placeholder}
    </div>
  );
}
