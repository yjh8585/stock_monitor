-- financials 테이블에 주당 지표 및 밸류에이션 컬럼 추가 (FnGuide 수집)
-- 단위: eps/bps/dps/cfps (원), per/pbr/psr/ev_ebitda/ev_ebit (배), dividend_yield (%)

ALTER TABLE financials
  ADD COLUMN IF NOT EXISTS eps            numeric,
  ADD COLUMN IF NOT EXISTS bps            numeric,
  ADD COLUMN IF NOT EXISTS dps            numeric,
  ADD COLUMN IF NOT EXISTS cfps           numeric,
  ADD COLUMN IF NOT EXISTS per            numeric,
  ADD COLUMN IF NOT EXISTS pbr            numeric,
  ADD COLUMN IF NOT EXISTS psr            numeric,
  ADD COLUMN IF NOT EXISTS ev_ebitda      numeric,
  ADD COLUMN IF NOT EXISTS ev_ebit        numeric,
  ADD COLUMN IF NOT EXISTS dividend_yield numeric;

COMMENT ON COLUMN financials.eps            IS '주당순이익 (원)';
COMMENT ON COLUMN financials.bps            IS '주당순자산 (원)';
COMMENT ON COLUMN financials.dps            IS '주당배당금 (원)';
COMMENT ON COLUMN financials.cfps           IS '주당현금흐름 (원)';
COMMENT ON COLUMN financials.per            IS '주가수익비율 (배)';
COMMENT ON COLUMN financials.pbr            IS '주가순자산비율 (배)';
COMMENT ON COLUMN financials.psr            IS '주가매출비율 (배)';
COMMENT ON COLUMN financials.ev_ebitda      IS 'EV/EBITDA (배)';
COMMENT ON COLUMN financials.ev_ebit        IS 'EV/EBIT (배)';
COMMENT ON COLUMN financials.dividend_yield IS '배당수익률 (%)';
