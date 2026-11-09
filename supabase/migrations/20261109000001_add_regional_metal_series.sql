-- 철·구리 지역별 가격 비교용 시리즈 3종 (2026-11-09 사용자 지시 · docs/plans/2026-11-09-iron-copper-prices_최초지시.md)
--
-- 원 단위·원 통화 그대로 저장한다. 달러/톤·부가세 제외 환산은 화면(lib/commodityUnits.ts)에서만 한다
-- — 발표처 숫자와 DB 값을 대조할 수 있게 원값을 보존하기 위해서다.
-- yf_symbol 은 NULL(별도 스크래퍼 수집)이고 source 가 'placeholder' 가 아니라 화면에서 수집 대상으로 판정된다.
-- 원자재 화면의 단일 차트 목록(ORDER)에는 넣지 않으며, 상단 합친 차트에서만 쓴다.

INSERT INTO market_series (series_code, label, unit, source, yf_symbol, category, sort_order) VALUES
  ('COPPER_LME', '구리 (LME Cash)',                  'USD/MT', 'KOMIS (LME)',              NULL, 'commodity', 21),
  ('COPPER_KR',  '구리 (조달청 비축 판매가 99.99%)', 'KRW/MT', '조달청 (부가세 포함 공시)', NULL, 'commodity', 22),
  ('HRC_CN',     '열연 (SHFE 주력월물 결산가)',      'CNY/MT', 'SHFE (증치세 포함)',        NULL, 'commodity', 41)
ON CONFLICT (series_code) DO NOTHING;
