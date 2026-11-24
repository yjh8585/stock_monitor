-- market_series_live 쓰기 구멍 막기 (2026-11-24 사용자 선택 「막기」)
-- 실측: 정책 service_write_market_series_live 가 이름과 달리 roles={public}·USING(true) 인 ALL 정책이라
--       anon(공개 키)도 INSERT·UPDATE·DELETE 가 되는 상태였다(anon 표 권한도 전부 열려 있었다).
-- 쓰기는 수집 스크립트(scripts/collect_market_series_live.py)가 service_role 로만 한다 — service_role 은 RLS 를 건너뛰므로 정책이 필요 없다.
-- 읽기 정책 anon_read_market_series_live(SELECT)는 그대로 둔다(사이트 lib/series.ts 가 읽는다).
drop policy if exists service_write_market_series_live on public.market_series_live;
revoke insert, update, delete, truncate, references, trigger on public.market_series_live from anon, authenticated;
