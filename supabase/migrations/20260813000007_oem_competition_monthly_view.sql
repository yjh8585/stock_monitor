-- /oem/competition 판매 추이 차트용 월별 시계열 뷰.
--
-- 배경:
--   경쟁 분석 카드가 쓰는 oem_model_outlook.metrics 에는 "최근 12개월 누계"만 있고 월별 추이가
--   없다. 추이 차트를 그리려면 oem_sales_model_country_month(96.9만 행)를 봐야 하는데, 이를
--   앱에서 전량 fetch 하면 프리렌더가 느려지고 RSC 페이로드가 커진다(ISR Write 한도 이슈 —
--   docs/isr-write-optimization.md). 경쟁군 정의로 DB 에서 미리 걸러 약 2.1천 행만 남긴다.
--
-- 설계:
--   - 경쟁군 정의(oem_competitor_set)가 SSOT 다. 이 뷰는 정의를 그대로 따라가므로 경쟁군을
--     고치면 차트도 자동으로 따라온다.
--   - countries IS NULL = 전 국가 합산(GLOBAL). 아니면 country = ANY(countries).
--     ⚠️ oem_sales_model_country_month.country 에 'Europe' 같은 대륙 값은 없다(개별 국가만).
--   - 한 논리 시장이 여러 국가면(유럽 14개국) 국가를 합산하므로 SUM 이 필요하다.
--     🔴 ::bigint 캐스팅 필수 — SUM(bigint)=numeric 이라 PostgREST 가 문자열로 직렬화하고
--     JS 산술이 조용히 깨진다.
--   - 최근 약 36개월만: 화면은 24개월을 그리지만 YoY 계산에 직전 12개월이 더 필요하다.
--
-- 갱신: 일반 뷰라 원본 적재 즉시 반영된다(구체화 뷰가 아니므로 refresh 불필요).

CREATE OR REPLACE VIEW oem_competition_monthly_view AS
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
WHERE m.year_month >= (
  -- 최신월에서 3년 전 같은 달 (예: 202607 → 202307)
  SELECT ((MAX(year_month) / 100) - 3) * 100 + (MAX(year_month) % 100)
  FROM oem_sales_model_country_month
)
GROUP BY cs.model_key, cs.market, cs.market_label, cs.display_order,
         m.model, (m.model = ANY (cs.target_models)), m.year_month;

-- 호출자(anon) 권한으로 RLS 를 평가한다. 두 base 테이블 모두 anon SELECT 정책이 있다.
ALTER VIEW oem_competition_monthly_view SET (security_invoker = true);

GRANT SELECT ON oem_competition_monthly_view TO anon, authenticated;

COMMENT ON VIEW oem_competition_monthly_view IS
  '/oem/competition 판매 추이 — 경쟁군(oem_competitor_set) 정의를 따른 모델×시장×월 판매. 최근 약 36개월.';
