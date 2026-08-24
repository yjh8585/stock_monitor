-- trg_auto_page_mapping() — 로봇 회사가 자동차 부품사 TOP100 표에 섞여 들어가는 것을 막는다.
--
-- 문제(실측 2026-08-24): 현행 트리거는 data_source 만 보고 페이지를 정한다.
--   yfinance(글로벌 상장)  → parts-top100
--   fnguide/dart(한국)     → domestic
-- 휴머노이드 회사도 주가·재무는 같은 수집기(yfinance/fnguide/dart)로 받으므로,
-- 신규 등록하면 **자동차 부품사 TOP100 과 국내자동차 표에 그대로 나타난다.**
-- 유니트리·Figure AI 가 자동차 부품사 순위표에 끼는 셈이다.
--
-- 처방: robot_roles 가 붙어 있으면 data_source 와 무관하게 'humanoid' 로만 매핑한다.
--   - 자동차와 로봇을 겸하는 회사(현대모비스·셰플러 등)는 **이미 등록돼 있고**
--     이 트리거는 AFTER INSERT 전용이라 UPDATE 로 robot_roles 를 붙여도 발동하지 않는다
--     → 기존 domestic/parts-top100 매핑은 그대로 유지되고, humanoid 매핑만 시드에서 수동 추가한다.
--   - 앞으로 onboard 되는 순수 로봇사만 이 분기를 탄다.

CREATE OR REPLACE FUNCTION trg_auto_page_mapping() RETURNS trigger AS $$
DECLARE
  pages text[];
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  IF NEW.robot_roles IS NOT NULL AND array_length(NEW.robot_roles, 1) > 0 THEN
    -- 로봇 역할이 있으면 휴머노이드 페이지로만. 자동차 표에 섞이지 않게 한다.
    pages := ARRAY['humanoid'];
  ELSE
    pages := CASE NEW.data_source
      WHEN 'dart' THEN ARRAY['domestic']
      WHEN 'fnguide' THEN ARRAY['domestic']
      WHEN 'yfinance' THEN ARRAY['parts-top100']
      WHEN 'marklines' THEN ARRAY['parts-top100']
      WHEN 'pykrx+dart' THEN ARRAY['domestic']
      ELSE NULL
    END;
  END IF;

  IF pages IS NULL OR array_length(pages, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO company_pages (company_id, page)
  SELECT NEW.id, unnest(pages)
  ON CONFLICT (company_id, page) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trg_auto_page_mapping() IS
  'AFTER INSERT 트리거 — robot_roles 가 있으면 humanoid, 없으면 data_source 에 따라 자동 매핑. ON CONFLICT DO NOTHING 으로 멱등.';
