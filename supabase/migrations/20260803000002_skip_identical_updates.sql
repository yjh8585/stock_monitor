-- 동일 값 UPDATE 스킵 트리거 (2026-08-03)
--
-- 배경: 수집 스크립트가 매 실행마다 전체 행을 upsert하므로, 값이 하나도 바뀌지 않은 행에도
--   UPDATE가 발생한다. 실측(2026-08-03 pg_stat_user_tables 누적):
--     exchange_rates       8,165행  ← UPDATE 5,215,679회 (행당 638회)
--     market_series_daily 27,784행  ← UPDATE 18,223,899회 (행당 656회)
--     stock_quotes_5min  109,004행  ← UPDATE 3,307,514회
--   UPDATE는 값이 같아도 WAL(미리쓰기 로그)에 기록되고 dead tuple을 남긴다. 그 결과
--   WAL 디렉터리가 880MB까지 커져 디스크 1.59GB의 55%를 차지했고, Free 플랜 용량 초과의
--   주원인이 되었다(12시간 46분에 880MB 생성 = 하루 약 1.65GB).
--
-- 처방: BEFORE UPDATE에서 NEW와 OLD가 완전히 같으면 RETURN NULL로 해당 UPDATE를 건너뛴다.
--   행이 물리적으로 기록되지 않으므로 WAL도 dead tuple도 발생하지 않는다.
--   IS NOT DISTINCT FROM은 NULL-safe 비교라 NULL 값을 가진 컬럼이 있어도 올바르게 판정한다.
--   값이 실제로 달라진 행은 평소대로 UPDATE되므로 수집 동작에는 변화가 없다.
--
-- 대상 선정 기준: 순수 데이터 컬럼만 있고 updated_at처럼 매번 바뀌는 컬럼이 없는 수집 테이블.
--   companies·financials·posts 등은 기존 BEFORE 트리거(정규화·타임스탬프 갱신)가 있어
--   상호작용을 피하기 위해 제외한다.

create or replace function public.skip_identical_update()
returns trigger
language plpgsql
as $$
begin
  if new is not distinct from old then
    return null;  -- 변경 없음 → UPDATE 취소 (WAL 기록·dead tuple 미발생)
  end if;
  return new;
end;
$$;

comment on function public.skip_identical_update() is
  '값이 동일한 UPDATE를 취소해 WAL 기록과 dead tuple 발생을 막는다. 수집 스크립트의 반복 upsert 대응(2026-08-03).';

do $$
declare
  t text;
begin
  foreach t in array array[
    'market_series_daily',
    'exchange_rates',
    'stock_prices',
    'stock_quotes_5min',
    'stock_supply_demand',
    'stock_supply_demand_intraday',
    'oem_sales_model_country_month',
    'oem_sales_group_country_month',
    'oem_production_model_country_month'
  ]
  loop
    execute format('drop trigger if exists trg_skip_identical_update on public.%I', t);
    execute format(
      'create trigger trg_skip_identical_update before update on public.%I '
      'for each row execute function public.skip_identical_update()', t
    );
  end loop;
end $$;
