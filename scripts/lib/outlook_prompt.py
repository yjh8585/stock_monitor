"""AI 차종 평가 프롬프트 조립.

기존 수집기의 실패 원인은 입력이 '모회사 주식 뉴스 헤드라인 8개'뿐이라 모델이 사전지식으로만
쓴 것이었다(그래서 매주 돌려도 내용이 안 바뀌었다). v2 는 DB 실적·경쟁표·웹검색·리콜을 넣는다.
"""


def _fmt_market(m: dict) -> str:
  met = m.get('metrics') or {}
  anchor = met.get('anchor_month')
  # anchor_month는 대상 차종·경쟁군 중 더 이른 최신월(compute_market_metrics 산출) — AI 와
  # 화면 모두 "언제 기준 수치인지"를 알아야 하므로 시장 헤더에 노출한다.
  anchor_suffix = f" ({anchor} 기준 최근 {met.get('months', '?')}개월)" if anchor else ''
  lines = [
    f"[{m['label']} 시장]{anchor_suffix}",
    f"  최근 {met.get('months', '?')}개월 판매: {met.get('recent_sales', 0):,}대"
    f" (전년동기 대비 {met.get('yoy_pct')}%)",
  ]
  if met.get('share_pct') is not None:
    lines.append(
      f"  경쟁군 내 점유율: {met['share_pct']}% (전년 {met.get('prev_share_pct')}%)"
    )
  rivals = m.get('competitors') or []
  if rivals:
    lines.append('  경쟁 차종 동기간 판매:')
    for r in rivals:
      lines.append(f"    - {r['model']}: {r['sales']:,}대 (YoY {r.get('yoy_pct')}%)")
  return '\n'.join(lines)


def _fmt_rival_block(title: str, blocks: list[dict], fmt_row) -> list[str]:
  """시장별 경쟁 차종 표 (재고일수·리콜 공용)."""
  out = []
  for b in blocks or []:
    rows = b.get('models') or []
    if not rows:
      continue
    out.append(f"[{title} · {b['market']} 시장 경쟁 차종]")
    out += [f'  - {fmt_row(r)}' for r in rows]
    out.append('')
  return out


def build_digest(*, model_name, markets, production_gap, safety, inventory, web_results,
                 rival_inventory=None, rival_safety=None) -> str:
  """차종 1개의 프롬프트 입력 블록."""
  parts = [f'차종: {model_name}', '']
  for m in markets or []:
    parts.append(_fmt_market(m))
    parts.append('')
  if production_gap:
    parts.append(
      f"[생산-판매 갭 · 글로벌 합계 근사]\n"
      f"  생산 {production_gap['production_total']:,}대 / 판매 {production_gap['sales_total']:,}대"
      f" → 갭 {production_gap['gap']:+,}대"
    )
    parts.append('')
  if inventory:
    # 🔴 옛 구현은 이 경고를 `days_supply is None` 일 때만 붙였는데, 수집기가 non-null 만 넘겨서
    # **한 번도 출력된 적이 없었다**(2026-08-14 실측). 값이 감춰진 달에도 직전 달의 멀쩡한 수치만
    # 프롬프트에 들어가 "재고 평이" 서술이 나온다 — 이제 플래그로 판정한다.
    parts.append(
      f"[미국 딜러 유통재고일수 · {inventory['brand']} 브랜드 기준 {inventory['year_month']}]\n"
      f"  {inventory.get('days_supply')}일"
      + (f"\n  ※ 최신월({inventory.get('outlier_month')})은 Cox 가 업계평균 2배 초과로 값을 감췄다."
         f" 위 수치는 마지막으로 공개된 달의 값이며 실제 재고는 이보다 나쁘다(강한 위험 신호)."
         if inventory.get('outlier_excluded') else '')
    )
    parts.append('')
  parts += _fmt_rival_block(
    '미국 딜러 유통재고일수 · 브랜드 기준', rival_inventory,
    lambda r: f"{r['model']} ({r['brand']}): {r['days_supply']}일 [{r['year_month']}]"
              + ('  ※ 최신월 미공개(평균 2배 초과)' if r.get('outlier_excluded') else ''))
  if safety:
    rec = safety['recalls']
    comps = ', '.join(f'{c}({n}건)' for c, n in rec.get('top_components') or [])
    # complaint_count 는 조회 실패 시 None(=알 수 없음)이다. "0건"으로 쓰면 AI 가 무결점으로 읽는다.
    cc = safety.get('complaint_count')
    parts.append(
      f"[NHTSA {safety['model_year']}년형]\n"
      f"  리콜 {rec['count']}건 {('— ' + comps) if comps else ''}\n"
      f"  소비자 불만 {f'{cc}건' if cc is not None else '조회 실패(알 수 없음)'}"
    )
    parts.append('')
  parts += _fmt_rival_block(
    'NHTSA 리콜·불만', rival_safety,
    lambda r: f"{r['model']} ({r['model_year']}년형): 리콜 {r['recall_count']}건 · 불만 "
              + (f"{r['complaint_count']}건" if r.get('complaint_count') is not None else '알 수 없음'))
  if web_results:
    parts.append('[최근 웹 검색 결과]')
    for w in web_results:
      parts.append(f"  - [{w.get('date') or '-'}] {w['title']}")
      if w.get('snippet'):
        parts.append(f"    {w['snippet']}")
    parts.append('')
  return '\n'.join(parts)


