-- 글로벌 부품사 Top100 시드 (Berylls 2025-05-30 기준)
-- 우리 DB에 없는 88개 신규 회사 INSERT + 100개 모두 company_pages('parts-top100') 매핑.
-- ON CONFLICT (ticker) DO NOTHING — 이미 존재하는 12개(현대모비스/엘지에너지솔루션/SK on/JTEKT/한온시스템/한국타이어앤테크놀로지/HL만도/삼성SDI/현대위아/NTN/넥스티어/에스엘) 재INSERT 방지.
-- ticker 규칙:
--   상장사: yfinance 호환 ticker (예: 6473.T, MGA, CON.DE, 1316.HK)
--   비상장사: 영문 회사명 (HSL일렉트로닉스 패턴)
-- data_source: yfinance/dart/marklines (회사별)
-- company_type='부품사' 일괄 (Top100 모두 부품사)

INSERT INTO companies (
  ticker, name, name_kr, market, country, currency, data_source, status, company_type, region, products, customers, homepage_url
) VALUES
  -- ===== Rank 1~10 =====
  ('Bosch', 'Robert Bosch GmbH', '보쉬', NULL, 'DE', 'EUR', 'marklines', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.bosch.com'),
  ('6902.T', 'Denso Corporation', '덴소', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.denso.com'),
  ('CON.DE', 'Continental AG', '콘티넨탈', 'XETRA', 'DE', 'EUR', 'yfinance', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.continental.com'),
  ('MGA', 'Magna International Inc', '마그나', 'NYSE', 'CA', 'USD', 'yfinance', 'active', '부품사', '캐나다', '[]'::jsonb, '[]'::jsonb, 'https://www.magna.com'),
  -- 5위 Hyundai Mobis: skip (이미 DB)
  ('ZF Friedrichshafen', 'ZF Friedrichshafen AG', 'ZF프리드리히샤펜', NULL, 'DE', 'EUR', 'marklines', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.zf.com'),
  ('300750.SZ', 'Contemporary Amperex Technology', 'CATL', 'SZSE', 'CN', 'CNY', 'yfinance', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'https://www.catl.com'),
  ('7259.T', 'Aisin Corporation', '아이신', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.aisin.com'),
  ('ML.PA', 'Compagnie Générale des Établissements Michelin', '미쉐린', 'PAR', 'FR', 'EUR', 'yfinance', 'active', '부품사', '프랑스', '[]'::jsonb, '[]'::jsonb, 'https://www.michelin.com'),
  ('FRVIA.PA', 'FORVIA SE', '포비아', 'PAR', 'FR', 'EUR', 'yfinance', 'active', '부품사', '프랑스', '[]'::jsonb, '[]'::jsonb, 'https://www.forvia.com'),
  -- ===== Rank 11~20 =====
  ('CMI', 'Cummins Inc', '커민스', 'NYSE', 'US', 'USD', 'yfinance', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.cummins.com'),
  ('600741.SS', 'Huayu Automotive Systems Co Ltd', '화우 (HASCO)', 'SSE', 'CN', 'CNY', 'yfinance', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'http://www.hasco-cn.com'),
  ('LEA', 'Lear Corporation', '리어', 'NYSE', 'US', 'USD', 'yfinance', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.lear.com'),
  ('FR.PA', 'Valeo SE', '발레오', 'PAR', 'FR', 'EUR', 'yfinance', 'active', '부품사', '프랑스', '[]'::jsonb, '[]'::jsonb, 'https://www.valeo.com'),
  ('5108.T', 'Bridgestone Corporation', '브리지스톤', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.bridgestone.com'),
  ('SHA.DE', 'Schaeffler AG', '셰플러', 'XETRA', 'DE', 'EUR', 'yfinance', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.schaeffler.com'),
  ('APTV', 'Aptiv PLC', '앱티브', 'NYSE', 'IE', 'USD', 'yfinance', 'active', '부품사', '아일랜드', '[]'::jsonb, '[]'::jsonb, 'https://www.aptiv.com'),
  ('Tenneco', 'Tenneco Inc', '테네코', NULL, 'US', 'USD', 'marklines', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.tenneco.com'),
  ('GT', 'The Goodyear Tire & Rubber Company', '굿이어', 'NASDAQ', 'US', 'USD', 'yfinance', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.goodyear.com'),
  ('5802.T', 'Sumitomo Electric Industries', '스미토모전기', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://global-sei.com'),
  -- ===== Rank 21~30 =====
  ('ADNT', 'Adient PLC', '어디언트', 'NYSE', 'IE', 'USD', 'yfinance', 'active', '부품사', '아일랜드', '[]'::jsonb, '[]'::jsonb, 'https://www.adient.com'),
  ('Yazaki', 'Yazaki Corporation', '야자키', NULL, 'JP', 'JPY', 'marklines', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.yazaki-group.com'),
  ('BWA', 'BorgWarner Inc', '보그워너', 'NYSE', 'US', 'USD', 'yfinance', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.borgwarner.com'),
  ('Astemo', 'Hitachi Astemo, Ltd', '아스테모', NULL, 'JP', 'JPY', 'marklines', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.hitachiastemo.com'),
  ('6752.T', 'Panasonic Holdings Corporation', '파나소닉', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.panasonic.com'),
  ('MOTHERSN.NS', 'Samvardhana Motherson International', '머더슨그룹', 'NSE', 'IN', 'INR', 'yfinance', 'active', '부품사', '인도', '[]'::jsonb, '[]'::jsonb, 'https://www.motherson.com'),
  ('GEST.MC', 'Gestamp Automoción SA', '게스탬프', 'BME', 'ES', 'EUR', 'yfinance', 'active', '부품사', '스페인', '[]'::jsonb, '[]'::jsonb, 'https://www.gestamp.com'),
  ('3116.T', 'Toyota Boshoku Corporation', '토요타방직', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.toyota-boshoku.com'),
  ('Mahle', 'MAHLE GmbH', '말레', NULL, 'DE', 'EUR', 'marklines', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.mahle.com'),
  ('OPM.PA', 'OPmobility SE', 'OP모빌리티', 'PAR', 'FR', 'EUR', 'yfinance', 'active', '부품사', '프랑스', '[]'::jsonb, '[]'::jsonb, 'https://www.opmobility.com'),
  -- ===== Rank 31~40 =====
  -- 31위 LG Energy Solution: skip
  ('Marelli', 'Marelli Holdings Co Ltd', '마렐리', NULL, 'IT', 'EUR', 'marklines', 'active', '부품사', '이탈리아', '[]'::jsonb, '[]'::jsonb, 'https://www.marelli.com'),
  ('2338.HK', 'Weichai Power Co Ltd', '웨이차이파워', 'HKEX', 'CN', 'HKD', 'yfinance', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'https://en.weichai.com'),
  ('ALV', 'Autoliv Inc', '오토리브', 'NYSE', 'SE', 'USD', 'yfinance', 'active', '부품사', '스웨덴', '[]'::jsonb, '[]'::jsonb, 'https://www.autoliv.com'),
  -- 35위 SK on: skip
  ('DAN', 'Dana Incorporated', '다나', 'NYSE', 'US', 'USD', 'yfinance', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.dana.com'),
  ('Clarios', 'Clarios International Inc', '클라리오스', NULL, 'US', 'USD', 'marklines', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.clarios.com'),
  ('BHAP', 'BAIC Motor Hyundai Auto Parts', '베이징하이나퍼 (BHAP)', NULL, 'CN', 'CNY', 'marklines', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'https://www.bhap.cn'),
  ('TEL', 'TE Connectivity Ltd', 'TE커넥티비티', 'NYSE', 'CH', 'USD', 'yfinance', 'active', '부품사', '스위스', '[]'::jsonb, '[]'::jsonb, 'https://www.te.com'),
  ('IFX.DE', 'Infineon Technologies AG', '인피니온', 'XETRA', 'DE', 'EUR', 'yfinance', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.infineon.com'),
  -- ===== Rank 41~50 =====
  ('Flex-N-Gate', 'Flex-N-Gate Corporation', '플렉스앤게이트', NULL, 'US', 'USD', 'marklines', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.flex-n-gate.com'),
  ('Brose', 'Brose Fahrzeugteile SE', '브로제', NULL, 'DE', 'EUR', 'marklines', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.brose.com'),
  -- 43위 JTEKT: skip
  ('Benteler', 'Benteler International AG', '벤텔러', NULL, 'AT', 'EUR', 'marklines', 'active', '부품사', '오스트리아', '[]'::jsonb, '[]'::jsonb, 'https://www.benteler.com'),
  ('TKA.DE', 'thyssenkrupp AG', '티센크루프', 'XETRA', 'DE', 'EUR', 'yfinance', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.thyssenkrupp.com'),
  ('066570', 'LG Electronics Inc', 'LG전자', 'KOSPI', 'KR', 'KRW', 'fnguide', 'active', '부품사', '한국', '[]'::jsonb, '[]'::jsonb, 'https://www.lge.com'),
  ('600699.SS', 'Joyson Electronic Corp', '균성안전 (Joyson)', 'SSE', 'CN', 'CNY', 'yfinance', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'https://www.joyson.cn'),
  -- 48위 Hanon Systems: skip
  ('PIRC.MI', 'Pirelli & C SpA', '피렐리', 'BIT', 'IT', 'EUR', 'yfinance', 'active', '부품사', '이탈리아', '[]'::jsonb, '[]'::jsonb, 'https://www.pirelli.com'),
  ('NXPI', 'NXP Semiconductors NV', 'NXP반도체', 'NASDAQ', 'NL', 'USD', 'yfinance', 'active', '부품사', '네덜란드', '[]'::jsonb, '[]'::jsonb, 'https://www.nxp.com'),
  -- ===== Rank 51~60 =====
  ('5110.T', 'Sumitomo Rubber Industries', '스미토모고무', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.srigroup.co.jp'),
  -- 52위 Hankook Tires: skip
  ('7282.T', 'Toyoda Gosei Co Ltd', '토요다고세이', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.toyoda-gosei.com'),
  -- 54위 HL mando: skip
  ('6503.T', 'Mitsubishi Electric Corporation', '미쓰비시전기', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.mitsubishielectric.com'),
  ('AXL', 'American Axle & Manufacturing', '아메리칸액슬', 'NYSE', 'US', 'USD', 'yfinance', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.aam.com'),
  ('STM', 'STMicroelectronics NV', 'ST마이크로', 'NYSE', 'CH', 'USD', 'yfinance', 'active', '부품사', '스위스', '[]'::jsonb, '[]'::jsonb, 'https://www.st.com'),
  ('7276.T', 'Koito Manufacturing Co Ltd', '고이토제작소', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.koito.co.jp'),
  -- 59위 Samsung SDI: skip
  ('Harman', 'Harman International Industries', '하만', NULL, 'US', 'USD', 'marklines', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.harman.com'),
  -- ===== Rank 61~70 =====
  ('Draexlmaier', 'Lisa Dräxlmaier GmbH', '드렉슬마이어', NULL, 'DE', 'EUR', 'marklines', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.draexlmaier.com'),
  ('002762.SZ', 'Citic Dicastal Co Ltd', '시틱딕스탈', 'SZSE', 'CN', 'CNY', 'yfinance', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'http://www.dicastal.com'),
  ('Eberspacher', 'Eberspächer Group', '에버스파셔', NULL, 'DE', 'EUR', 'marklines', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.eberspaecher.com'),
  -- 64위 Hyundai WIA: skip
  ('TXN', 'Texas Instruments Inc', '텍사스인스트루먼트', 'NASDAQ', 'US', 'USD', 'yfinance', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.ti.com'),
  ('LNR.TO', 'Linamar Corporation', '리나마', 'TSX', 'CA', 'CAD', 'yfinance', 'active', '부품사', '캐나다', '[]'::jsonb, '[]'::jsonb, 'https://www.linamar.com'),
  ('ZC Rubber', 'Zhongce Rubber Group', 'ZC고무', NULL, 'CN', 'CNY', 'marklines', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'http://www.zc-rubber.com'),
  ('600660.SS', 'Fuyao Glass Industry Group', '푸야오', 'SSE', 'CN', 'CNY', 'yfinance', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'https://www.fuyaogroup.com'),
  ('Leoni', 'Leoni AG', '레오니', NULL, 'DE', 'EUR', 'marklines', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.leoni.com'),
  ('DWL.L', 'Dowlais Group plc', '다울레이스', 'LSE', 'GB', 'GBP', 'yfinance', 'active', '부품사', '영국', '[]'::jsonb, '[]'::jsonb, 'https://www.dowlais.com'),
  -- ===== Rank 71~80 =====
  ('Freudenberg', 'Freudenberg SE', '프로이덴베르크', NULL, 'DE', 'EUR', 'marklines', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.freudenberg.com'),
  ('6770.T', 'Alps Alpine Co Ltd', '알프스알파인', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.alpsalpine.com'),
  ('NEMAKA.MX', 'Nemak SAB de CV', '네막', 'BMV', 'MX', 'MXN', 'yfinance', 'active', '부품사', '멕시코', '[]'::jsonb, '[]'::jsonb, 'https://www.nemak.com'),
  ('Webasto', 'Webasto SE', '베바스토', NULL, 'DE', 'EUR', 'marklines', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.webasto-group.com'),
  ('6723.T', 'Renesas Electronics Corp', '르네사스', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.renesas.com'),
  -- 76위 NTN: skip
  ('5101.T', 'The Yokohama Rubber Co Ltd', '요코하마고무', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.y-yokohama.com'),
  ('Grupo Antolin', 'Grupo Antolin Irausa SA', '그루포안톨린', NULL, 'ES', 'EUR', 'marklines', 'active', '부품사', '스페인', '[]'::jsonb, '[]'::jsonb, 'https://www.grupoantolin.com'),
  ('JBL', 'Jabil Inc', '자빌', 'NYSE', 'US', 'USD', 'yfinance', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.jabil.com'),
  ('601058.SS', 'Sailun Group Co Ltd', '사이룬', 'SSE', 'CN', 'CNY', 'yfinance', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'https://www.sailungroup.com'),
  -- ===== Rank 81~90 =====
  ('CIE.MC', 'CIE Automotive SA', 'CIE오토모티브', 'BME', 'ES', 'EUR', 'yfinance', 'active', '부품사', '스페인', '[]'::jsonb, '[]'::jsonb, 'https://www.cieautomotive.com'),
  -- 82위 Nexteer: skip
  ('7241.T', 'Futaba Industrial Co Ltd', '후타바산업', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.futabasangyo.com'),
  ('KBX.DE', 'Knorr-Bremse AG', '크노어브렘제', 'XETRA', 'DE', 'EUR', 'yfinance', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.knorr-bremse.com'),
  ('BRBI.MI', 'Brembo NV', '브렘보', 'BIT', 'IT', 'EUR', 'yfinance', 'active', '부품사', '이탈리아', '[]'::jsonb, '[]'::jsonb, 'https://www.brembo.com'),
  ('Mann Hummel', 'Mann + Hummel GmbH', '만훈멜', NULL, 'DE', 'EUR', 'marklines', 'active', '부품사', '독일', '[]'::jsonb, '[]'::jsonb, 'https://www.mann-hummel.com'),
  ('6995.T', 'Tokai Rika Co Ltd', '도카이리카', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.tokai-rika.co.jp'),
  ('SGO.PA', 'Compagnie de Saint-Gobain', '생고뱅', 'PAR', 'FR', 'EUR', 'yfinance', 'active', '부품사', '프랑스', '[]'::jsonb, '[]'::jsonb, 'https://www.saint-gobain.com'),
  ('ON', 'ON Semiconductor Corporation', '온세미', 'NASDAQ', 'US', 'USD', 'yfinance', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.onsemi.com'),
  ('VC', 'Visteon Corporation', '비스테온', 'NASDAQ', 'US', 'USD', 'yfinance', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.visteon.com'),
  -- ===== Rank 91~100 =====
  ('FLEX', 'Flex Ltd', '플렉스', 'NASDAQ', 'US', 'USD', 'yfinance', 'active', '부품사', '미국', '[]'::jsonb, '[]'::jsonb, 'https://www.flex.com'),
  ('002920.SZ', 'Huizhou Desay SV Automotive', '데사이SV', 'SZSE', 'CN', 'CNY', 'yfinance', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'https://www.desaysv.com'),
  ('5191.T', 'Sumitomo Riko Co Ltd', '스미토모리코', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.sumitomoriko.co.jp'),
  ('5105.T', 'Toyo Tire Corporation', '토요타이어', 'TSE', 'JP', 'JPY', 'yfinance', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.toyotires.com'),
  ('Jatco', 'Jatco Ltd', '자트코', NULL, 'JP', 'JPY', 'marklines', 'active', '부품사', '일본', '[]'::jsonb, '[]'::jsonb, 'https://www.jatco.co.jp'),
  ('601689.SS', 'Ningbo Tuopu Group Co Ltd', '닝보투오푸', 'SSE', 'CN', 'CNY', 'yfinance', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'https://www.tuopu.com.cn'),
  ('Huawei', 'Huawei Technologies Co Ltd', '화웨이 (자동차)', NULL, 'CN', 'CNY', 'marklines', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'https://www.huawei.com'),
  ('MRE.TO', 'Martinrea International Inc', '마티니레아', 'TSX', 'CA', 'CAD', 'yfinance', 'active', '부품사', '캐나다', '[]'::jsonb, '[]'::jsonb, 'https://www.martinrea.com'),
  ('NBHX', 'NBHX Trim Group', 'NBHX', NULL, 'CN', 'CNY', 'marklines', 'active', '부품사', '중국', '[]'::jsonb, '[]'::jsonb, 'https://www.nbhx.com')
  -- 100위 SL Corporation(에스엘): skip
ON CONFLICT (ticker) DO NOTHING;

-- Top100 100개사 모두 company_pages('parts-top100') 매핑
-- 이미 DB에 있던 12개 + 신규 INSERT된 88개 + 한국 4개(6/35/82/100는 위에서 skip 처리됨)
WITH top100_tickers AS (
  SELECT unnest(ARRAY[
    'Bosch','6902.T','CON.DE','MGA','012330','ZF Friedrichshafen','300750.SZ','7259.T','ML.PA','FRVIA.PA',
    'CMI','600741.SS','LEA','FR.PA','5108.T','SHA.DE','APTV','Tenneco','GT','5802.T',
    'ADNT','Yazaki','BWA','Astemo','6752.T','MOTHERSN.NS','GEST.MC','3116.T','Mahle','OPM.PA',
    '373220','Marelli','2338.HK','ALV','에스케이온','DAN','Clarios','BHAP','TEL','IFX.DE',
    'Flex-N-Gate','Brose','6473.T','Benteler','TKA.DE','066570','600699.SS','018880','PIRC.MI','NXPI',
    '5110.T','161390','7282.T','204320','6503.T','AXL','STM','7276.T','006400','Harman',
    'Draexlmaier','002762.SZ','Eberspacher','011210','TXN','LNR.TO','ZC Rubber','600660.SS','Leoni','DWL.L',
    'Freudenberg','6770.T','NEMAKA.MX','Webasto','6723.T','6472.T','5101.T','Grupo Antolin','JBL','601058.SS',
    'CIE.MC','1316.HK','7241.T','KBX.DE','BRBI.MI','Mann Hummel','6995.T','SGO.PA','ON','VC',
    'FLEX','002920.SZ','5191.T','5105.T','Jatco','601689.SS','Huawei','MRE.TO','NBHX','005850'
  ]) AS ticker
)
INSERT INTO company_pages (company_id, page)
SELECT c.id, 'parts-top100'
FROM companies c
JOIN top100_tickers t ON c.ticker = t.ticker
ON CONFLICT (company_id, page) DO NOTHING;
