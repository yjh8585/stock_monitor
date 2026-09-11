"""제품군 카테고리 목록을 «DB 정본에서» 읽어 온다.

🔴 **목록을 파이썬에 다시 박지 말 것.** 정본은 `product_category_map.normalized` 이고
(마이그레이션 `20260513000010` · `20260824000002`), 이미 UI 쪽에 사본이 3벌 있다
(`lib/types.ts` 의 `ROBOT_PRODUCT_CATEGORIES` · `FilterBar.tsx` · `DomesticFilterBar.tsx`).
네 번째 사본을 만들면 갈린다 — 수집기는 어차피 DB 에 붙으므로 그때 함께 읽는다.

**왜 필요한가** (2026-09-11 실측): `companies.products[].category` 는 BEFORE 트리거
`normalize_products_categories()` 가 단독으로 정한다. 값이 `product_category_map` 의
raw 키와 **완전일치**하지 않으면 조용히 `'기타'` 가 된다. 그런데 수집기 5개 중 4개가
category 를 아예 안 넣었고, 넣는 하나(`enrich_products_customers_sonnet.py`)도 LLM 에게
목록을 주지 않아 자유 문자열이 나왔다. 그 결과가 **`'기타'` 1,860건(전체의 44%)** 이고,
거꾸로 가전제품이 자동차 칸을 받기도 했다(LG전자 TV → 구동계 · 의류관리기 → 제동).

사용법:
    from lib.product_categories import fetch_product_categories, category_guide
    cats = fetch_product_categories(client)
    schema['properties']['category'] = {'type': 'string', 'enum': cats, ...}
"""

from __future__ import annotations

# 목록 밖 값은 트리거가 '기타' 로 떨어뜨리므로, LLM 에게 이 사실을 그대로 알려 준다.
_GUIDE_TAIL = (
  "자동차 부품도 로봇 부품도 아닌 제품(가전·휴대폰·화학·금융·의류·식품 등)은 "
  "반드시 '기타' 로 분류하세요. 목록에 없는 값을 지어내면 저장할 때 '기타' 로 버려집니다."
)

# 🔴 경계 규칙 — **사용자 결정 2026-09-11**. 실측으로 갈린 자리만 못 박았다(추측 금지).
#    Sonnet dry-run 에서 조명·와이퍼 76건이 '안전' 으로, 차량용 반도체 일부가 '기타' 로
#    갔다. 어느 쪽도 「틀렸다」고 잘라 말할 수 없는 경계여서 사용자가 기준을 정했다.
_BOUNDARY_RULES = (
  "경계 규칙(반드시 따를 것):\n"
  "- 램프·헤드램프·조명·와이퍼(와이퍼 모터 포함)는 '전장' 입니다. "
  "'안전' 은 에어백·ADAS·시트벨트처럼 «사고에 대응하는» 부품에만 씁니다.\n"
  "- 차량에 들어가는 반도체·칩은 기본이 '전장' 입니다. 다만 용도가 분명하면 그 칸으로 보냅니다 "
  "— 각도·위치를 재는 IC 는 '위치센서', AI 가속기·로봇 제어기는 '제어AI칩'. "
  "🔴 차량용 반도체를 '기타' 로 내리지 마세요.\n"
  "- 냉각·열관리(쿨러·라디에이터·리저브 탱크·전동 압축기)는 '공조' 입니다. "
  "단 EGR·터보차저처럼 «연소에 직접 관여» 하는 것은 '엔진' 입니다.\n"
  "- 배터리 하우징·케이스·팩·BMS 는 '배터리' 입니다. 차량용이 아닌 배터리(IT기기용 등)는 '기타'."
)


def fetch_product_categories(client) -> list[str]:
  """`product_category_map.normalized` 의 고유값 목록(정렬).

  🔴 비어 있으면 **예외를 던진다.** 조용히 빈 목록을 돌려주면 enum 이 사라져
  옛 동작(자유 문자열 → 전부 '기타')으로 소리 없이 되돌아간다.
  """
  rows = client.table('product_category_map').select('normalized').execute().data or []
  values = sorted({r['normalized'] for r in rows if r.get('normalized')})
  if not values:
    raise RuntimeError(
      'product_category_map 이 비었다 — 카테고리 정본을 읽지 못했다. '
      '마이그레이션 20260513000010·20260824000002 적용 여부를 확인할 것.'
    )
  return values


