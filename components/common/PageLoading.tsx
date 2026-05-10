interface PageLoadingProps {
  title?: string;
}

/**
 * 라우트 loading.tsx 공통 컴포넌트.
 * Next.js App Router의 Suspense fallback 역할.
 * 페이지 헤더 자리 + 본문 스켈레톤만 표시 (사용자에게 로딩 중임을 명확히).
 */
export default function PageLoading({ title }: PageLoadingProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        {title ? (
          <h1 className="text-lg font-semibold">{title}</h1>
        ) : (
          <div className="h-6 w-40 bg-muted animate-pulse rounded" />
        )}
        <div className="h-3 w-60 bg-muted animate-pulse rounded mt-1.5" />
      </div>
      <div className="flex-1 p-6 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 bg-muted/50 animate-pulse rounded" />
        ))}
      </div>
    </div>
  );
}
