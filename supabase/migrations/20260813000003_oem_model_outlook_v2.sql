-- supabase/migrations/20260813000003_oem_model_outlook_v2.sql
-- AI 차종 평가 v2 — 경쟁 현황·판매 추이·시장별 분해·근거 지표·출처를 분리 저장한다.
-- 기존 3개 서술 컬럼(consumer_view/outlook/rationale)은 유지하고 추가만 한다.

ALTER TABLE oem_model_outlook
  ADD COLUMN IF NOT EXISTS competitive_view  text,
  ADD COLUMN IF NOT EXISTS sales_trend       text,
  ADD COLUMN IF NOT EXISTS market_breakdown  jsonb,
  ADD COLUMN IF NOT EXISTS metrics           jsonb,
  ADD COLUMN IF NOT EXISTS sources           jsonb;

COMMENT ON COLUMN oem_model_outlook.competitive_view IS '경쟁 현황 서술 — 경쟁차 신형/판매 증감 대비';
COMMENT ON COLUMN oem_model_outlook.sales_trend      IS '판매 추이 서술 — YoY·점유율 변화';
COMMENT ON COLUMN oem_model_outlook.market_breakdown IS '[{market,label,share_pct,sales,yoy_pct,comment}] 시장별 분해';
COMMENT ON COLUMN oem_model_outlook.metrics          IS 'AI 에 넘긴 계산 지표 원본(감사·재현용)';
COMMENT ON COLUMN oem_model_outlook.sources          IS '[{title,url,date}] Perplexity 검색 출처';
