-- UZ Auto 실적을 2실로 정정 (사용자 지시 2026-07-30).
--
-- 배경: pnl_entries는 (basis, year_label, period_month, sil, division, factory, product, customer)를
-- 충돌키로 쓰는 upsert-only 테이블이라 sil이 PK의 일부다. 엑셀이 3실로 남아 있으면 정정 행과
-- 별개 행으로 적재되어 합계가 이중 계산되므로, 수집기(scripts/sync_pnl_excel.py의
-- SIL_BY_CUSTOMER)가 적재 시점에 2실로 정정한다. 이 마이그레이션은 그 정정 이전에 3실로
-- 적재된 기존 행을 한 번 정리한다.
--
-- 안전성: 2026-07-30 확인 시 sil='2실' AND customer='UZ Auto' 행이 0건이라 PK 충돌 없음.
-- 이미 2실이면 0행 갱신 → 재실행 멱등.
update pnl_entries
set sil = '2실'
where customer = 'UZ Auto'
  and sil <> '2실';
