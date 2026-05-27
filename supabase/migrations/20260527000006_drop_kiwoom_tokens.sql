-- 키움증권(Kiwoom) 토큰 캐시 테이블 제거.
-- 한세 장중 데이터는 2026-05-20 KIS OpenAPI로 전환(commit 9810cd6)되었고,
-- 키움 경로(lib/kiwoom/*, /api/cron/quotes-5min)는 더 이상 사용되지 않아 코드와 함께 삭제한다.
-- kiwoom_tokens는 0행·미사용 상태였다. (DROP이 연관 RLS 정책도 함께 제거)
DROP TABLE IF EXISTS public.kiwoom_tokens;
