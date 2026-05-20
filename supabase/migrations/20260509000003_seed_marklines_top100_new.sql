-- marklines top100 신규 회사 29개 + parts-top100 매핑
-- LLM 분류 결과 기반 (scripts/_new_marklines_classified.json)
-- false positive 제외:
--   Hanon Systems (우리 018880), SL Corporation (우리 005850)
--   Pioneer (6773.T), NVIDIA (NVDA) — 반도체 전문, 자동차 부품 도메인 범위 외
-- 회사 타입은 'OEM' | '부품사' 두 값만 사용 (자동차 부품 비중 있는 곳은 '부품사')
BEGIN;

-- 29개 신규 회사 INSERT
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('ZIL.DE', 'ElringKlinger AG', '엘링클링거', 'DE', 'EUR', 'XETRA', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('AUM.DE', 'Aumovio SE', '아우모비오', 'DE', 'EUR', 'XETRA', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('Kostal', 'Leopold Kostal', '레오폴드 코스탈', 'DE', 'EUR', NULL, 'marklines', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('300124.SZ', 'Shenzhen Inovance Technology', '이노뱅스', 'CN', 'CNY', 'SZSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('0425.HK', 'Minth Group Limited', '민스그룹', 'HK', 'HKD', 'HKEX', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('AAV.BK', 'AAPICO Hitech', '아피코하이텍', 'TH', 'THB', 'TSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('002179.SZ', 'Zhejiang Asia-Pacific Mechanical & Electronic', '저장아태기계전자', 'CN', 'CNY', 'SZSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('HLE.DE', 'Hella', '헬라', 'DE', 'EUR', 'XETRA', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('Hoerbiger', 'Hoerbiger Holding', '회르비거', 'AT', 'EUR', NULL, 'marklines', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('MB.VI', 'Miba AG', '미바', 'AT', 'EUR', 'XETRA', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('1929.T', 'T.RAD Co., Ltd.', '티.래드', 'JP', 'JPY', 'TSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('MINDAIND.NS', 'UNO Minda Ltd.', '우노민다', 'IN', 'INR', 'NSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('7278.T', 'EXEDY Corporation', '엑스디', 'JP', 'JPY', 'TSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('MBLY', 'Mobileye Vision Technologies', '모빌아이', 'IL', 'USD', 'NASDAQ', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('Ficosa', 'Ficosa International', '피코사', 'ES', 'EUR', NULL, 'marklines', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('IAC', 'IAC Group', 'IAC그룹', 'US', 'USD', NULL, 'marklines', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('MaxionWheels', 'Maxion Wheels', '맥시온휠즈', 'DE', 'EUR', NULL, 'marklines', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('GNTX', 'Gentex Corporation', '젠텍스', 'US', 'USD', 'NASDAQ', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('7280.T', 'Mitsuba Corporation', '미츠바', 'JP', 'JPY', 'TSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('6923.T', 'Stanley Electric', '스탠리일렉트릭', 'JP', 'JPY', 'TSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('7699.T', 'Ikuyo Co., Ltd.', '이쿠요', 'JP', 'JPY', 'TSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('IntevaProducts', 'Inteva Products', '인테바프로덕츠', 'US', 'USD', NULL, 'marklines', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('601501.SS', 'Lingyun Industrial', '링윤인더스트리얼', 'CN', 'CNY', 'SSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('ABCTechnologies', 'ABC Technologies', 'ABC테크놀로지', 'CA', 'CAD', NULL, 'marklines', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('6835.T', 'ADVICS Co., Ltd.', '어드바이스', 'JP', 'JPY', 'TSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('5852.T', 'Ahresty Corporation', '아레스티', 'JP', 'JPY', 'TSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('300850.SZ', 'CALB Group', '칼브그룹', 'CN', 'CNY', 'SZSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('001316.SZ', 'Changzhou Xingyu Automotive Lighting Systems', '창저우싱유', 'CN', 'CNY', 'SZSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;
INSERT INTO companies (ticker, name, name_kr, country, currency, market, data_source, status, company_type) VALUES ('5334.T', 'Niterra Co., Ltd.', '니테라', 'JP', 'JPY', 'TSE', 'yfinance', 'active', '부품사') ON CONFLICT (ticker) DO NOTHING;

-- parts-top100 페이지 매핑 (신규 29개)
INSERT INTO company_pages (company_id, page) SELECT id, 'parts-top100' FROM companies WHERE ticker IN ('ZIL.DE','AUM.DE','Kostal','300124.SZ','0425.HK','AAV.BK','002179.SZ','HLE.DE','Hoerbiger','MB.VI','1929.T','MINDAIND.NS','7278.T','MBLY','Ficosa','IAC','MaxionWheels','GNTX','7280.T','6923.T','7699.T','IntevaProducts','601501.SS','ABCTechnologies','6835.T','5852.T','300850.SZ','001316.SZ','5334.T') ON CONFLICT DO NOTHING;

-- 기존 회사 (한온/에스엘) parts-top100 매핑 보강 (이미 있을 수 있음)
INSERT INTO company_pages (company_id, page) SELECT id, 'parts-top100' FROM companies WHERE ticker IN ('018880','005850') ON CONFLICT DO NOTHING;

COMMIT;