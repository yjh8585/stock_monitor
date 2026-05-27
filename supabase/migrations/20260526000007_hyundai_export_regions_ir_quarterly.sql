-- hyundai_export_regions에 source='ir-quarterly' 허용 — 분기 IR PDF에서 추출한 분기별 region 도매.
--
-- 배경: hyundai_quarterly_earnings 분기 IR PDF에는 미국/유럽/인도/중국/국내/중남미/아태/아프리카&중동/기타
-- 9개 region별 도매 판매(천대) 표(p.5~6)가 있음. 분기 단위 region 차트가 사용자 요청.
--
-- year_period 형식: 'YYYY-QN' (예: '2026-Q1').
-- region_name: ir-summary가 한국어('북미','국내','유럽'...) 사용 → 일관성 위해 동일 명명 채택.

ALTER TABLE hyundai_export_regions
  DROP CONSTRAINT hyundai_export_regions_source_check;

ALTER TABLE hyundai_export_regions
  ADD CONSTRAINT hyundai_export_regions_source_check
  CHECK (source IN ('export-by-region', 'ir-summary', 'ir-quarterly'));

COMMENT ON COLUMN hyundai_export_regions.source IS
  'export-by-region=hmc-export-by-region.xlsx(한국 출하 월별), ir-summary=salesPerformanceSummary API(연 합계), ir-quarterly=분기 IR PDF p.5~6 region별 도매 표(천대 단위)';
