-- 고객사 정규화 v3 — 화이트리스트(OEM 한정) + 별칭 통합 + 다중 표준명 확장 + 자동 트리거
--
-- v2 대비 변경:
-- 1) text→text 함수 대신 expand_customer_name(text)→text[] 도입.
--    "현대기아", "현대·기아 자동차" 같은 통합 표기를 ['현대차','기아']로 분리.
-- 2) 화이트리스트(약 90개 OEM)에 없는 모든 customer는 ARRAY[]로 폐기.
--    부품사·반도체·가전·중공업·placeholder("General","미상","렌터카/리스","엔진 공급 파트너" 등) 자동 제거.
-- 3) 별칭 매핑 확장: 제네시스/제너시스/genesis → 현대차, GM대우/대우자동차 → 한국지엠,
--    KG 모빌리티(띄어쓰기) → KG모빌리티 등.
-- 4) BEFORE INSERT/UPDATE 트리거로 신규 데이터도 자동 정규화 (db.py 우회 경로 대응).

-- ============================================================
-- 1. text→text[] expand 함수 (다중 표준명 반환 가능)
-- ============================================================

CREATE OR REPLACE FUNCTION expand_customer_name(raw text) RETURNS text[] AS $$
DECLARE
  cleaned text;
  paren_inner text;
  paren_outer text;
