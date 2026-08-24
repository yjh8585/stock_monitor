-- /humanoid 페이지 합성 뷰 — parts_top100_stocks_view(20260521000001) 구조를 따른다.
--
-- 원본과 달라지는 점 3가지:
--   1) JOIN 조건이 company_pages.page = 'humanoid'
--   2) c.customers 대신 '[]'::jsonb — 🔴 고객사는 수집하지 않는다(사용자 결정 2026-08-24).
--      컬럼 자체를 빼지 않고 빈 배열을 두는 이유: lib/types.ts 의 mapDomesticStockRow 가
--      r.customers 를 읽으므로 없애면 TS 가 죽는다. 빈 배열이면 매퍼를 그대로 재사용하면서
--      payload 도 거의 늘지 않고, 화면에서는 고객사 컬럼을 아예 그리지 않는다.
--   3) robot_roles + 비상장 지표 3종을 싣는다 (역할 버튼 · 비상장사 규모 표시)
--
-- 원본과 같게 유지하는 것:
--   - period_end_date <= now() 가드 (미발표 미래 회계연도 차단 — 원본 도입 사유)
--   - country 한글 매핑 CASE, sales_rank = 매출 KRW 내림차순 NULLS LAST
--   - business_summary / summary_updated_at 은 **싣지 않는다**(ISR payload 절감,
--     docs/isr-write-optimization.md ⑥ — 펼칠 때 useCompanySummary 훅이 따로 받아온다)

DROP VIEW IF EXISTS humanoid_stocks_view;

CREATE VIEW humanoid_stocks_view AS
WITH latest_fin_currency AS (
  SELECT DISTINCT ON (company_id) company_id, currency
  FROM financials
  WHERE period_type = 'annual' AND currency IS NOT NULL
  ORDER BY company_id, fiscal_year DESC
),
humanoid_base AS (
  SELECT
    c.id, c.ticker, c.name, c.name_kr, c.market, c.country, c.currency, c.status,
    c.company_type,
    CASE c.country
      WHEN 'DE' THEN '독일'
      WHEN 'JP' THEN '일본'
      WHEN 'US' THEN '미국'
      WHEN 'CN' THEN '중국'
      WHEN 'KR' THEN '한국'
      WHEN 'FR' THEN '프랑스'
      WHEN 'IT' THEN '이탈리아'
      WHEN 'ES' THEN '스페인'
      WHEN 'CH' THEN '스위스'
      WHEN 'CA' THEN '캐나다'
      WHEN 'IE' THEN '아일랜드'
      WHEN 'NL' THEN '네덜란드'
      WHEN 'SE' THEN '스웨덴'
      WHEN 'NO' THEN '노르웨이'
      WHEN 'BE' THEN '벨기에'
      WHEN 'SI' THEN '슬로베니아'
      WHEN 'IN' THEN '인도'
      WHEN 'MX' THEN '멕시코'
      WHEN 'AT' THEN '오스트리아'
      WHEN 'GB' THEN '영국'
      WHEN 'HK' THEN '홍콩'
      WHEN 'TW' THEN '대만'
      ELSE c.country
    END AS group_name,
    c.products,
    -- 고객사 미수집 — 매퍼 호환을 위한 빈 배열
    '[]'::jsonb AS customers,
    c.robot_roles,
    c.valuation_usd, c.funding_total_usd, c.valuation_asof,
    c.last_price, c.last_change_pct, c.last_updated_at, c.market_cap,
    c.homepage_url,
    COALESCE(er.rate, CASE WHEN c.currency = 'KRW' THEN 1 ELSE NULL END) AS fx_to_krw,
    (
      SELECT jsonb_object_agg(f.fiscal_year::text, jsonb_build_object(
        'revenue', f.revenue, 'operating_income', f.operating_income,
        'operating_margin', f.operating_margin,
        'total_liabilities', f.total_liabilities, 'total_equity', f.total_equity,
        'debt_ratio', f.debt_ratio, 'inventory', f.inventory,
        'eps', f.eps, 'per', f.per, 'pbr', f.pbr, 'ev_ebitda', f.ev_ebitda
      ))
      FROM financials f
      WHERE f.company_id = c.id AND f.period_type = 'annual'
        AND f.fiscal_year BETWEEN 2020 AND (extract(year from now())::int + 1)
        AND (f.period_end_date IS NULL OR f.period_end_date <= now()::date)
    ) AS financials_by_year,
    (
      SELECT jsonb_build_object(
        'fiscal_year',          f.fiscal_year,
        'fiscal_quarter',       f.fiscal_quarter,
        'revenue',              f.revenue,
        'operating_income',     f.operating_income,
        'operating_margin',     f.operating_margin,
        'prev_revenue', (
          SELECT p.revenue FROM financials p
          WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'
            AND p.fiscal_year = f.fiscal_year - 1 AND p.fiscal_quarter = f.fiscal_quarter
          LIMIT 1
        ),
        'prev_operating_income', (
          SELECT p.operating_income FROM financials p
          WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'
            AND p.fiscal_year = f.fiscal_year - 1 AND p.fiscal_quarter = f.fiscal_quarter
          LIMIT 1
        ),
        'prev_operating_margin', (
          SELECT p.operating_margin FROM financials p
          WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'
            AND p.fiscal_year = f.fiscal_year - 1 AND p.fiscal_quarter = f.fiscal_quarter
          LIMIT 1
        )
      )
      FROM financials f
      WHERE f.company_id = c.id AND f.period_type = 'quarterly' AND f.revenue IS NOT NULL
      ORDER BY f.fiscal_year DESC, f.fiscal_quarter DESC NULLS LAST
      LIMIT 1
    ) AS latest_quarter,
    COALESCE(er_fin.rate, CASE WHEN COALESCE(lfc.currency, c.currency) = 'KRW' THEN 1 ELSE NULL END) AS fx_fin_to_krw,
    (
      SELECT (
        f.revenue *
        COALESCE(er_fin.rate, CASE WHEN COALESCE(lfc.currency, c.currency) = 'KRW' THEN 1 ELSE NULL END)
      )
      FROM financials f
      WHERE f.company_id = c.id AND f.period_type = 'annual' AND f.revenue IS NOT NULL
        AND (f.period_end_date IS NULL OR f.period_end_date <= now()::date)
      ORDER BY f.fiscal_year DESC
      LIMIT 1
    ) AS latest_revenue_krw
  FROM companies c
  JOIN company_pages cp ON cp.company_id = c.id AND cp.page = 'humanoid'
  LEFT JOIN exchange_rates_live er ON er.base = c.currency AND er.quote = 'KRW'
  LEFT JOIN latest_fin_currency lfc ON lfc.company_id = c.id
  LEFT JOIN exchange_rates_live er_fin ON er_fin.base = COALESCE(lfc.currency, c.currency) AND er_fin.quote = 'KRW'
  WHERE c.status = 'active'
)
SELECT
  d.*,
  ROW_NUMBER() OVER (ORDER BY d.latest_revenue_krw DESC NULLS LAST, d.name_kr ASC) AS sales_rank
FROM humanoid_base d;

-- 다른 주식 뷰 3종과 동일: 조회자 권한으로 기반 테이블 RLS 를 적용한다.
ALTER VIEW humanoid_stocks_view SET (security_invoker = true);

COMMENT ON VIEW humanoid_stocks_view IS
  '휴머노이드 페이지(/humanoid) 합성 뷰: company_pages.page=''humanoid'' AND status=''active''. robot_roles 다중 태그 + 비상장 기업가치 포함, 고객사는 미수집(빈 배열). financials_by_year 는 period_end_date<=now() 가드.';
