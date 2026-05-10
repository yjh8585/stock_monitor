'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface PageErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}

/**
 * 라우트 error.tsx 공통 컴포넌트.
 * Next.js App Router의 error boundary 역할 (각 page.tsx에서 throw 시 fallback).
 * - logger.error는 server side에만 동작하므로 여기선 console.error로 클라이언트 측 흔적 남김
 * - reset()으로 라우트 segment 다시 렌더링 시도
 */
export default function PageError({ error, reset, title = '데이터를 불러오지 못했습니다' }: PageErrorProps) {
  useEffect(() => {
    console.error('[PageError]', error);
  }, [error]);

  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-12 text-center">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground mb-1">잠시 후 다시 시도해주세요.</p>
      {error.digest && (
        <p className="text-xs text-muted-foreground/70 mb-4 font-mono">오류 코드: {error.digest}</p>
      )}
      <Button onClick={reset} variant="outline" size="sm">
        다시 시도
      </Button>
    </div>
  );
}
