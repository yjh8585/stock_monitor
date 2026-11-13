/** 협력사 목록 뼈대 — 제목·탭은 app/oem/layout.tsx 가 이미 그리므로 본문 자리만. */
export default function SuppliersLoading() {
  return (
    <div className="space-y-3 px-6 py-4">
      <div className="h-4 w-[32rem] max-w-full animate-pulse rounded bg-muted" />
      <div className="h-8 w-full animate-pulse rounded bg-muted" />
      <div className="h-64 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}