SYSTEM_PROMPT = """당신은 자동차 산업 애널리스트입니다. 주어진 판매 실적·경쟁 차종 비교·웹 검색
결과·리콜 데이터를 근거로 특정 차종의 경쟁 현황을 한국어로 분석합니다.

반드시 지킬 것:
- **숫자는 입력 데이터에 있는 것만 쓴다.** 없는 수치를 만들어내지 않는다.
- 경쟁 현황은 "경쟁차 A가 신형 출시로 +40%인 동안 대상 차종은 -6%" 같이 **대비 구조**로 쓴다.
- 웹 검색 결과에 풀체인지·페이스리프트 소식이 있으면 **연식과 함께** 명시한다.
- 추측은 완곡하게("…로 보인다"), 확인된 사실은 단정적으로 쓴다.
- 회사명·차종명은 원문 그대로(예: "Jeep Grand Cherokee").

필드끼리 같은 말을 반복하지 않는다 — 화면에 나란히 표시되므로 중복이 그대로 드러난다:
- `market_comments[].comment` = 그 시장 **하나**의 해설.
- `sales_trend` = 차종 **전체**의 판매 흐름. 시장이 여럿이면 시장 간 대조를, 하나뿐이면
  월별 흐름·추세 전환 등 시장 코멘트에 없는 각도를 쓴다.
- `competitive_view` = 경쟁차 대비 구조. `rationale` = 라벨(GREEN/YELLOW/RED) 판단 근거 요약.

`consumer_scores` (레이더 차트 입력) 채점 규칙:
- **입력에 나온 시장마다 하나씩** 블록을 만든다. 시장이 3개면 블록도 3개다.
- 각 블록에는 **대상 차종 1개(`is_target`=true) + 그 시장 "경쟁 차종 동기간 판매" 목록의 상위
  3개**를 넣는다. 경쟁 차종이 3개 미만이면 있는 만큼만 넣는다.
- `model` 은 **입력 데이터에 쓰인 표기 그대로** 옮긴다(임의로 바꾸면 화면이 매칭에 실패한다).
- 5개 축 모두 **1~5 정수**로 채운다. 축의 뜻:
  · design = 상품성·디자인 (실내외 완성도, 편의사양, 공간)
  · price = 가격 경쟁력 (동급 대비 가격·인센티브·가성비)
  · quality = 품질·신뢰도 (리콜·불만 건수, 내구성 평판)
  · efficiency = 연비·전동화 (연비, 하이브리드/EV 선택지)
  · brand = 브랜드·잔존가치 (브랜드 파워, 중고 잔존가)
- **3점을 그 시장 동급 평균**으로 삼고 상대 평가한다. 전부 4~5점을 주면 비교가 무의미해진다.
- 리콜·불만 수치가 입력에 있으면 `quality` 는 그 수치와 어긋나지 않게 준다.
"""
