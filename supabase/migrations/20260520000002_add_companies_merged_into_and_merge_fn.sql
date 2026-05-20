-- companies.merged_into_company_id + merge_company() RPC 함수.
-- 배경:
--   scripts/rematch_dart_unmatched.py 가 ticker 충돌 시
--   `companies.delete().eq('id', old_id)` 로 hard delete 했다.
--   companies 를 참조하는 9개 종속 테이블이 모두 ON DELETE CASCADE 라
--   financials / news / stock_prices / company_pages 등의 이력 데이터가 함께 사라진다.
-- 조치:
--   (1) merged_into_company_id 컬럼을 추가해 병합 흔적을 추적.
--   (2) merge_company(p_old_id, p_new_id) RPC 함수로 종속 row 재매핑 + soft delete 를
--       Postgres 트랜잭션 안에서 일괄 처리한다. PK/UNIQUE 충돌 row 는 old 쪽을 정리한 뒤 update.
--   (3) old companies row 는 status='merged' 로 soft delete (행은 보존).

-- 1) merged_into_company_id 컬럼
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS merged_into_company_id uuid REFERENCES companies(id) ON DELETE SET NULL;

COMMENT ON COLUMN companies.merged_into_company_id IS
  '이 row 가 다른 회사 row 로 병합됐을 때 대상 회사 id (status=''merged'' 와 함께 사용).';

CREATE INDEX IF NOT EXISTS idx_companies_merged_into
  ON companies (merged_into_company_id)
  WHERE merged_into_company_id IS NOT NULL;

-- 2) merge_company(): 종속 row 재매핑 후 old row soft delete.
--   PK/UNIQUE 충돌: target 에 이미 같은 키 row 가 있으면 old 쪽 row 만 삭제(보존 우선순위는 target).
--   trade_date/snapshot_ts/ts/post_id/page/fiscal 조합이 한 회사당 unique 인 테이블 전수 처리.
CREATE OR REPLACE FUNCTION merge_company(p_old_id uuid, p_new_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_old_id IS NULL OR p_new_id IS NULL THEN
    RAISE EXCEPTION 'merge_company: old_id / new_id 가 NULL 입니다.';
  END IF;
  IF p_old_id = p_new_id THEN
    RETURN;
  END IF;

  -- company_pages PK(company_id, page)
  DELETE FROM company_pages
   WHERE company_id = p_old_id
     AND page IN (SELECT page FROM company_pages WHERE company_id = p_new_id);
  UPDATE company_pages SET company_id = p_new_id WHERE company_id = p_old_id;

  -- financials UNIQUE(company_id, period_type, fiscal_year, fiscal_quarter)
  DELETE FROM financials f
   WHERE f.company_id = p_old_id
     AND EXISTS (
       SELECT 1 FROM financials t
        WHERE t.company_id = p_new_id
          AND t.period_type   IS NOT DISTINCT FROM f.period_type
          AND t.fiscal_year   IS NOT DISTINCT FROM f.fiscal_year
          AND t.fiscal_quarter IS NOT DISTINCT FROM f.fiscal_quarter
     );
  UPDATE financials SET company_id = p_new_id WHERE company_id = p_old_id;

  -- news UNIQUE(url) — company_id 만 옮기면 url 충돌 가능. url 동일하면 old 쪽 삭제.
  DELETE FROM news n
   WHERE n.company_id = p_old_id
     AND EXISTS (SELECT 1 FROM news t WHERE t.company_id = p_new_id AND t.url = n.url);
  UPDATE news SET company_id = p_new_id WHERE company_id = p_old_id;

  -- naver_board_posts PK(company_id, post_id)
  DELETE FROM naver_board_posts
   WHERE company_id = p_old_id
     AND post_id IN (SELECT post_id FROM naver_board_posts WHERE company_id = p_new_id);
  UPDATE naver_board_posts SET company_id = p_new_id WHERE company_id = p_old_id;

  -- stock_daily_prices PK(company_id, trade_date)
  DELETE FROM stock_daily_prices
   WHERE company_id = p_old_id
     AND trade_date IN (SELECT trade_date FROM stock_daily_prices WHERE company_id = p_new_id);
  UPDATE stock_daily_prices SET company_id = p_new_id WHERE company_id = p_old_id;

  -- stock_prices PK(company_id, trade_date)
  DELETE FROM stock_prices
   WHERE company_id = p_old_id
     AND trade_date IN (SELECT trade_date FROM stock_prices WHERE company_id = p_new_id);
  UPDATE stock_prices SET company_id = p_new_id WHERE company_id = p_old_id;

  -- stock_quotes_5min PK(company_id, ts)
  DELETE FROM stock_quotes_5min
   WHERE company_id = p_old_id
     AND ts IN (SELECT ts FROM stock_quotes_5min WHERE company_id = p_new_id);
  UPDATE stock_quotes_5min SET company_id = p_new_id WHERE company_id = p_old_id;

  -- stock_supply_demand PK(company_id, trade_date)
  DELETE FROM stock_supply_demand
   WHERE company_id = p_old_id
     AND trade_date IN (SELECT trade_date FROM stock_supply_demand WHERE company_id = p_new_id);
  UPDATE stock_supply_demand SET company_id = p_new_id WHERE company_id = p_old_id;

  -- stock_supply_demand_intraday PK(company_id, snapshot_ts)
  DELETE FROM stock_supply_demand_intraday
   WHERE company_id = p_old_id
     AND snapshot_ts IN (SELECT snapshot_ts FROM stock_supply_demand_intraday WHERE company_id = p_new_id);
  UPDATE stock_supply_demand_intraday SET company_id = p_new_id WHERE company_id = p_old_id;

  -- old row soft delete
  UPDATE companies
     SET status = 'merged',
         merged_into_company_id = p_new_id,
         updated_at = now()
   WHERE id = p_old_id;
END;
$$;

COMMENT ON FUNCTION merge_company(uuid, uuid) IS
  '종속 row 를 new_id 로 재매핑한 뒤 old 회사 row 를 status=''merged'' 로 soft delete. 단일 트랜잭션.';
