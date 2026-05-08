-- related_stocks_view에 가장 최근 분기 실적(latest_quarter) JSONB 컬럼 추가
-- 회사 설명 펼침 영역에서 "최근 분기 실적 현황" 표시용

CREATE OR REPLACE VIEW related_stocks_view AS
SELECT
  c.id,
  c.ticker,
  c.name,
  c.name_kr,
  c.market,
  c.country,
  c.currency,
  c.status,
  c.company_type,
  c.region,
  c.products,
  c.customers,
  c.last_price,
  c.last_change_pct,
  c.last_updated_at,
  c.market_cap,
  c.business_summary,
  c.summary_updated_at,
  c.homepage_url,
  COALESCE(
    er.rate,
    CASE WHEN c.currency = 'KRW' THEN 1 ELSE NULL END
  ) AS fx_to_krw,
  (
    SELECT jsonb_object_agg(f.fiscal_year::text, jsonb_build_object(
      'revenue',          f.revenue,
      'operating_income', f.operating_income,
      'operating_margin', f.operating_margin,
      'total_liabilities',f.total_liabilities,
      'total_equity',     f.total_equity,
      'debt_ratio',       f.debt_ratio,
      'inventory',        f.inventory,
      'eps',              f.eps,
      'per',              f.per,
      'pbr',              f.pbr,
      'ev_ebitda',        f.ev_ebitda
    ))
    FROM financials f
    WHERE f.company_id   = c.id
      AND f.period_type  = 'annual'
      AND f.fiscal_year  BETWEEN 2022 AND 2025
  ) AS financials_by_year,
  (
    SELECT jsonb_build_object(
      'fiscal_year',      f.fiscal_year,
      'fiscal_quarter',   f.fiscal_quarter,
      'revenue',          f.revenue,
      'operating_income', f.operating_income,
      'operating_margin', f.operating_margin
    )
    FROM financials f
    WHERE f.company_id  = c.id
      AND f.period_type = 'quarterly'
      AND f.revenue     IS NOT NULL
    ORDER BY f.fiscal_year DESC, f.fiscal_quarter DESC NULLS LAST
    LIMIT 1
  ) AS latest_quarter
FROM companies c
LEFT JOIN exchange_rates_live er
  ON er.base = c.currency
 AND er.quote = 'KRW';

COMMENT ON VIEW related_stocks_view IS
  '관련주식 페이지용 합성 뷰: 메타+주가+연간실적(22-25)+최근분기실적+환율';
