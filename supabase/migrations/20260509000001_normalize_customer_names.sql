-- 고객사(customers) 표기 정규화
-- 같은 OEM이 여러 이름으로 들어가 있는 케이스를 표준 한글명으로 통일.
-- 함수는 enrich 흐름에서도 재사용 가능 (Python 후처리에서 같은 매핑 사용 권장).

CREATE OR REPLACE FUNCTION normalize_customer_name(raw text) RETURNS text AS $$
BEGIN
  -- NULL/빈 값 그대로
  IF raw IS NULL OR length(trim(raw)) = 0 THEN
    RETURN raw;
  END IF;

  RETURN CASE
    -- 폭스바겐 그룹 (브랜드명은 별도 유지: 아우디, 포르쉐)
    WHEN raw IN ('Volkswagen', 'Volkswagen Group', '폭스바겐 (Volkswagen)', '폭스바겐 그룹', 'FAW Volkswagen', '폭스바겐')
      THEN '폭스바겐'

    -- GM
    WHEN raw IN ('GM', 'General Motors', 'General Motors (GM)', 'GM(제너럴모터스)', '제너럴모터스', '지엠')
      THEN 'GM'
    WHEN raw IN ('한국GM', '한국지엠', '한국 GM')
      THEN '한국지엠'

    -- 포드
    WHEN raw IN ('Ford', '포드', 'Ford Motor')
      THEN '포드'

    -- BMW (Brilliance/Group 합치고, 브랜드 그대로)
    WHEN raw IN ('BMW', 'BMW Group', 'BMW 그룹', 'BMW Brilliance')
      THEN 'BMW'

    -- 메르세데스-벤츠 (다임러 명칭 통합)
    WHEN raw IN ('Mercedes-Benz', '메르세데스-벤츠 (Mercedes-Benz)', '메르세데스-벤츠 (다임러)',
                 '다임러(메르세데스-벤츠)', '다임러(벤츠)', 'Daimler (다임러)', 'Daimler', '메르세데스벤츠',
                 '벤츠', 'Mercedes', '메르세데스-벤츠')
      THEN '메르세데스-벤츠'

    -- 다임러트럭 (상용차 별도)
    WHEN raw IN ('다임러트럭', 'Daimler Trucks North America (Freightliner, Western Star)',
                 'Daimler Trucks', 'Freightliner')
      THEN '다임러트럭'

    -- 도요타
    WHEN raw IN ('Toyota', 'Toyota (도요타)', '도요타', 'Toyota Motor')
      THEN '도요타'

    -- 혼다
    WHEN raw IN ('Honda', 'Honda (혼다)', '혼다', 'Honda Motor')
      THEN '혼다'

    -- 닛산
    WHEN raw IN ('Nissan', 'Nissan (닛산)', '닛산', 'Nissan Motor')
      THEN '닛산'

    -- 테슬라
    WHEN raw IN ('Tesla', 'Tesla Shanghai', '테슬라')
      THEN '테슬라'

    -- 스텔란티스 (브랜드는 통합 — Dodge Ram, Jeep, Chrysler)
    WHEN raw IN ('Stellantis', '스텔란티스', 'Dodge Ram (Ram trucks)', 'Dodge', 'Ram', 'Chrysler', 'Jeep', 'Fiat', 'FCA')
      THEN '스텔란티스'

    -- 볼보
    WHEN raw IN ('Volvo', '볼보 (Volvo)', '볼보', 'Volvo Group (Volvo Trucks, Mack)', 'Volvo Group', 'Volvo Trucks')
      THEN '볼보'

    -- 아우디 (폭스바겐 그룹이지만 브랜드 별도)
    WHEN raw IN ('아우디 (Audi)', 'Audi', '아우디')
      THEN '아우디'

    -- 포르쉐
    WHEN raw IN ('Porsche', '포르쉐')
      THEN '포르쉐'

    -- 푸조 (Stellantis 산하 — 브랜드 별도 유지 가능, 통합 우선)
    WHEN raw IN ('Peugeot', '푸조')
      THEN '푸조'

    -- 시트로엥
    WHEN raw IN ('Citroen', 'Citroën', '시트로엥')
      THEN '시트로엥'

    -- 르노
    WHEN raw IN ('Renault', '르노')
      THEN '르노'

    -- 르노코리아
    WHEN raw IN ('Renault Korea', '르노코리아', '르노삼성')
      THEN '르노코리아'

    -- BYD
    WHEN raw IN ('BYD', '비야디')
      THEN 'BYD'

    -- 체리
    WHEN raw IN ('Chery', '체리')
      THEN '체리'

    -- 재규어 랜드로버
    WHEN raw IN ('Jaguar Land Rover', 'JLR', '재규어랜드로버', '재규어 랜드로버')
      THEN '재규어 랜드로버'

    -- 페라리
    WHEN raw IN ('Ferrari', '페라리')
      THEN '페라리'

    -- 리비안
    WHEN raw IN ('Rivian', '리비안')
      THEN '리비안'

    -- 빈패스트
    WHEN raw IN ('VinFast', '빈패스트')
      THEN '빈패스트'

    -- 루시드
    WHEN raw IN ('Lucid', '루시드', 'Lucid Motors')
      THEN '루시드'

    -- 스즈키
    WHEN raw IN ('Suzuki', '스즈키')
      THEN '스즈키'

    -- 현대차
    WHEN raw IN ('현대차', 'Hyundai', '현대자동차', '현대', 'Hyundai Motor')
      THEN '현대차'

    -- 기아
    WHEN raw IN ('기아', 'Kia', '기아차', '기아자동차', 'Kia Motors')
      THEN '기아'

    -- 현대기아
    WHEN raw IN ('현대기아', 'Hyundai-Kia', '현대-기아')
      THEN '현대차/기아'

    -- KG모빌리티 (구 쌍용)
    WHEN raw IN ('KG모빌리티', 'KG Mobility', '쌍용', '쌍용자동차')
      THEN 'KG모빌리티'

    -- 트럭/버스 OEM
    WHEN raw IN ('Paccar (Kenworth, Peterbilt)', 'Paccar', 'PACCAR', 'Kenworth', 'Peterbilt')
      THEN 'PACCAR'
    WHEN raw IN ('Navistar (International)', 'Navistar', 'International')
      THEN 'Navistar'

    -- SK온 (배터리)
    WHEN raw IN ('SK온', 'SK On', '에스케이온', 'SK on')
      THEN '에스케이온'

    -- 그 외는 원본 유지
    ELSE raw
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION normalize_customer_name(text) IS
  '고객사 표기 정규화 — 같은 OEM의 여러 이름 → 표준 한글명으로 통일';

-- 일괄 UPDATE: companies.customers 배열을 정규화 + 중복 제거
UPDATE companies AS tgt
SET customers = subq.new_customers
FROM (
  SELECT
    cc.id,
    (
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
WHERE tgt.id = subq.id AND subq.new_customers IS NOT NULL;
