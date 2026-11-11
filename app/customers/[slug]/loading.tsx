import PageLoading from '@/components/common/PageLoading';

/** 회사 탭을 누른 즉시 뼈대를 보인다 — 없으면 캐시가 빈 첫 이동에서 2초가량 화면이 그대로 멈춰 있었다(2026-11-11 실측). */
export default function CustomerLoading() {
  return <PageLoading />;
}
