-- cox_brand_inventory — 결측 사유를 표현 가능하게 (20260716000001 후속).
--
-- 왜 필요한가 (2026-07-15 실측 발견):
--   Cox는 **업계 평균(NATION)의 2배를 넘는 브랜드를 막대에서 빼고** 차트 우측 박스에 이름만 싣는다
--   ("Automaker with days' supply at least twice the industry average: Chrysler").
--   수치를 아예 공개하지 않는다. 그 결과 **Chrysler가 202512~202603 4개월 결측**이다 —
--   하필 재고가 가장 심각한 달에 값이 없다. 202604에 135(< 78×2)로 복귀했다.
--
--   문제는 결측 사유가 최소 4가지인데 원래 스키마(행 없음)로는 구분이 안 된다는 점이다:
--     ① 이상치 제외  — Cox가 값을 감춤. **사실상 "≥ NATION×2"라는 강한 신호**
--     ② 저물량 상시 제외 — Fiat·Alfa Romeo (전 기간 부재)
--     ③ 그 달만 로스터 누락 — Lincoln 202601, Audi 202512 (제외박스에도 없음)
--     ④ 판독/검증 실패 — 우리 쪽 문제
--   이를 구분 못 하면 "결측 = 재고 심각"으로 읽어 Lincoln·Fiat를 위험으로 오판하거나,
--   반대로 Chrysler의 진짜 위험 신호를 "데이터 없음"으로 흘려버린다. 둘 다 이 페이지의 목적을 깬다.
--
-- 설계: 이상치 제외(①)는 **행을 만들되 days_supply = null + is_outlier_excluded = true**로 적재한다.
--   "값은 모르지만 NATION×2 이상인 건 안다"를 정직하게 표현한다. ②③④는 행 없음 그대로다
--   (우리가 아는 게 없으므로 아는 척하지 않는다).

-- days_supply를 nullable로 — 이상치 제외 행은 값이 없다.
alter table public.cox_brand_inventory
  alter column days_supply drop not null;

-- 이상치 제외 플래그. true면 days_supply는 null이고 "NATION × 2 이상"을 의미한다.
alter table public.cox_brand_inventory
  add column if not exists is_outlier_excluded boolean not null default false;

-- 정합성: 제외 행은 값이 없어야 하고, 값이 있는 행은 제외가 아니어야 한다.
alter table public.cox_brand_inventory
  add constraint cox_brand_inventory_outlier_null_check
  check (
    (is_outlier_excluded and days_supply is null)
    or (not is_outlier_excluded and days_supply is not null)
  );

comment on column public.cox_brand_inventory.is_outlier_excluded is
  'true = Cox가 업계 평균 2배 초과라 차트에서 제외한 브랜드(days_supply는 null이지만 NATION×2 이상이라는 뜻). false = 정상 판독값.';

comment on column public.cox_brand_inventory.days_supply is
  '딜러 재고일수. is_outlier_excluded=true면 null(Cox 미공개). 행 자체가 없으면 저물량 제외/로스터 누락/판독실패 중 하나로 우리가 모르는 상태.';

comment on column public.cox_brand_inventory.brand is
  'BRAND_ALIASES로 최신 표기에 정규화된 브랜드명(Cox가 202602부터 Mercedes-Benz → Mercedes로 라벨 변경 → 정규화 없이는 한 회사가 두 시계열로 쪼개짐). 업계 평균 행은 NATION. 원본 라벨은 수집 캐시 meta에 보존.';
