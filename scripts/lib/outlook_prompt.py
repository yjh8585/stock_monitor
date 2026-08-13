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


def build_digest(*, model_name, markets, production_gap, safety, inventory, web_results) -> str:
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
    parts.append(
      f"[미국 딜러 재고일수 · {inventory['brand']} 브랜드 기준 {inventory['year_month']}]\n"
      f"  {inventory.get('days_supply')}일"
      + ('  ※ Cox 가 업계평균 2배 초과로 값을 감춤(위험 신호)' if inventory.get('days_supply') is None else '')
    )
    parts.append('')
  if safety:
    rec = safety['recalls']
    comps = ', '.join(f'{c}({n}건)' for c, n in rec.get('top_components') or [])
    parts.append(
      f"[NHTSA {safety['model_year']}년형]\n"
      f"  리콜 {rec['count']}건 {('— ' + comps) if comps else ''}\n"
      f"  소비자 불만 {safety['complaint_count']}건"
    )
    parts.append('')
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
"""
