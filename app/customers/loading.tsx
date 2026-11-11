import PageLoading from '@/components/common/PageLoading';

/** 요약 탭으로 돌아올 때도 같은 뼈대 — 캐시가 빈 첫 진입은 6초가량 걸렸다(2026-11-11 실측). */
export default function CustomersLoading() {
  return <PageLoading />;
}
