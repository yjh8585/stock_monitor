-- `oem_competition_monthly_view` 일반 뷰 → **구체화 뷰** 전환.
--
-- 왜 (2026-08-13 실측):
--   20260813000007 의 일반 뷰는 전체 조회에 **4,867ms** 가 걸려 PostgREST anon 의
--   statement timeout(57014 canceling statement due to statement timeout)에 걸렸고,
--   `/oem/competition` 의 판매 추이 차트가 **전 차종에서 통째로 비었다**(에러 없이 빈 차트).
--   dev 로그의 `oem_competition_monthly_view 조회 실패` 한 줄이 유일한 단서였다.
--
--   실행계획상 원인 2개:
--     1. `year_month >= (SELECT MAX(year_month) …)` 서브쿼리가 48만 행을 스캔해 **780ms**.
--        → 현재월 기준 `CURRENT_DATE - INTERVAL '36 months'` 로 바꿔 없앴다.
--     2. 진짜 병목은 중첩 루프 — `model = ANY(배열)` 로 인덱스를 탄 뒤 **country 필터가
--        인덱스를 못 타** 루프마다 2,413 행을 버린다(14 루프 × 345ms). 인덱스를 더 얹어
--        푸는 방법도 있으나, 결과가 3천 행뿐이라 아예 저장해 두는 편이 단순하고 확실하다.
--
--   이 레포는 같은 실수를 이미 한 번 했다 — `/oem` 집계 뷰도 일반 뷰로는 부족해
--   20260803000003 에서 구체화 뷰로 전환했다(Architecture.md §7-E).
--
-- 갱신: **새 배관을 만들지 않는다.** 기존 `refresh_oem_agg_views()` 에 한 줄 얹었고,
--   유일한 원본 적재 스크립트 `import_oem_sales.py` 가 적재 후 이 RPC 를 이미 호출한다.
--   🔴 구체화 뷰는 자동 갱신되지 않으므로 다른 경로로 원본을 적재하면 이 RPC 를 반드시 부를 것.
--
-- 실측 결과: 4,867ms → **23ms**.

DROP VIEW IF EXISTS oem_competition_monthly_view;

CREATE MATERIALIZED VIEW oem_competition_monthly_view AS
SELECT
  cs.model_key,
  cs.market,
  cs.market_label,
  cs.display_order,
  m.model,
  (m.model = ANY (cs.target_models)) AS is_target,
  m.year_month,
  SUM(m.sales)::bigint AS sales
FROM oem_competitor_set cs
JOIN oem_sales_model_country_month m
  ON m.model = ANY (cs.target_models || cs.competitor_models)
 AND (cs.countries IS NULL OR m.country = ANY (cs.countries))
WHERE m.year_month >= to_char(CURRENT_DATE - INTERVAL '36 months', 'YYYYMM')::int
GROUP BY cs.model_key, cs.market, cs.market_label, cs.display_order,
         m.model, (m.model = ANY (cs.target_models)), m.year_month;

-- is_target 은 (model_key, market, model) 로 결정되므로 이 4개 조합이 유일하다.
-- UNIQUE 여야 필요할 때 `REFRESH MATERIALIZED VIEW CONCURRENTLY` 를 쓸 수 있다.
CREATE UNIQUE INDEX idx_oem_comp_monthly_pk
  ON oem_competition_monthly_view (model_key, market, model, year_month);

GRANT SELECT ON oem_competition_monthly_view TO anon, authenticated;

COMMENT ON MATERIALIZED VIEW oem_competition_monthly_view IS
  '/oem/competition 판매 추이 — 경쟁군(oem_competitor_set) 정의를 따른 모델×시장×월 판매. 최근 36개월. refresh_oem_agg_views()로 갱신.';

CREATE OR REPLACE FUNCTION public.refresh_oem_agg_views()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW oem_sales_country_group_year;
  REFRESH MATERIALIZED VIEW oem_sales_usa_group_month;
  REFRESH MATERIALIZED VIEW oem_competition_monthly_view;
END;
$function$;