# 로봇 «전용» 카테고리. `배터리`·`기타` 는 자동차와 공유하므로 여기 넣지 않는다.
# 🔴 이것은 사본이지만 **검증되는 사본**이다 — `split_domains()` 가 DB 정본과 대조해
#    하나라도 어긋나면 예외를 던진다. DB 에 도메인 구분 컬럼이 없어서 둔 최소한의 표다
#    (마이그레이션 `20260824000002` 가 넣은 로봇 시드가 출처).
ROBOT_ONLY_CATEGORIES = frozenset({
  '액추에이터', '감속기', '모터', '볼스크류/리니어', '힘토크센서',
  '위치센서', '비전카메라', '제어AI칩', '구조기구', '그리퍼핸드',
})


def split_domains(categories: list[str]) -> tuple[list[str], list[str]]:
  """`(자동차용 목록, 로봇용 목록)` 으로 가른다. 둘 다 `기타`·`배터리` 를 포함한다.

  🔴 **가르지 않으면 자동차 부품이 로봇 칸으로 샌다**(2026-09-11 실측). 22종을 통째로
  주고 분류시켰더니 보그워너의 「통합 드라이브 모듈(iDM)」·「전자식 크로스 디퍼렌셜」이
  **제어AI칩** 으로 갔고, 뒤엣것은 원래 `구동계` 로 맞던 값이었다. 예시(raw 키)를 붙여도
  안 고쳐졌다 — 후보에 «있으면» 고르기 때문이다. 아예 후보에서 빼야 막힌다.
  """
  known = set(categories)
  missing = ROBOT_ONLY_CATEGORIES - known
  if missing:
    raise RuntimeError(
      f'로봇 카테고리 표가 DB 와 어긋났다: {sorted(missing)} 가 product_category_map 에 없다. '
      'ROBOT_ONLY_CATEGORIES 를 DB 정본에 맞춰 고칠 것.'
    )
  auto = [c for c in categories if c not in ROBOT_ONLY_CATEGORIES]
  robot = [c for c in categories if c in ROBOT_ONLY_CATEGORIES or c in ('기타', '배터리')]
  return auto, robot


def fetch_category_examples(client) -> dict[str, list[str]]:
  """`{정규화값: [그 값으로 매핑되는 raw 키들]}` — 카테고리의 «범위»를 보여 주는 예시.

  🔴 이름만으로는 LLM 이 범위를 못 짚는다(2026-09-11 실측). 목록만 주고 분류시켰더니
  「머플러 → 제동」(배기계인데 브레이크로) · 「통합 드라이브 모듈 → 제어AI칩」(자동차
  부품이 로봇 칸으로) 같은 오분류가 나왔고, **이미 맞던 값까지 망가뜨렸다**
  (「전자식 크로스 디퍼렌셜: 구동계 → 제어AI칩」). raw 키를 예시로 붙이면 범위가 드러난다.
  """
  rows = client.table('product_category_map').select('raw_category,normalized').execute().data or []
  out: dict[str, list[str]] = {}
  for r in rows:
    norm, raw = r.get('normalized'), r.get('raw_category')
    if not norm or not raw or raw == norm:  # 왕복용 self 키는 예시로 쓸모가 없다
      continue
    out.setdefault(norm, []).append(raw)
  for v in out.values():
    v.sort()
  return out


def category_guide(categories: list[str], examples: dict[str, list[str]] | None = None) -> str:
  """LLM 프롬프트·스키마 description 에 넣을 한 문단.

  `examples` 를 주면 카테고리마다 범위를 함께 보여 준다 — **주는 쪽을 기본으로 삼을 것.**
  """
  if not examples:
    return f"다음 중 하나여야 합니다: {' · '.join(categories)}. {_GUIDE_TAIL}\n{_BOUNDARY_RULES}"
  lines = []
  for c in categories:
    ex = examples.get(c) or []
    lines.append(f"- {c}" + (f" (예: {', '.join(ex[:6])})" if ex else ''))
  return (
    '다음 중 하나여야 합니다.\n'
    + '\n'.join(lines)
    + f"\n{_GUIDE_TAIL}\n{_BOUNDARY_RULES}"
  )