BEGIN
  IF raw IS NULL OR length(trim(raw)) = 0 THEN
    RETURN ARRAY[]::text[];
  END IF;

  cleaned := trim(raw);

  -- 1) "X (Y)" / "X(Y)" 패턴: 한글 우선
  paren_inner := substring(cleaned FROM '\(([^)]+)\)');
  IF paren_inner IS NOT NULL THEN
    paren_outer := trim(regexp_replace(cleaned, '\s*\([^)]*\)\s*', ' ', 'g'));
    IF paren_inner ~ '[가-힣]' AND paren_outer !~ '[가-힣]' THEN
      cleaned := trim(paren_inner);
    ELSIF paren_outer ~ '[가-힣]' THEN
      cleaned := paren_outer;
    ELSE
      cleaned := paren_outer;
    END IF;
  END IF;

  -- 2) 법인격/접미사 제거
  cleaned := trim(regexp_replace(
    cleaned,
    '\s*(AG|GmbH|Inc\.?|Corp\.?|Corporation|Co\.,?\s*Ltd\.?|Co\s+Ltd\.?|Motor\s+Company|Motor\s+Corporation|Motors|N\.?V\.?|Group|S\.A\.|SE|plc|PLC)$',
    '', 'gi'
  ));
  cleaned := trim(cleaned);

  -- 3) 현대+기아 통합 표기 → 두 OEM으로 분리
  --    "현대기아", "현대-기아", "현대·기아", "현대/기아", "현대.기아", "Hyundai-Kia", "Hyundai Kia" 등
  IF cleaned ~* '현대[\s\.\-·/]?기아|hyundai[\s\-]?kia|kia[\s\-]?hyundai|기아[\s\.\-·/]?현대' THEN
    RETURN ARRAY['현대차', '기아'];
  END IF;

  -- 4) 차종(트림)/모델명 → 브랜드 통합
  --    "기아 EV3", "기아 카니발" 등 → 기아
  IF cleaned ~* '^기아\s+' THEN RETURN ARRAY['기아']; END IF;
  --    "현대 유니버스" 등 → 현대차
  IF cleaned ~* '^현대\s+' AND cleaned !~* '현대모비스|현대트랜시스|현대위아|현대케피코|현대로템|현대제철|현대중공업|현대건설기계|현대인프라코어' THEN
    RETURN ARRAY['현대차'];
  END IF;

  -- 5) 표준명 매핑 (화이트리스트). 매칭 안 되면 NULL → 자동 폐기.
  RETURN CASE
    -- 현대차 (제네시스 포함)
    WHEN cleaned IN ('현대차', '현대', '현대자동차', '현대자동차그룹', 'Hyundai', 'Hyundai Motor', '현대 유니버스') THEN ARRAY['현대차']
    WHEN cleaned ~* '^(제네시스|제너시스|genesis|genessis)$' THEN ARRAY['현대차']
    -- 기아
    WHEN cleaned IN ('기아', '기아차', '기아자동차', 'Kia', 'Kia Motor') THEN ARRAY['기아']
    -- KG모빌리티 (띄어쓰기/약어 변형 흡수)
    WHEN cleaned ~* '^(kg\s*모빌리티|kg\s*mobility|kgm|kgm\s+모빌리티|쌍용|쌍용자동차)$' THEN ARRAY['KG모빌리티']
    -- 한국지엠 (대우 계열 모두 통합) — 사용자 요구: GM 로고로 표시 (customerLogos.ts에서 generalmotors 아이콘 사용)
    WHEN cleaned ~* '^(한국지엠|한국gm|한국 gm|gm코리아|gm korea|지엠코리아|gm대우|gm 대우|대우자동차|대우버스|대우|한국지엠 코리아)$' THEN ARRAY['한국지엠']
    -- 르노코리아
    WHEN cleaned IN ('르노코리아', '르노삼성', '르노삼성자동차', 'Renault Korea') THEN ARRAY['르노코리아']
    -- 글로벌 OEM
    WHEN cleaned IN ('Volkswagen', 'Volkswagen Group', 'FAW Volkswagen', '폭스바겐', '폭스바겐그룹') THEN ARRAY['폭스바겐']
    WHEN cleaned IN ('GM', 'General Motors', '제너럴 모터스', '제너럴모터스', '지엠') THEN ARRAY['GM']
    WHEN cleaned IN ('Ford', '포드', 'Ford Motor', 'Ford Motor Company') THEN ARRAY['포드']
    WHEN cleaned IN ('BMW', 'BMW Group', 'BMW 그룹', 'BMW Brilliance') THEN ARRAY['BMW']
    WHEN cleaned IN ('Mercedes-Benz', '메르세데스벤츠', '벤츠', 'Mercedes', '메르세데스-벤츠', '메르세데스',
                     'Daimler', '다임러', 'DaimlerChrysler', 'Daimler Benz') THEN ARRAY['메르세데스-벤츠']
    WHEN cleaned IN ('다임러트럭', 'Daimler Trucks', 'Daimler Trucks North America',
                     'Daimler Truck', 'Freightliner', 'Western Star') THEN ARRAY['다임러트럭']
    WHEN cleaned IN ('Toyota', '도요타', '토요타', 'Toyota Motor', 'Toyota Group', '도요타 그룹',
                     '도요타 인더스트리즈', 'Lexus', '렉서스') THEN ARRAY['도요타']
    WHEN cleaned IN ('Honda', '혼다', 'Honda Motor', 'Honda Motor Co', 'Honda Motor Co., Ltd',
                     'Honda Motor Co., Ltd.', 'Honda Motor Company') THEN ARRAY['혼다']
    WHEN cleaned IN ('Nissan', '닛산', '닛산자동차', 'Nissan Motor', 'Nissan Motor Co',
                     'Nissan Motor Co., Ltd', 'Nissan Motor Co., Ltd.') THEN ARRAY['닛산']
    WHEN cleaned IN ('Mazda', '마쓰다', 'Mazda Motor', 'Mazda Motor Corporation') THEN ARRAY['마쓰다']
    WHEN cleaned IN ('Mitsubishi', '미쓰비시', '미쯔비시', '미쯔비시자동차', 'Mitsubishi Motors',
                     '미쓰비시자동차') THEN ARRAY['미쓰비시']
    WHEN cleaned IN ('미쓰비시후소', '미쯔비시 상용자동차', 'Mitsubishi Fuso', 'Fuso') THEN ARRAY['미쓰비시후소']
    WHEN cleaned IN ('Subaru', '스바루', 'Subaru Corporation') THEN ARRAY['스바루']
    WHEN cleaned IN ('Suzuki', '스즈키', 'Suzuki Motor', 'Suzuki Motor Corporation') THEN ARRAY['스즈키']
    WHEN cleaned IN ('Tesla', '테슬라', 'Tesla Shanghai', 'Tesla Inc') THEN ARRAY['테슬라']
    WHEN cleaned IN ('Stellantis', '스텔란티스', 'Dodge Ram', 'Dodge', 'Ram', 'Chrysler', '크라이슬러',
                     'Jeep', 'Fiat', 'Fiat Chrysler', 'FCA', 'Stellantis N.V.',
                     '다임러-크라이슬러/스텔란티스', 'PSA', 'PSA 그룹', 'PSA Group') THEN ARRAY['스텔란티스']
    WHEN cleaned IN ('Volvo', '볼보', 'Volvo Cars', '볼보건설기계', '볼보건설기계코리아') THEN ARRAY['볼보']
    WHEN cleaned IN ('Volvo Group', 'Volvo Trucks', '볼보트럭', '볼보 트럭') THEN ARRAY['볼보트럭']
    WHEN cleaned IN ('Audi', '아우디') THEN ARRAY['아우디']
    WHEN cleaned IN ('Porsche', '포르쉐') THEN ARRAY['포르쉐']
    WHEN cleaned IN ('Lamborghini', '람보르기니') THEN ARRAY['람보르기니']
    WHEN cleaned IN ('Bentley', '벤틀리') THEN ARRAY['벤틀리']
    WHEN cleaned IN ('Bugatti', '부가티') THEN ARRAY['부가티']
    WHEN cleaned IN ('Peugeot', '푸조') THEN ARRAY['푸조']
    WHEN cleaned IN ('Citroen', 'Citroën', '시트로엥') THEN ARRAY['시트로엥']
    WHEN cleaned IN ('Renault', '르노') THEN ARRAY['르노']
    WHEN cleaned IN ('Renault-Nissan', 'Renault-Nissan-Mitsubishi Alliance', '르노-닛산',
                     'Renault Nissan Mitsubishi') THEN ARRAY['르노-닛산']
    WHEN cleaned IN ('BYD', '비야디') THEN ARRAY['BYD']
    WHEN cleaned IN ('Geely', '지리', '지리자동차') THEN ARRAY['지리']
    WHEN cleaned IN ('Chery', '체리') THEN ARRAY['체리']
    WHEN cleaned IN ('Changan', 'Changan Auto', '창안', '창안자동차') THEN ARRAY['창안']
    WHEN cleaned IN ('Great Wall Motor', 'Great Wall Motors', 'GWM', '그레이트월모터',
                     '그레이트월모터스') THEN ARRAY['그레이트월모터스']
    WHEN cleaned IN ('SAIC', 'SAIC Motor', '상하이자동차') THEN ARRAY['SAIC']
    WHEN cleaned IN ('BAIC', 'Beijing Automotive') THEN ARRAY['BAIC']
    WHEN cleaned IN ('Beijing Hyundai', '베이징 현대', '베이징현대') THEN ARRAY['베이징현대']
    WHEN cleaned IN ('Dongfeng', 'Dongfeng Motor', '동펑자동차', '동펑') THEN ARRAY['동펑자동차']
    WHEN cleaned IN ('GAC', 'GAC Group', '광저우자동차') THEN ARRAY['광저우자동차']
    WHEN cleaned IN ('FAW', '제일자동차') THEN ARRAY['FAW']
    WHEN cleaned IN ('Li Auto', '리샹', '리상', 'Li Xiang') THEN ARRAY['리샹']
    WHEN cleaned IN ('Nio', '니오', 'NIO') THEN ARRAY['NIO']
    WHEN cleaned IN ('Xpeng', '샤오펑', 'XPeng') THEN ARRAY['XPeng']
    WHEN cleaned IN ('JAC', 'JAC Group') THEN ARRAY['JAC']
    WHEN cleaned IN ('Huawei', '화웨이') THEN ARRAY['화웨이']
    WHEN cleaned IN ('Xiaomi', '샤오미') THEN ARRAY['샤오미']
    WHEN cleaned IN ('Leapmotor', '리프모터') THEN ARRAY['리프모터']
    WHEN cleaned IN ('AITO', 'SERES', '세레스') THEN ARRAY['세레스']
    WHEN cleaned IN ('Wuling', '우링자동차', '우링') THEN ARRAY['우링자동차']
    WHEN cleaned IN ('Jaguar Land Rover', 'JLR', '재규어랜드로버', '재규어 랜드로버', 'Jaguar') THEN ARRAY['재규어 랜드로버']
    WHEN cleaned IN ('Ferrari', '페라리') THEN ARRAY['페라리']
    WHEN cleaned IN ('Rivian', '리비안') THEN ARRAY['리비안']
    WHEN cleaned IN ('VinFast', '빈패스트') THEN ARRAY['빈패스트']
    WHEN cleaned IN ('Lucid', '루시드', 'Lucid Motors') THEN ARRAY['루시드']
    WHEN cleaned IN ('Polaris', '폴라리스') THEN ARRAY['폴라리스']
    WHEN cleaned IN ('Scout Motors', 'Scout') THEN ARRAY['Scout Motors']
    WHEN cleaned IN ('Jiyue Auto', 'Jiyue', '지위에') THEN ARRAY['Jiyue Auto']
    WHEN cleaned IN ('Paccar', 'PACCAR', 'PACCAR Inc', 'PACCAR Inc.', 'Kenworth', 'Peterbilt', '파카') THEN ARRAY['PACCAR']
    WHEN cleaned IN ('Navistar', 'International') THEN ARRAY['Navistar']
    WHEN cleaned IN ('MAN', '만', 'MAN Truck') THEN ARRAY['MAN']
    WHEN cleaned IN ('Scania', '스카니아', '스카니아 트럭') THEN ARRAY['스카니아']
    WHEN cleaned IN ('DAF', 'DAF Trucks') THEN ARRAY['DAF']
    WHEN cleaned IN ('Isuzu', '이스즈', '이스즈자동차') THEN ARRAY['이스즈']
    WHEN cleaned IN ('Hino', '히노') THEN ARRAY['히노']
    WHEN cleaned IN ('KAMAZ', '카마즈') THEN ARRAY['카마즈']
    WHEN cleaned IN ('Mahindra', '마힌드라') THEN ARRAY['마힌드라']
    WHEN cleaned IN ('Tata', 'Tata Motors', '타타', '타타대우', '타타대우상용차') THEN ARRAY['타타']
    WHEN cleaned IN ('Bajaj', 'Bajaj Auto', '바자즈') THEN ARRAY['바자즈']
    WHEN cleaned IN ('Hero', '히어로') THEN ARRAY['히어로']
    WHEN cleaned IN ('Ashok Leyland', '아쇼크레이랜드', '아쇼크 레이랜드') THEN ARRAY['아쇼크레이랜드']
    WHEN cleaned IN ('Sinotruk', '시노트럭') THEN ARRAY['시노트럭']
    WHEN cleaned IN ('Shaanxi', '샨시중트럭') THEN ARRAY['샨시중트럭']
    WHEN cleaned IN ('Foton', '포톤') THEN ARRAY['포톤']
    WHEN cleaned IN ('Nikola', '니콜라') THEN ARRAY['니콜라']
    WHEN cleaned IN ('Skoda', '스코다') THEN ARRAY['스코다']
    WHEN cleaned IN ('SEAT', '세아트') THEN ARRAY['세아트']
    WHEN cleaned IN ('CUPRA', '쿠프라') THEN ARRAY['CUPRA']
    WHEN cleaned IN ('Daihatsu', '다이하쓰') THEN ARRAY['다이하쓰']
    WHEN cleaned IN ('Yamaha', '야마하') THEN ARRAY['야마하']
    WHEN cleaned IN ('에디슨모터스', 'Edison Motors') THEN ARRAY['에디슨모터스']
    -- 화이트리스트 미해당 → 폐기 (부품사·반도체·가전·중공업·placeholder 등)
    ELSE ARRAY[]::text[]
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION expand_customer_name(text) IS
  '고객사명을 화이트리스트(약 90개 OEM) 표준명 배열로 정규화한다. 매칭 안 되면 ARRAY[] 반환(자동 폐기). "현대기아"는 [현대차, 기아]로 분리.';


