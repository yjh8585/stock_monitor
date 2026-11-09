"""가이던스 방향(direction) — 같은 회사·metric·period 의 직전 검증 행과 비교해 코드가 정한다(LLM 이 정하지 않는다).

규칙(계획서 Task 6):
- 직전 행 없음 → initiated
- 둘 다 숫자: 가운데값 비교(한쪽 끝만 있으면 그 끝) · 상대 차 0.5% 이내 → maintained(반올림 표기 차 흡수:
  현대 '416만 대' vs '4,158,300 대') · 크면 raised · 작으면 lowered
  ⚠️ 범위 좁히기(GM 14.0~16.0 → 14.5~15.5)는 가운데값이 같아 maintained 다 — 원문이 'raising' 이라 해도 숫자가 우선
- 숫자로 비교 못 함(value_text 만): 원문 낱말(stated)이 있으면 그것 · 글자가 같으면 maintained · 아니면 None(화면 「변경」)
- withdrawn 은 stated='withdrawn' 일 때만
호출 = scripts/collect_customer_numbers.py(회사마다 verified 가이던스 전부를 다시 매긴다).
"""


def _point(low, high):
  if low is not None and high is not None:
    return (low + high) / 2
  return low if low is not None else high


def decide(prev: dict | None, cur: dict) -> str | None:
  if cur.get('stated') == 'withdrawn':
    return 'withdrawn'
  if prev is None:
    return 'initiated'
  a, b = _point(prev.get('low'), prev.get('high')), _point(cur.get('low'), cur.get('high'))
  if a is not None and b is not None:
    if abs(b - a) <= abs(a) * 0.005:
      return 'maintained'
    return 'raised' if b > a else 'lowered'
  if cur.get('stated') in ('raised', 'maintained', 'lowered'):
    return cur['stated']
  if (prev.get('value_text') or '').strip().lower() == (cur.get('value_text') or '').strip().lower():
    return 'maintained'
  return None


def assign(rows: list[dict]) -> list[tuple[int, str | None]]:
  """rows = 한 회사의 verified 가이던스 전부(id·metric·period·published_at·document_id·low·high·value_text·stated).
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
]


def self_test() -> list[str]:
  errs = []
  for prev, cur, want in MUST_HIT:
    got = decide(prev, cur)
    if got != want:
      errs.append(f'{prev} → {cur}: 기대 {want} · 실제 {got}')
  return errs
