-- 알루미늄 지역별 가격 비교용 시리즈 4종 + 기존 ALU 라벨 정정 (2026-11-09 사용자 지시 · docs/plans/2026-11-09-iron-copper-prices_최초지시.md 「알루미늄」)
--
-- 철·구리(20261109000001)와 같은 원칙: 원 단위·원 통화 그대로 저장하고 USD/t·세금 제외 환산은 화면(lib/commodityUnits.ts)에서만 한다.
-- ALU_MWP 는 미국 중서부 실거래 프리미엄(USD/lb)이다 — 화면의 「미국」 선 = LME 현물(ALU_LME) + 이 프리미엄.
-- yf_symbol 이 있어 collect_market_series.py 가 다른 야후 시리즈와 함께 모은다. 나머지 셋은 별도 스크래퍼(collect-steel-kr.yml).

INSERT INTO market_series (series_code, label, unit, source, yf_symbol, category, sort_order) VALUES
  ('ALU_LME', '알루미늄 (LME Cash)',                    'USD/MT', 'KOMIS (LME)',               NULL,    'commodity', 11),
  ('ALU_KR',  '알루미늄 (조달청 비축 판매가 서구산)',   'KRW/MT', '조달청 (부가세 포함 공시)', NULL,    'commodity', 12),
  ('ALU_CN',  '알루미늄 (SHFE 주력월물 결산가)',        'CNY/MT', 'SHFE (증치세 포함)',        NULL,    'commodity', 13),
  ('ALU_MWP', '알루미늄 미국 중서부 프리미엄 (Platts)', 'USD/lb', 'Yahoo Finance (CME AUP)',   'AUP=F', 'commodity', 14)
ON CONFLICT (series_code) DO NOTHING;

-- 야후 ALI=F 는 COMEX 알루미늄 선물이다(LME 3개월물이 아니다 · 2026-11-09 yfinance 메타 확인). 사용자 선택으로 라벨만 고친다.
UPDATE market_series SET label = '알루미늄 (COMEX)' WHERE series_code = 'ALU' AND yf_symbol = 'ALI=F';
