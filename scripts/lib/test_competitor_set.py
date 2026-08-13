# scripts/lib/test_competitor_set.py
"""경쟁군에 적은 모델명이 실제 판매 테이블에 존재하는지 확인한다.

오타 하나로 경쟁군 점유율이 조용히 틀어지므로 DB 를 직접 조회해 검증한다.
DB 접근이 안 되는 환경(CI 등)에서는 스킵한다.
"""
import os

import pytest

pytestmark = pytest.mark.skipif(
  not os.environ.get('SUPABASE_URL'), reason='DB 미설정 환경에서는 스킵'
)

# 20260813000002 원본 seed에 20260813000004~000006 정정을 반영한 기대값(모델명 정본).
# 배열째 교체하는 UPDATE로 유효 항목이 조용히 빠지는 사고(2026-08-13 Captur·Elantra Yuedong
# 누락, 코드 리뷰 2건)를 재발 방지하기 위해 14개 시장 전부를 여기 고정해 대조한다.
EXPECTED_COMPETITOR_SETS = {
  ('grand_cherokee', 'USA'): {
    'target_models': {'Grand Cherokee (Jeep (2009-))'},
    'competitor_models': {'Explorer', 'Traverse', 'Grand Highlander', 'Telluride', 'Palisade', 'Honda Pilot', 'Highlander'},
  },
  ('ram_truck', 'USA'): {
    'target_models': {'Ram P/U'},
    'competitor_models': {'Ford F-Series', 'Silverado', 'GMC Sierra', 'Tundra', 'Nissan Titan'},
  },
  ('pacifica', 'USA'): {
    'target_models': {'Pacifica (Chrysler (2009-))'},
    'competitor_models': {'Odyssey', 'Sienna', 'Carnival (Sedona)'},
  },
  ('rivian_r1', 'USA'): {
    'target_models': {'R1T', 'R1S'},
    'competitor_models': {'Model X', 'Cybertruck', 'Hummer SUV', 'Hummer Pickup', 'Lucid Air', 'EV9', 'IONIQ 5'},
  },
  ('atlas', 'USA'): {
    'target_models': {'VW Atlas'},
    'competitor_models': {'Explorer', 'Traverse', 'Grand Highlander', 'Telluride', 'Palisade', 'Honda Pilot', 'Highlander', 'Grand Cherokee (Jeep (2009-))'},
  },
  ('porsche_911', 'GLOBAL'): {
    'target_models': {'Porsche 911'},
    'competitor_models': {'Corvette', 'Boxster/Cayman', 'Supra', 'Nissan Z', 'F-Type'},
  },
  ('seltos', 'India'): {
    'target_models': {'SELTOS'},
    'competitor_models': {'Creta (ix25)', 'Venue', 'Nexon', 'Brezza', 'Sonet', 'XUV 3XO'},
  },
  ('seltos', 'USA'): {
    'target_models': {'SELTOS'},
    'competitor_models': {'HR-V', 'Kona', 'Crosstrek', 'Corolla Cross', 'Trailblazer'},
  },
  ('seltos', 'Korea'): {
    'target_models': {'SELTOS'},
    'competitor_models': {'Kona', 'Casper', 'EV3', 'Trailblazer'},
  },
  # 20260813000004 정정: USA엔 'Avante'가 없고 'Avante (Elantra)'만 존재(전 기간 확인됨).
  ('avante_ex_china', 'USA'): {
    'target_models': {'Avante (Elantra)'},
    'competitor_models': {'Civic', 'Corolla', 'Sentra', 'Jetta', 'K4'},
  },
  # 20260813000004 정정: Korea엔 'Avante (Elantra)'가 없고 'Avante'만 존재(전 기간 확인됨).
  ('avante_ex_china', 'Korea'): {
    'target_models': {'Avante'},
    'competitor_models': {'K5', 'Sonata/YF Sonata/LF Sonata', 'Casper'},
  },
  # 20260813000006 복원: 'Elantra Yuedong'은 202001~202312 41개월 실판매 데이터가 있는
  # 별개 항목(오타 아님) — lib/oem/aggregate.ts의 OTHER_MODEL_TARGETS와 동일하게 합산.
  ('avante_china', 'China'): {
    'target_models': {'Elantra/Yuedong/Langdong/Elantra 2016', 'Elantra Yuedong'},
    'competitor_models': {'Bluebird Sylphy/Sylphy', 'Lavida', 'Sagitar', 'Qin PLUS', 'Qin L'},
  },
  ('niro', 'USA'): {
    'target_models': {'NIRO'},
    'competitor_models': {'HR-V', 'Kona', 'Corolla Cross', 'Crosstrek'},
  },
  # 20260813000004 정정: 'Puma'→'Ford Puma', '2008'→'Peugeot 2008'.
  # 20260813000005 복원: 배열째 교체하며 함께 빠졌던 'Captur' 되돌림.
  ('niro', 'Europe'): {
    'target_models': {'NIRO'},
    'competitor_models': {'Kona', 'Captur', 'Ford Puma', 'Peugeot 2008'},
  },
}


