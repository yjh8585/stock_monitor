-- OEM 대시보드(/oem) 집계 뷰 2종.
--
-- 배경:
--   /oem 프리렌더가 oem_sales_group_country_month(약 12.2만 행)를 앱으로 전량 fetch 후
--   JS에서 GROUP BY 집계 → 빌드 프리렌더에서 statement timeout / USE_CACHE_TIMEOUT 유발
--   (github-actions 백업 커밋 배포가 간헐 ERROR). 무거운 SUM 집계를 DB로 이관해
--   fetch 행수를 약 12.2만 → 약 4천(뷰1 2025 ~1.9천 + 뷰2 USA 전체 ~1.8천)으로 축소.
--
-- 정확성:
--   두 뷰는 순수 SUM 재집계(결합법칙)라 기존 JS 집계와 값이 완전히 일치한다.
--   sales는 bigint → SUM(bigint)=numeric(PostgREST가 문자열 직렬화)이므로 ::bigint로
--   캐스팅해 number로 반환(기존 개별 sales와 동일 타입).
--
-- cacheTag: source.ts는 원본 테이블 태그(oem_sales_group_country_month)를 그대로 유지한다.
--   뷰는 원본을 실시간 반영하므로 수집 시 원본 무효화만으로 /oem 캐시가 갱신된다.

-- 연·OEM·국가별 판매 합계 (2025 국가 TOP15 / OEM×국가 매트릭스용)
CREATE OR REPLACE VIEW oem_sales_country_group_year AS
SELECT (year_month / 100)::int AS year,
       oem_group,
       country,
       SUM(sales)::bigint AS sales
FROM oem_sales_group_country_month
GROUP BY (year_month / 100), oem_group, country;

-- USA 시장 OEM·월별 판매 합계 (미국 TOP10 OEM 월별 시계열용)
CREATE OR REPLACE VIEW oem_sales_usa_group_month AS
SELECT oem_group,
       year_month,
       SUM(sales)::bigint AS sales
FROM oem_sales_group_country_month
WHERE country = 'USA'
GROUP BY oem_group, year_month;

-- 공개 SELECT (원본 테이블과 동일 노출 범위 — 기존 OEM 데이터는 anon 조회 대상)
GRANT SELECT ON oem_sales_country_group_year TO anon, authenticated;
GRANT SELECT ON oem_sales_usa_group_month TO anon, authenticated;
