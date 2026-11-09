"""가이던스 방향(direction) — 같은 회사·metric·period 의 직전 검증 행과 비교해 코드가 정한다(LLM 이 정하지 않는다).

규칙(계획서 Task 6):
- 직전 행 없음 → initiated
- 둘 다 숫자: 가운데값 비교(한쪽 끝만 있으면 그 끝) · 상대 차 0.5% 이내 → maintained(반올림 표기 차 흡수:
  현대 '416만 대' vs '4,158,300 대') · 크면 raised · 작으면 lowered
  ⚠️ 범위 좁히기(GM 14.0~16.0 → 14.5~15.5)는 가운데값이 같아 maintained 다 — 원문이 'raising' 이라 해도 숫자가 우선
- 숫자로 비교 못 함(value_text 만): 원문 낱말(stated)이 있으면 그것 · 글자가 같으면 maintained · 아니면 None(화면 「변경」)
- withdrawn 은 stated='withdrawn' 일 때만
- 단위(unit)가 다르면(Task 8 검토 1회차): million·billion·trillion 끼리는 배수로 환산해 비교한다(리비안은 FY2025 전망을
  million, FY2026 을 billion 으로 냈다 — 같은 FY 안에서 바뀌어도 '1.7 billion' vs '1,700 million' 은 maintained).
  환산 못 하는 단위끼리(percent vs billion 등)는 숫자 비교를 건너뛰고 원문 낱말(stated)만 본다 — 없으면 None
  (글자 비교로 가면 value_text 가 둘 다 None 일 때 ''=='' 로 maintained 를 지어낸다 · Task 11).
- 직전 행이 없어도 숫자 없이 「전망 확인·유지」만 밝힌 행(stated='maintained', 스텔란티스 확인 6-K)은 initiated 가 아니라 maintained.
- 🔴 metric='other' 는 숫자·글자를 견주지 않고 stated 만 쓴다(없으면 None) — 'other' 는 서로 다른 항목이 한 칸에 모여
  (확인 6-K 'confirms' · 폴라리스 철회 · 예전 LLM 의 배당성향·EV 대수) 비교하면 방향을 지어낸다(Task 11 수정 1회차).
호출 = scripts/collect_customer_numbers.py(회사마다 verified 가이던스 전부를 다시 매긴다).
"""

_SCALE = {'million': 1e6, 'billion': 1e9, 'trillion': 1e12}   # base.UNITS 의 배수 단위


def _point(low, high):
  if low is not None and high is not None:
    return (low + high) / 2
  return low if low is not None else high


def _scales(prev: dict, cur: dict) -> tuple[float, float] | None:
  """두 행 값에 곱할 배수. 단위가 같거나(또는 한쪽이 비면) 1 · 둘 다 배수 단위면 환산 · 환산 못 하면 None."""
  pu, cu = prev.get('unit'), cur.get('unit')
  if pu == cu or pu is None or cu is None:
    return 1.0, 1.0
  if pu in _SCALE and cu in _SCALE:
    return _SCALE[pu], _SCALE[cu]
  return None


def decide(prev: dict | None, cur: dict) -> str | None:
  if cur.get('stated') == 'withdrawn':
    return 'withdrawn'
  if cur.get('metric') == 'other':
    return cur['stated'] if cur.get('stated') in ('raised', 'maintained', 'lowered') else None
  b = _point(cur.get('low'), cur.get('high'))
  if prev is None:
    # 숫자 없이 「전망 확인·유지」만 밝힌 행(스텔란티스 2024-12·2025-09 6-K · metric='other')은 처음 보여도 신규가 아니다
    return 'maintained' if b is None and cur.get('stated') == 'maintained' else 'initiated'
  a = _point(prev.get('low'), prev.get('high'))
  if a is not None and b is not None:
    scales = _scales(prev, cur)
    if scales is None:
      # 환산 못 하는 단위끼리 — 숫자도 글자도 견줄 수 없다. 원문 낱말만 쓰고 없으면 None(Task 8 carry: value_text 가
      # 둘 다 None 이면 아래 글자 비교가 ''=='' 로 maintained 를 지어냈다)
      return cur['stated'] if cur.get('stated') in ('raised', 'maintained', 'lowered') else None
    a, b = a * scales[0], b * scales[1]
    if abs(b - a) <= abs(a) * 0.005:
      return 'maintained'
    return 'raised' if b > a else 'lowered'
  if cur.get('stated') in ('raised', 'maintained', 'lowered'):
    return cur['stated']
  if (prev.get('value_text') or '').strip().lower() == (cur.get('value_text') or '').strip().lower():
    return 'maintained'
  return None


