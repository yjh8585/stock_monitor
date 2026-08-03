-- OEM 대시보드(/oem) 집계 뷰 2종 → 구체화 뷰(materialized view) 전환.
--
-- 배경:
--   20260714000001이 같은 문제("프리렌더 statement timeout으로 배포 간헐 ERROR")를 고치려고
--   집계를 DB로 옮겼지만, **일반 뷰는 계산을 옮긴 게 아니라 이름만 붙인 것**이다.
--   조회할 때마다 oem_sales_group_country_month(12.3만 행)를 Seq Scan + HashAggregate 한다.
--   그때 줄어든 것은 앱으로 가는 **행 수**(12.2만 → 4천)일 뿐 DB 계산 비용은 그대로였다.
--   그래서 2026-08-03 배포가 같은 이유로 다시 실패했다(문서만 고친 커밋인데 빌드가 깨졌다).
--     Error: Supabase oem_sales_country_group_year 조회 실패:
--            canceling statement due to statement timeout  → /oem 프리렌더 중단 → 빌드 exit 1
--
-- 이 마이그레이션이 하는 일:
--   집계 결과를 **실제로 저장**해 조회를 인덱스 스캔으로 바꾼다.
--   실측(2026-08-03): 일반 뷰 = 80ms(12.3만 행 재집계). 구체화 뷰 = 저장된 1.2만 행 인덱스 조회.
--   timeout까지의 여유가 수십 배 늘어 DB가 일시적으로 느려져도 빌드가 버틴다.
--
-- 🔴 대가: 자동 갱신이 안 된다. 원본을 적재한 뒤 refresh_oem_agg_views()를 불러야 한다.
--   빼먹으면 /oem이 옛 값을 보여준다(조용한 실패) → import_oem_sales.py가 upsert 직후 호출한다.
--   일반 뷰 시절의 "뷰는 원본을 실시간 반영"이라는 전제가 여기서 깨지므로 문서도 함께 고쳤다.
--
-- 앱 코드 변경 없음: 이름·컬럼·타입이 동일하고 PostgREST는 구체화 뷰도 그대로 조회한다.

BEGIN;

DROP VIEW IF EXISTS oem_sales_country_group_year;
DROP VIEW IF EXISTS oem_sales_usa_group_month;

-- 연·OEM·국가별 판매 합계 (국가 TOP15 / OEM×국가 매트릭스용)
CREATE MATERIALIZED VIEW oem_sales_country_group_year AS
SELECT (year_month / 100)::int AS year,
       oem_group,
       country,
       SUM(sales)::bigint AS sales
FROM oem_sales_group_country_month
GROUP BY (year_month / 100), oem_group, country;

-- USA 시장 OEM·월별 판매 합계 (미국 TOP10 OEM 월별 시계열용)
CREATE MATERIALIZED VIEW oem_sales_usa_group_month AS
SELECT oem_group,
       year_month,
       SUM(sales)::bigint AS sales
FROM oem_sales_group_country_month
WHERE country = 'USA'
GROUP BY oem_group, year_month;

-- 유니크 인덱스: 앞으로 REFRESH ... CONCURRENTLY 를 쓸 수 있게 열어 둔다(현재는 일반 REFRESH).
-- 동시에 source.ts의 .order(oem_group).order(country) 결정적 페이지네이션도 이 인덱스를 탄다.
CREATE UNIQUE INDEX oem_sales_country_group_year_pk
  ON oem_sales_country_group_year (year, oem_group, country);
CREATE UNIQUE INDEX oem_sales_usa_group_month_pk
  ON oem_sales_usa_group_month (oem_group, year_month);

-- source.ts fetchCountryGroupYear가 .eq('year', TARGET_YEAR)로 한 해만 받는다.
-- 위 유니크 인덱스의 선두 컬럼이 year라 별도 인덱스는 필요 없다.

GRANT SELECT ON oem_sales_country_group_year TO anon, authenticated;
GRANT SELECT ON oem_sales_usa_group_month TO anon, authenticated;

-- 갱신 함수 — 수집 스크립트(import_oem_sales.py)가 원본 upsert 직후 RPC로 부른다.
-- PostgREST로는 임의 SQL을 실행할 수 없어 함수로 감싼다.
-- CONCURRENTLY를 쓰지 않는 이유: 함수 본문은 트랜잭션 안이라 CONCURRENTLY가 금지된다.
-- 1.2만 행 재집계는 100ms 안쪽이라 짧은 락은 수용 가능하다.
CREATE OR REPLACE FUNCTION refresh_oem_agg_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW oem_sales_country_group_year;
  REFRESH MATERIALIZED VIEW oem_sales_usa_group_month;
END;
$$;

-- 🔴 공개 금지: 갱신은 수집 파이프라인(service_role)만 한다.
REVOKE ALL ON FUNCTION refresh_oem_agg_views() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_oem_agg_views() TO service_role;

COMMIT;
