-- 고객사 정규화 함수 v2: 한글-영문 괄호 패턴 자동 처리 + 법인격 제거 + 명시적 매핑 확장
-- v1 (20260509000001) 보강 — 80+ 변형 추가, 신규 OEM (마쓰다/미쓰비시/스바루/지리/창안 등) 매핑.

CREATE OR REPLACE FUNCTION normalize_customer_name(raw text) RETURNS text AS $$
DECLARE
  cleaned text;
  paren_inner text;
  paren_outer text;
BEGIN
  IF raw IS NULL OR length(trim(raw)) = 0 THEN
    RETURN raw;
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

  -- 3) 표준명 매핑
  RETURN CASE
    WHEN cleaned IN ('Volkswagen', 'Volkswagen Group', 'FAW Volkswagen', '폭스바겐') THEN '폭스바겐'
    WHEN cleaned IN ('GM', 'General Motors', '제너럴모터스', '지엠') THEN 'GM'
    WHEN cleaned IN ('한국GM', '한국지엠', '한국 GM') THEN '한국지엠'
    WHEN cleaned IN ('Ford', '포드', 'Ford Motor', 'Ford Motor Company') THEN '포드'
    WHEN cleaned IN ('BMW', 'BMW Group', 'BMW 그룹', 'BMW Brilliance') THEN 'BMW'
    WHEN cleaned IN ('Mercedes-Benz', '메르세데스벤츠', '벤츠', 'Mercedes', '메르세데스-벤츠',
                     'Daimler', '다임러', 'DaimlerChrysler') THEN '메르세데스-벤츠'
    WHEN cleaned IN ('다임러트럭', 'Daimler Trucks', 'Daimler Trucks North America',
                     'Daimler Truck', 'Freightliner', 'Western Star') THEN '다임러트럭'
    WHEN cleaned IN ('Toyota', '도요타', '토요타', 'Toyota Motor', 'Toyota Group', '도요타 그룹') THEN '도요타'
    WHEN cleaned IN ('Honda', '혼다', 'Honda Motor', 'Honda Motor Co', 'Honda Motor Co., Ltd',
                     'Honda Motor Co., Ltd.', 'Honda Motor Company') THEN '혼다'
    WHEN cleaned IN ('Nissan', '닛산', 'Nissan Motor', 'Nissan Motor Co', 'Nissan Motor Co., Ltd',
                     'Nissan Motor Co., Ltd.') THEN '닛산'
    WHEN cleaned IN ('Mazda', '마쓰다', 'Mazda Motor', 'Mazda Motor Corporation') THEN '마쓰다'
    WHEN cleaned IN ('Mitsubishi', '미쓰비시', 'Mitsubishi Motors', '미쓰비시자동차') THEN '미쓰비시'
    WHEN cleaned IN ('Subaru', '스바루', 'Subaru Corporation') THEN '스바루'
    WHEN cleaned IN ('Suzuki', '스즈키', 'Suzuki Motor', 'Suzuki Motor Corporation') THEN '스즈키'
    WHEN cleaned IN ('Tesla', '테슬라', 'Tesla Shanghai', 'Tesla Inc') THEN '테슬라'
    WHEN cleaned IN ('Stellantis', '스텔란티스', 'Dodge Ram', 'Dodge', 'Ram', 'Chrysler', 'Jeep',
                     'Fiat', 'FCA', 'Stellantis N.V.') THEN '스텔란티스'
    WHEN cleaned IN ('PSA', 'PSA 그룹', 'PSA Group') THEN '스텔란티스'
    WHEN cleaned IN ('Volvo', '볼보', 'Volvo Cars') THEN '볼보'
    WHEN cleaned IN ('Volvo Group', 'Volvo Trucks', '볼보트럭') THEN '볼보트럭'
    WHEN cleaned IN ('Audi', '아우디') THEN '아우디'
    WHEN cleaned IN ('Porsche', '포르쉐') THEN '포르쉐'
    WHEN cleaned IN ('Lamborghini', '람보르기니') THEN '람보르기니'
    WHEN cleaned IN ('Bentley', '벤틀리') THEN '벤틀리'
    WHEN cleaned IN ('Peugeot', '푸조') THEN '푸조'
    WHEN cleaned IN ('Citroen', 'Citroën', '시트로엥') THEN '시트로엥'
    WHEN cleaned IN ('Renault', '르노') THEN '르노'
    WHEN cleaned IN ('Renault Korea', '르노코리아', '르노삼성') THEN '르노코리아'
    WHEN cleaned IN ('Renault-Nissan', 'Renault-Nissan-Mitsubishi Alliance', '르노-닛산',
                     'Renault Nissan Mitsubishi') THEN '르노-닛산'
    WHEN cleaned IN ('BYD', '비야디') THEN 'BYD'
    WHEN cleaned IN ('Geely', '지리') THEN '지리'
    WHEN cleaned IN ('Chery', '체리') THEN '체리'
    WHEN cleaned IN ('Changan', 'Changan Auto', '창안', '창안자동차') THEN '창안'
    WHEN cleaned IN ('Great Wall Motor', 'Great Wall Motors', 'GWM', '그레이트월모터',
                     '그레이트월모터스') THEN '그레이트월모터스'
    WHEN cleaned IN ('SAIC', 'SAIC Motor', '상하이자동차') THEN 'SAIC'
    WHEN cleaned IN ('Beijing Hyundai', '베이징 현대', '베이징현대') THEN '베이징현대'
    WHEN cleaned IN ('Li Auto', '리샹', 'Li Xiang') THEN '리샹'
    WHEN cleaned IN ('Nio', '니오') THEN 'NIO'
    WHEN cleaned IN ('Xpeng', '샤오펑') THEN 'XPeng'
    WHEN cleaned IN ('JAC', 'JAC Group') THEN 'JAC'
    WHEN cleaned IN ('Jaguar Land Rover', 'JLR', '재규어랜드로버', '재규어 랜드로버') THEN '재규어 랜드로버'
    WHEN cleaned IN ('Ferrari', '페라리') THEN '페라리'
    WHEN cleaned IN ('Rivian', '리비안') THEN '리비안'
    WHEN cleaned IN ('VinFast', '빈패스트') THEN '빈패스트'
    WHEN cleaned IN ('Lucid', '루시드', 'Lucid Motors') THEN '루시드'
    WHEN cleaned IN ('현대차', 'Hyundai', '현대자동차', '현대', 'Hyundai Motor') THEN '현대차'
    WHEN cleaned IN ('기아', 'Kia', '기아차', '기아자동차', 'Kia Motor') THEN '기아'
    WHEN cleaned IN ('현대기아', 'Hyundai-Kia', '현대-기아', 'Hyundai-Kia Motors',
                     'Hyundai Kia') THEN '현대차/기아'
    WHEN cleaned IN ('KG모빌리티', 'KG Mobility', '쌍용', '쌍용자동차') THEN 'KG모빌리티'
    WHEN cleaned IN ('Paccar', 'PACCAR', 'PACCAR Inc', 'PACCAR Inc.', 'Kenworth', 'Peterbilt') THEN 'PACCAR'
    WHEN cleaned IN ('Navistar', 'International') THEN 'Navistar'
    WHEN cleaned IN ('MAN', '만') THEN 'MAN'
    WHEN cleaned IN ('Scania', '스카니아') THEN '스카니아'
    WHEN cleaned IN ('DAF', 'DAF Trucks') THEN 'DAF'
    WHEN cleaned IN ('SK온', 'SK On', '에스케이온', 'SK on') THEN '에스케이온'
    ELSE cleaned
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 일괄 재정규화 (변경된 row만)
UPDATE companies AS tgt
SET customers = subq.new_customers
FROM (
  SELECT cc.id, (
    SELECT jsonb_agg(jsonb_build_object('name', n))
    FROM (
      SELECT DISTINCT normalize_customer_name(elem->>'name') AS n
      FROM jsonb_array_elements(cc.customers) AS elem
    ) distinct_names
    WHERE n IS NOT NULL AND length(n) > 0
  ) AS new_customers
  FROM companies cc
  WHERE jsonb_typeof(cc.customers) = 'array' AND jsonb_array_length(cc.customers) > 0
) subq
WHERE tgt.id = subq.id AND subq.new_customers IS NOT NULL
  AND tgt.customers <> subq.new_customers;
