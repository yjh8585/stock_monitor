-- 고객사 2단계 Task 11 수정 1회차 — LLM 가이던스 행의 통화 칸 · 문서별 LLM 재시도 횟수.
-- currency: null = 회사 보고 통화(파서 모듈 BASE_CURRENCY). 외화 목표(모비스 수주 'USD 89.7억')만 LLM 이 적는다.
-- llm_attempts: LLM 예외·LLM 행 전부 대조 실패로 pending 에 남긴 횟수 — 3 이면 수집기가 닫는다(parsed 또는 failed).

alter table public.customer_guidance add column if not exists currency text
  check (currency is null or currency in ('KRW', 'USD', 'EUR', 'VND'));
comment on column public.customer_guidance.currency is
  '금액·주당 값의 통화. null = 회사 보고 통화. 코드 파서 행은 늘 null.';

alter table public.customer_documents add column if not exists llm_attempts integer not null default 0
  check (llm_attempts >= 0);
comment on column public.customer_documents.llm_attempts is
  'LLM 재시도 횟수(예외·LLM 행 전부 대조 실패). 3 이면 닫는다 — scripts/collect_customer_numbers.py LLM_MAX_ATTEMPTS.';
