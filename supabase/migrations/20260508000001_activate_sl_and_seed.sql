-- 에스엘(005850) /domestic 노출 활성화
-- 1) status 'delisted' → 'active' (실제로는 KOSPI 정상 상장)
-- 2) products / customers 시드 (기존 사업 요약 기반)
-- 회사 자체와 company_pages('domestic') 매핑은 이미 존재함.

UPDATE companies
SET
  status   = 'active',
  products = '[{"name":"램프","share_pct":78.2},{"name":"전동화 부품","share_pct":12.2},{"name":"미러"},{"name":"전자"}]'::jsonb,
  customers = '[{"name":"현대차"},{"name":"기아"}]'::jsonb
WHERE ticker = '005850' AND name_kr = '에스엘';
