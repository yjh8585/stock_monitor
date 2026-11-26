-- 공급 이력은 「확인」 등급만 저장한다 (결정 7 변경 · 사용자 승인 2026-11-27).
--
-- 20261126000001 은 「확인」·「추정」을 둘 다 저장하고 뷰가 「확인」만 내보내는 설계였다. 그런데 companies 는
-- anon 이 직접 읽는 표(anon_read_companies USING(true))라, 「추정」을 넣으면 화면(뷰)에는 안 나와도 공개 키로
-- 조회된다. 그래서 시드는 「확인」만 넣었고(20261126000002), 이제 DB 가 다른 등급을 거부하게 한다.
-- 「추정」은 git 밖 명단 정본(참고/모터회사/motor_companies.json)과 덱에만 둔다.
--
-- 판정: 「확인」 원소만 걸러 낸 배열이 원래 배열과 같아야 한다 — grade 가 빠진 원소도 거부된다.
-- 적용 전 실측(2026-11-27): 공급 이력 원소 32개 전부 「확인」.

ALTER TABLE companies
  ADD CONSTRAINT companies_supply_history_confirmed_only
    CHECK (
      supply_history IS NULL
      OR jsonb_path_query_array(supply_history, '$[*] ? (@.grade == "확인")') = supply_history
    );

COMMENT ON COLUMN companies.supply_history IS
  '공급 이력 [{customer, product?, field: auto|robot|industrial, grade: 확인, source_url, as_of?}]. 납품·양산 수주·공급 계약만. append-only. 「확인」만 저장(CHECK companies_supply_history_confirmed_only — anon 이 직접 읽는 표라 「추정」은 명단 정본 파일·덱 전용)';
