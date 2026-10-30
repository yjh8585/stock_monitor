-- MarkLines 중국 승용 생산·차급·수출 (월) — /oem/china 탭 소스.
--
-- 소스: marklines.com/en/vehicle_production/member 의 China 카드 엑셀 3종
--   ① Displacement/NEV (.xls)  → oem_china_production_month  (모델 × 파워트레인)
--   ② Passenger Cars (.xlsx)    → oem_china_segment_month     (차종 × 세그먼트)
--   ③ Export Volume (.xlsx)     → oem_china_export_month      (모델, EV 태그)
--   ①과 ②는 월 합계가 정확히 같다(같은 생산을 다르게 쪼갠 것). 적재 = scripts/import_oem_china.py.
--
-- 승용(Sedan/Hatchback·SUV·MPV·Mini Van)만 싣는다 — 엑셀엔 트럭·버스 행이 섞여 있어 파서가 거른다.
-- 수출 파일엔 차종 열이 없지만 모델명 대조로 승용 전용임을 확인했다(2026-10-29 실측).
--
-- ⚠️ cn_group 은 **중국 모회사** 기준이다(FAW-VW·FAW-Toyota → FAW). 글로벌 그룹(Toyota Group)인
--   oem_production_model_country_month.oem_group 과 의미가 다르다. 적재 시 해마다 바뀐 그룹명을
--   맞추고(scripts/lib/china_excel.py GROUP_ALIASES), 모회사가 'n.a.' 인 행은 브랜드명으로 바꿔 넣는다
--   (테슬라·위에다기아·MINI 가 각각 한 줄 — 사용자 선택 2026-10-29).
--
-- 기존 중국 생산(oem_production_model_country_month country='China')과는 받은 시점 차이로 약 2% 다르다.
-- 중국 탭은 이 테이블들만 쓴다. 공개 데이터 → 기존 oem 테이블과 같이 anon read 허용.
-- 계획·결정 = docs/plans/2026-10-29-oem-china-tab.md

create table if not exists public.oem_china_production_month (
  cn_group     text   not null,
  maker_brand  text   not null,
  vehicle_type text   not null,
  model        text   not null,
  -- ICE·HV·PHEV·EV·FCEV — 판매 쪽 normalize_powertrain 과 같은 규칙
  powertrain   text   not null,
  year_month   int    not null,
  production   bigint not null,
  primary key (cn_group, maker_brand, vehicle_type, model, powertrain, year_month)
);
create index if not exists idx_oem_china_prod_ym
  on public.oem_china_production_month (year_month);

create table if not exists public.oem_china_segment_month (
  vehicle_type text   not null,
  segment      text   not null,
  year_month   int    not null,
  production   bigint not null,
  primary key (vehicle_type, segment, year_month)
);

create table if not exists public.oem_china_export_month (
  cn_group      text   not null,
  maker         text   not null,
  brand         text   not null,
  model         text   not null,
  -- 모델 단위 태그(EV·PHV·EV/PHV/ICE …). 물량이 파워트레인별로 쪼개진 값이 아니다.
  -- 2021 이전 시트엔 열이 없어 null, 2022+ 의 빈칸은 ''(태그 없음).
  ev_tag        text,
  year_month    int    not null,
  export_volume bigint not null,
  primary key (cn_group, maker, brand, model, year_month)
);
create index if not exists idx_oem_china_export_ym
  on public.oem_china_export_month (year_month);

do $$
declare
  t text;
begin
  foreach t in array array['oem_china_production_month', 'oem_china_segment_month', 'oem_china_export_month']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy anon_read_%1$s on public.%1$I for select to anon using (true)', t);
    execute format(
      'create policy service_write_%1$s on public.%1$I for all to service_role using (true) with check (true)', t);
    -- 내용이 같은 UPDATE 를 삼킨다(20260803000002). 🔴 동일 값 upsert 는 0행을 돌려준다.
    execute format(
      'create trigger trg_skip_identical_update before update on public.%I '
      'for each row execute function public.skip_identical_update()', t);
  end loop;
end $$;