def assign(rows: list[dict]) -> list[tuple[int, str | None]]:
  """rows = 한 회사의 verified 가이던스 전부(id·metric·period·published_at·document_id·low·high·value_text·stated·unit).
  (metric, period) 별로 (published_at, document_id) 순 정렬 뒤, published_at 이 «엄격히 앞선» 마지막 행과 비교 → [(id, direction)].
  같은 날 행끼리는 비교하지 않는다 — 같은 날 두 공시(현대 2026-10-29 전망 정정 20261029800240 과 장래사업 정정
  20261029800231 — 둘 다 2026 판매목표 400만 대)는 선후가 아니라 같은 발표라, document_id 순으로 이으면 뒤 행이
  앞 행 대비 「유지」로 찍혀 직전 날짜(416만 대) 대비 「하향」을 잃는다."""
  out, groups = [], {}
  for r in rows:
    groups.setdefault((r['metric'], r['period']), []).append(r)
  for items in groups.values():
    items.sort(key=lambda r: (r['published_at'], r['document_id']))
    prev = last = None   # prev = 직전 «날짜»의 마지막 행 · last = 지금까지 본 마지막 행
    for r in items:
      if last is not None and last['published_at'] != r['published_at']:
        prev = last
      out.append((r['id'], decide(prev, r)))
      last = r
  return out


MUST_HIT = [  # (prev, cur, 기대)
  (None, {'low': 13.0, 'high': 15.0}, 'initiated'),
  ({'low': 4158300, 'high': 4158300}, {'low': 4160000, 'high': 4160000}, 'maintained'),   # 416만 대 반올림
  ({'low': 65000, 'high': 70000}, {'low': 67000, 'high': 70000}, 'raised'),              # 리비안 10-02 → 10-29
  ({'low': 4.0, 'high': 5.5}, {'low': None, 'high': 1.0}, 'lowered'),                     # VW 반기 → 9개월
  ({'low': 14.0, 'high': 16.0}, {'low': 14.5, 'high': 15.5, 'stated': 'raised'}, 'maintained'),  # 숫자가 우선
  ({'value_text': 'Low-Single Digit %'}, {'value_text': 'low-single digit %'}, 'maintained'),
  ({'value_text': 'Improved Y-o-Y'}, {'value_text': 'Positive'}, None),
  ({'low': 1.0, 'high': 2.0}, {'low': None, 'high': None, 'stated': 'withdrawn'}, 'withdrawn'),
  # 단위가 다른 같은 값(검토 1회차) — 환산 없이 비교하면 1.7 vs 1700 이라 raised 로 찍힌다
  ({'low': 1.7, 'high': 1.7, 'unit': 'billion'}, {'low': 1700, 'high': 1700, 'unit': 'million'}, 'maintained'),
  ({'low': 1800, 'high': 1900, 'unit': 'million'}, {'low': 1.95, 'high': 2.05, 'unit': 'billion'}, 'raised'),
  # 환산 못 하는 단위끼리는 숫자를 견주지 않는다 → 원문 낱말
  ({'low': 1.0, 'high': 3.0, 'unit': 'percent'}, {'low': 7.15, 'high': 7.30, 'unit': 'billion', 'stated': 'maintained'},
   'maintained'),
  # 환산 못 하는 단위끼리 · 원문 낱말 없음 · value_text 둘 다 None → 견줄 근거가 없다(''=='' 로 maintained 를 지어내지 않는다)
  ({'low': 1.0, 'high': 3.0, 'unit': 'percent', 'value_text': None},
   {'low': 7.15, 'high': 7.30, 'unit': 'billion', 'value_text': None}, None),
  # 숫자 없이 「전망 확인」만 밝힌 첫 행(metric='other') → 신규가 아니라 유지
  (None, {'low': None, 'high': None, 'value_text': 'confirms', 'unit': 'text', 'stated': 'maintained'}, 'maintained'),
  (None, {'low': 13.0, 'high': 15.0, 'stated': 'maintained'}, 'initiated'),   # 숫자가 있는 첫 행은 신규
  # metric='other' — stated 만(숫자·글자 비교 안 함 · 처음 보여도 initiated 아님)
  ({'metric': 'other', 'value_text': None}, {'metric': 'other', 'value_text': None}, None),   # ''=='' 로 maintained 금지
  ({'metric': 'other', 'low': 30, 'high': 30}, {'metric': 'other', 'low': 1e6, 'high': 1e6}, None),   # 다른 항목 숫자
  ({'metric': 'other', 'value_text': 'confirms', 'stated': 'maintained'},
   {'metric': 'other', 'value_text': 'confirms', 'stated': 'maintained'}, 'maintained'),
  ({'metric': 'other', 'value_text': 'confirms', 'stated': 'maintained'},
   {'metric': 'other', 'value_text': 'withdrawing', 'stated': 'withdrawn'}, 'withdrawn'),
  (None, {'metric': 'other', 'low': 1e6, 'high': 1e6}, None),
]


def self_test() -> list[str]:
  errs = []
  for prev, cur, want in MUST_HIT:
    got = decide(prev, cur)
    if got != want:
      errs.append(f'{prev} → {cur}: 기대 {want} · 실제 {got}')
  return errs