def test_모든_경쟁군_모델이_판매테이블에_존재한다():
  """연도 필터를 두지 않는다 — 'Elantra Yuedong'처럼 202312에서 끊긴 과거 전용 표기를
  최근 구간(예: 202501~)만 보고 "없음"으로 오판한 사고가 있었다(2026-08-13, 코드 재검토).
  존재 여부는 전 기간 기준으로 판단해야 한다."""
  from lib.db import get_client

  c = get_client()
  sets = c.table('oem_competitor_set').select('*').execute().data
  assert sets, 'oem_competitor_set 이 비어 있다'
  assert len(sets) == 14, f'시장 정의는 14개여야 하는데 {len(sets)}개'

  missing = []
  for s in sets:
    countries = s.get('countries')  # NULL = 전 국가(GLOBAL)
    for model in list(s['target_models']) + list(s['competitor_models']):
      q = c.table('oem_sales_model_country_month').select('model').eq('model', model)
      if countries:
        q = q.in_('country', countries)
      if not (q.limit(1).execute().data or []):
        missing.append(f"{s['model_key']}/{s['market']}: {model}")
  assert not missing, '판매 테이블에 없는 모델명:\n' + '\n'.join(missing)


def test_GLOBAL_외의_시장은_countries가_채워져_있다():
  """'Europe' 같은 값을 country 로 직접 넘기면 0행이 나온다 — countries 배열이 실제 필터다."""
  from lib.db import get_client

  c = get_client()
  for s in c.table('oem_competitor_set').select('model_key,market,countries').execute().data:
    if s['market'] == 'GLOBAL':
      assert not s['countries'], f"{s['model_key']}/GLOBAL 은 countries 가 NULL 이어야 한다"
    else:
      assert s['countries'], f"{s['model_key']}/{s['market']} 에 countries 가 비어 있다"


def test_경쟁군에서_유효한_모델이_누락되지_않았다():
  """배열 교체형 UPDATE 로 유효 항목이 조용히 빠지는 사고를 막는다
  (2026-08-13 Captur 누락 · Elantra Yuedong 누락, 코드 리뷰 2건).
  14개 시장 전부의 target_models/competitor_models 를 정본과 집합 대조한다."""
  from lib.db import get_client

  c = get_client()
  rows = c.table('oem_competitor_set').select('model_key,market,target_models,competitor_models').execute().data
  assert len(rows) == 14, f'시장 정의는 14개여야 하는데 {len(rows)}개'

  mismatches = []
  seen = set()
  for row in rows:
    key = (row['model_key'], row['market'])
    seen.add(key)
    want = EXPECTED_COMPETITOR_SETS.get(key)
    if want is None:
      mismatches.append(f'{key[0]}/{key[1]}: 기대값 정의가 없는 새 행')
      continue
    if set(row['target_models']) != want['target_models']:
      mismatches.append(f"{key[0]}/{key[1]} target_models 불일치: {set(row['target_models'])} != {want['target_models']}")
    if set(row['competitor_models']) != want['competitor_models']:
      mismatches.append(f"{key[0]}/{key[1]} competitor_models 불일치: {set(row['competitor_models'])} != {want['competitor_models']}")

  missing_keys = set(EXPECTED_COMPETITOR_SETS) - seen
  if missing_keys:
    mismatches.append(f'DB에 없는 기대 행: {sorted(missing_keys)}')

  assert not mismatches, '경쟁군 구성이 정본과 다르다:\n' + '\n'.join(mismatches)
