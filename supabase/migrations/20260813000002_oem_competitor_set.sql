-- 차종 × 시장 경쟁군 정의. Python 수집기와 SQL 검증이 같은 값을 보도록 DB 를 SSOT 로 둔다.
--
-- 시장 선정 근거(2025.01~2026.07 실측 판매 비중):
--   북미 5종 USA 89~93% → USA 한정
--   porsche_911 USA 33/독일 21/영국 7 → 지배 시장 없어 GLOBAL
--   seltos 인도 31/미국 23/한국 18 → 3개 시장 분리
--   avante_ex_china 미국 53/한국 23 → 2개 / niro 미국 27/유럽 합계 약 25 → 2개
--
-- ⚠️ MarkLines Segment 를 그대로 쓰면 안 된다: Grand Cherokee 는 SUV-E, Explorer·Traverse·
--    Atlas 는 SUV-D 로 갈리지만 실제로는 같은 시장에서 경쟁한다. 그래서 자동 분류가 아니라
--    이 표를 수동 정본으로 둔다.

-- ⚠️ `countries` 가 실제 집계 필터다. oem_sales_model_country_month.country 에는 'Europe' 같은
--    대륙 값이 없고 개별 국가만 있다(실측 확인). 'Europe' 을 country 로 넘기면 0행이 나오거나
--    전 국가 합산으로 뭉개진다. GLOBAL 만 NULL(전 국가)이고 나머지는 국가 배열을 명시한다.

CREATE TABLE IF NOT EXISTS oem_competitor_set (
  model_key         text NOT NULL,
  market            text NOT NULL,   -- 논리적 시장 코드 (USA/India/Korea/China/Europe/GLOBAL)
  market_label      text NOT NULL,
  display_order     int  NOT NULL,
  countries         text[],          -- 집계 대상 국가. NULL = 전 국가(GLOBAL)
  target_models     text[] NOT NULL,
  competitor_models text[] NOT NULL,
  segment_note      text,
  PRIMARY KEY (model_key, market)
);

ALTER TABLE oem_competitor_set ENABLE ROW LEVEL SECURITY;
CREATE POLICY oem_competitor_set_read ON oem_competitor_set FOR SELECT TO anon, authenticated USING (true);

-- 유럽 집계 국가 — NIRO 판매 실측 상위(Spain 18.0k · UK 17.6k · France 9.4k · Netherlands 8.8k ·
-- Italy 3.1k · Sweden 2.4k · Germany 2.2k · Poland 1.4k)에 인접 서유럽 시장을 더한 집합.
-- 대상 차종과 경쟁 차종에 같은 집합을 적용해야 점유율이 공정하다.

INSERT INTO oem_competitor_set
  (model_key, market, market_label, display_order, countries, target_models, competitor_models, segment_note)
VALUES
  ('grand_cherokee', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['Grand Cherokee (Jeep (2009-))'],
   ARRAY['Explorer','Traverse','Grand Highlander','Telluride','Palisade','Honda Pilot','Highlander'],
   'SUV-E 이지만 실질 경쟁은 SUV-D 3열 SUV'),

  ('ram_truck', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['Ram P/U'],
   ARRAY['Ford F-Series','Silverado','GMC Sierra','Tundra','Nissan Titan'],
   'Pickup Truck 풀사이즈'),

  ('pacifica', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['Pacifica (Chrysler (2009-))'],
   ARRAY['Odyssey','Sienna','Carnival (Sedona)'],
   'MPV(미니밴)'),

  ('rivian_r1', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['R1T','R1S'],
   ARRAY['Model X','Cybertruck','Hummer SUV','Hummer Pickup','Lucid Air','EV9','IONIQ 5'],
   '프리미엄 전기 SUV/픽업 — MarkLines 세그먼트로 안 잡혀 수동 지정'),

  ('atlas', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['VW Atlas'],
   ARRAY['Explorer','Traverse','Grand Highlander','Telluride','Palisade','Honda Pilot','Highlander','Grand Cherokee (Jeep (2009-))'],
   'SUV-D 3열 SUV'),

  ('porsche_911', 'GLOBAL', '글로벌', 1, NULL,
   ARRAY['Porsche 911'],
   ARRAY['Corvette','Boxster/Cayman','Supra','Nissan Z','F-Type'],
   'Segment F 스포츠카 — 미국 33%/독일 21%로 지배 시장 없음'),

  ('seltos', 'India', '인도', 1, ARRAY['India'],
   ARRAY['SELTOS'],
   ARRAY['Creta (ix25)','Venue','Nexon','Brezza','Sonet','XUV 3XO'],
   'SUV-C'),
  ('seltos', 'USA', '미국', 2, ARRAY['USA'],
   ARRAY['SELTOS'],
   ARRAY['HR-V','Kona','Crosstrek','Corolla Cross','Trailblazer'],
   'SUV-C'),
  ('seltos', 'Korea', '한국', 3, ARRAY['Korea'],
   ARRAY['SELTOS'],
   ARRAY['Kona','Casper','EV3','Trailblazer'],
   'SUV-C'),

  ('avante_ex_china', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['Avante (Elantra)','Avante'],
   ARRAY['Civic','Corolla','Sentra','Jetta','K4'],
   '준중형 세단'),
  ('avante_ex_china', 'Korea', '한국', 2, ARRAY['Korea'],
   ARRAY['Avante (Elantra)','Avante'],
   ARRAY['K5','Sonata/YF Sonata/LF Sonata','Casper'],
   '준중형 세단'),

  ('avante_china', 'China', '중국', 1, ARRAY['China'],
   ARRAY['Elantra/Yuedong/Langdong/Elantra 2016','Elantra Yuedong'],
   ARRAY['Bluebird Sylphy/Sylphy','Lavida','Sagitar','Qin PLUS','Qin L'],
   '중국 준중형 세단 — 전기·PHEV 전환이 최대 변수'),

  ('niro', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['NIRO'],
   ARRAY['HR-V','Kona','Corolla Cross','Crosstrek'],
   'SUV-C 하이브리드/EV'),
  ('niro', 'Europe', '유럽', 2,
   ARRAY['Germany','UK','France','Italy','Spain','Netherlands','Sweden','Poland',
         'Belgium','Austria','Norway','Denmark','Portugal','Switzerland'],
   ARRAY['NIRO'],
   ARRAY['Kona','Captur','Puma','2008'],
   'SUV-C — 서유럽 14개국 합산')
ON CONFLICT (model_key, market) DO NOTHING;
