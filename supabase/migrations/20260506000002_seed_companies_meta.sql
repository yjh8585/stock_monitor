-- 21개사 메타 시드값 (관련주식 페이지 표시용)
-- 멱등 UPDATE — 재실행 시에도 동일 결과
-- products / customers 는 사용자 검토 후 추가 보정 가능

-- ===== OEM =====
UPDATE companies SET company_type='OEM',  region='한국',
  products='[{"name":"그랜저"},{"name":"소나타"},{"name":"투싼/싼타페/팰리세이드"},{"name":"아이오닉(EV)"},{"name":"제네시스"}]'::jsonb,
  customers='[]'::jsonb
WHERE ticker='005380';

UPDATE companies SET company_type='OEM',  region='한국',
  products='[{"name":"K5/K8"},{"name":"스포티지/쏘렌토"},{"name":"EV6/EV9(EV)"},{"name":"카니발"}]'::jsonb,
  customers='[]'::jsonb
WHERE ticker='000270';

UPDATE companies SET company_type='OEM',  region='한국',
  products='[{"name":"토레스"},{"name":"렉스턴"},{"name":"티볼리"},{"name":"코란도"}]'::jsonb,
  customers='[]'::jsonb
WHERE ticker='003620';

UPDATE companies SET company_type='OEM',  region='미국',
  products='[{"name":"시보레"},{"name":"캐딜락"},{"name":"GMC"},{"name":"뷰익"}]'::jsonb,
  customers='[]'::jsonb
WHERE ticker='GM';

UPDATE companies SET company_type='OEM',  region='미국',
  products='[{"name":"F-시리즈(픽업)"},{"name":"머스탱"},{"name":"익스플로러"},{"name":"브롱코"}]'::jsonb,
  customers='[]'::jsonb
WHERE ticker='F';

UPDATE companies SET company_type='OEM',  region='미국',
  products='[{"name":"R1T(EV 픽업)"},{"name":"R1S(EV SUV)"},{"name":"EDV(상용 EV)"}]'::jsonb,
  customers='[]'::jsonb
WHERE ticker='RIVN';

UPDATE companies SET company_type='OEM',  region='베트남',
  products='[{"name":"VF6/VF7"},{"name":"VF8/VF9"},{"name":"전기 SUV"}]'::jsonb,
  customers='[]'::jsonb
WHERE ticker='VFS';

UPDATE companies SET company_type='OEM',  region='이탈리아',
  products='[{"name":"지프"},{"name":"램(픽업)"},{"name":"푸조/시트로엥"},{"name":"피아트"},{"name":"크라이슬러"}]'::jsonb,
  customers='[]'::jsonb
WHERE ticker='STLA';

UPDATE companies SET company_type='OEM',  region='독일',
  products='[{"name":"VW"},{"name":"아우디"},{"name":"포르쉐"},{"name":"스코다/세아트"}]'::jsonb,
  customers='[]'::jsonb
WHERE ticker='VOW3.DE';

UPDATE companies SET company_type='OEM',  region='독일',
  products='[{"name":"BMW 승용"},{"name":"미니"},{"name":"롤스로이스"},{"name":"i시리즈(EV)"}]'::jsonb,
  customers='[]'::jsonb
WHERE ticker='BMW.DE';

UPDATE companies SET company_type='OEM',  region='독일',
  products='[{"name":"S/E/C 클래스"},{"name":"GLE/GLC(SUV)"},{"name":"EQ 시리즈(EV)"},{"name":"마이바흐/AMG"}]'::jsonb,
  customers='[]'::jsonb
WHERE ticker='MBG.DE';

UPDATE companies SET company_type='OEM',  region='미국',
  products='[{"name":"ATV/UTV"},{"name":"스노우모빌"},{"name":"인디언 모터사이클"},{"name":"보트"}]'::jsonb,
  customers='[]'::jsonb
WHERE ticker='PII';

-- ===== 부품사 =====
UPDATE companies SET company_type='부품사', region='한국',
  products='[{"name":"모듈/샤시"},{"name":"전동화 부품"},{"name":"AS부품"},{"name":"전장"}]'::jsonb,
  customers='[{"name":"현대차"},{"name":"기아"},{"name":"메르세데스-벤츠"},{"name":"폭스바겐"}]'::jsonb
WHERE ticker='012330';

UPDATE companies SET company_type='부품사', region='한국',
  products='[{"name":"엔진"},{"name":"등속조인트"},{"name":"4WD/구동시스템"},{"name":"공작기계"}]'::jsonb,
  customers='[{"name":"현대차"},{"name":"기아"},{"name":"GM"}]'::jsonb
WHERE ticker='011210';

UPDATE companies SET company_type='부품사', region='한국',
  products='[{"name":"공조/열관리(HVAC)"},{"name":"컴프레서"},{"name":"히트펌프"}]'::jsonb,
  customers='[{"name":"현대차"},{"name":"기아"},{"name":"포드"},{"name":"GM"},{"name":"폭스바겐"}]'::jsonb
WHERE ticker='018880';

UPDATE companies SET company_type='부품사', region='한국',
  products='[{"name":"브레이크"},{"name":"스티어링"},{"name":"서스펜션"},{"name":"ADAS"}]'::jsonb,
  customers='[{"name":"현대차"},{"name":"기아"},{"name":"GM"},{"name":"포드"},{"name":"폭스바겐"}]'::jsonb
WHERE ticker='204320';

UPDATE companies SET company_type='부품사', region='한국',
  products='[{"name":"변속기/구동계 모듈"},{"name":"동력전달부품"}]'::jsonb,
  customers='[{"name":"현대차"},{"name":"기아"},{"name":"현대모비스"}]'::jsonb
WHERE ticker='010100';

UPDATE companies SET company_type='부품사', region='미국',
  products='[{"name":"드라이브트레인"},{"name":"액슬"},{"name":"메탈 포밍"}]'::jsonb,
  customers='[{"name":"GM"},{"name":"스텔란티스"},{"name":"포드"}]'::jsonb
WHERE ticker='AXL';

UPDATE companies SET company_type='부품사', region='일본',
  products='[{"name":"스티어링"},{"name":"베어링"},{"name":"드라이브라인"},{"name":"공작기계"}]'::jsonb,
  customers='[{"name":"도요타"},{"name":"폭스바겐"},{"name":"포드"},{"name":"닛산"}]'::jsonb
WHERE ticker='6473.T';

UPDATE companies SET company_type='부품사', region='미국',
  products='[{"name":"전동식 스티어링(EPS)"},{"name":"컬럼/드라이브라인"}]'::jsonb,
  customers='[{"name":"GM"},{"name":"포드"},{"name":"스텔란티스"},{"name":"BMW"}]'::jsonb
WHERE ticker='1316.HK';

UPDATE companies SET company_type='부품사', region='영국',
  products='[{"name":"드라이브라인(옛 GKN Automotive)"},{"name":"파워메탈러지"}]'::jsonb,
  customers='[{"name":"폭스바겐"},{"name":"포드"},{"name":"스텔란티스"}]'::jsonb
WHERE ticker='DWL.L';
