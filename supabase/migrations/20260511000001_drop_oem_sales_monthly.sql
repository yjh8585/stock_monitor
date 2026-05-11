-- OEM raw long 테이블 제거 (실제 적재 코드 없는 dead 테이블).
--
-- 배경: 20260510000001에서 oem_sales_monthly + 인덱스 3개를 만들었으나,
-- scripts/import_oem_sales.py는 사전 집계 4종만 적재하고 raw 테이블은 비워둠
-- (적재 코드 주석으로 명시). 차트도 모두 사전 집계만 사용.
-- → 영구 빈 테이블 + 사용 안 되는 인덱스 제거. 추후 raw 단위 분석이 필요해지면
-- 별도 마이그레이션으로 다시 추가.
--
-- DROP TABLE은 의존 인덱스/정책을 자동 삭제 (CASCADE 불필요).

DROP TABLE IF EXISTS oem_sales_monthly;
