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


def test_모든_경쟁군_모델이_판매테이블에_존재한다():
  from lib.db import get_client

  c = get_client()
  sets = c.table('oem_competitor_set').select('*').execute().data
  assert sets, 'oem_competitor_set 이 비어 있다'
  assert len(sets) == 14, f'시장 정의는 14개여야 하는데 {len(sets)}개'

  missing = []
  for s in sets:
    countries = s.get('countries')  # NULL = 전 국가(GLOBAL)
    for model in list(s['target_models']) + list(s['competitor_models']):
      q = c.table('oem_sales_model_country_month').select('model').eq('model', model).gte('year_month', 202501)
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
  """배열 교체형 UPDATE 로 유효 항목이 조용히 빠지는 사고를 막는다(2026-08-13 Captur 누락)."""
  from lib.db import get_client

  c = get_client()
  expected = {
    ('niro', 'Europe'): {'Kona', 'Captur', 'Ford Puma', 'Peugeot 2008'},
  }
  for (mk, market), want in expected.items():
    row = (c.table('oem_competitor_set').select('competitor_models')
           .eq('model_key', mk).eq('market', market).single().execute().data)
    assert set(row['competitor_models']) == want, f'{mk}/{market} 경쟁군이 달라졌다'
