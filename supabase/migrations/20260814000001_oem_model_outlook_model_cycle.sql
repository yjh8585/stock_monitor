-- oem_model_outlook 에 신차 사이클(model_cycle) 컬럼 추가.
--
-- 배경: 풀체인지·페이스리프트 정보는 이미 수집되고 있었지만 `outlook`(판매 전망) 서술 **안에**
-- 문장으로만 들어 있었다. 그래서 (1) 화면에서 접힌 채 묻히고 (2) 무엇보다 **경쟁 차종과
-- 견줄 수가 없었다** — "그랜드체로키가 밀리는 게 노후화 때문인가"는 대상과 경쟁의 연식을
-- 나란히 놓아야만 답할 수 있는데, 서술은 대상 하나만 이야기한다(사용자 지시 2026-08-14).
--
-- 그래서 시장별로 [대상 + 경쟁 상위 3종]의 완전변경·상품성 개선 연식을 구조화해 받는다.
-- 형태는 lib/oem-competition/types.ts 의 ModelCycleEntry 가 정본이다.
--
-- JSONB 인 이유: 시장 수·경쟁 차종 수가 차종마다 다르고(1~3개 시장 × 1~3종),
-- 같은 파일의 market_breakdown·metrics·consumer_scores 와 같은 방식이다.
-- 조회는 언제나 model_key+note_date 로 행을 통째 읽으므로 JSONB 내부 인덱스는 불필요하다.
ALTER TABLE oem_model_outlook
  ADD COLUMN IF NOT EXISTS model_cycle jsonb;

COMMENT ON COLUMN oem_model_outlook.model_cycle IS
  '시장별 신차 사이클 — [{market, models:[{model,is_target,last_full_change,last_update,'
  'last_update_type,next_event_type,next_event_timing,note}]}]. 대상 차종의 노후도를 '
  '경쟁 차종과 같은 축에서 비교하기 위한 것. 2026-08-14 이전 적재분은 NULL.';
