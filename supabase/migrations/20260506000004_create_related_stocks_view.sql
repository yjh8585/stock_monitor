-- 관련주식 페이지용 합성 뷰
-- companies + 최신 환율 + 최근 3년 annual financials를 결합
-- financials_by_year 는 jsonb 객체: { "2023": {...}, "2024": {...}, "2025": {...} }
-- KRW 환산은 프론트엔드에서 fx_to_krw 사용 (currency 별 1단위 → KRW)

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
  c.market_cap,             -- KRW 억원 단위 (한국 fnguide 수집 시 채움)
  c.business_summary,
  c.summary_updated_at,
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
  ) AS financials_by_year
FROM companies c
LEFT JOIN exchange_rates_live er
  ON er.base = c.currency
 AND er.quote = 'KRW';

COMMENT ON VIEW related_stocks_view IS
  '관련주식 페이지용 합성 뷰: 21개사 메타+최신주가+4년(22-25) 연간실적+환율(KRW)';