-- ============================================================
-- 2. customers JSONB 일괄 재정규화 + 중복 제거
-- ============================================================

UPDATE companies AS tgt
SET customers = subq.new_customers
FROM (
  SELECT
    cc.id,
    (
      SELECT
        CASE
          WHEN COUNT(*) = 0 THEN '[]'::jsonb
          ELSE jsonb_agg(DISTINCT jsonb_build_object('name', n))
        END
      FROM (
        SELECT DISTINCT unnest(expand_customer_name(elem->>'name')) AS n
        FROM jsonb_array_elements(cc.customers) AS elem
      ) AS distinct_names
      WHERE n IS NOT NULL AND length(n) > 0
    ) AS new_customers
  FROM companies cc
  WHERE jsonb_typeof(cc.customers) = 'array'
) subq
WHERE tgt.id = subq.id
  AND tgt.customers IS DISTINCT FROM subq.new_customers;


-- ============================================================
-- 3. BEFORE INSERT/UPDATE 트리거 (db.py 우회 경로 대응)
--    수동 SQL UPDATE, client.table().update() 직접 호출 등 어느 경로로 와도 자동 정규화.
-- ============================================================

CREATE OR REPLACE FUNCTION trg_normalize_customers() RETURNS trigger AS $$
DECLARE
  new_customers jsonb;
BEGIN
  IF NEW.customers IS NULL OR jsonb_typeof(NEW.customers) <> 'array' THEN
    RETURN NEW;
  END IF;

  SELECT
    CASE
      WHEN COUNT(*) = 0 THEN '[]'::jsonb
      ELSE jsonb_agg(DISTINCT jsonb_build_object('name', n))
    END
  INTO new_customers
  FROM (
    SELECT DISTINCT unnest(expand_customer_name(elem->>'name')) AS n
    FROM jsonb_array_elements(NEW.customers) AS elem
  ) AS distinct_names
  WHERE n IS NOT NULL AND length(n) > 0;

  NEW.customers := COALESCE(new_customers, '[]'::jsonb);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS companies_normalize_customers ON companies;
CREATE TRIGGER companies_normalize_customers
  BEFORE INSERT OR UPDATE OF customers ON companies
  FOR EACH ROW
  EXECUTE FUNCTION trg_normalize_customers();
