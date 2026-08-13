"""차종 경쟁 지표 계산 — 순수 함수만 둔다(DB 접근 없음).

계산을 Python 한 곳에서만 하고 결과를 oem_model_outlook.metrics(JSONB)에 저장한다.
TypeScript 쪽은 표시만 하므로 계산 로직이 두 언어로 갈리지 않는다.
"""


def _sum(rows: list[dict], field: str) -> int:
  return sum(int(r.get(field) or 0) for r in rows)


def _window(rows: list[dict], months: int, offset_years: int = 0) -> list[dict]:
  """최근 N개월(offset_years=1 이면 1년 전 동기간) 행만."""
  if not rows:
    return []
  latest = max(r['year_month'] for r in rows)
  y, m = divmod(latest, 100)
  y -= offset_years
  end = y * 100 + m
  start_total = (y * 12 + m - 1) - (months - 1)
  start = (start_total // 12) * 100 + (start_total % 12) + 1
  return [r for r in rows if start <= r['year_month'] <= end]


def compute_market_metrics(target_rows: list[dict], competitor_rows: list[dict], *, months: int) -> dict:
  """한 시장의 대상 차종 지표 — 최근 N개월 판매, YoY, 경쟁군 내 점유율(현재/전년)."""
  recent = _sum(_window(target_rows, months), 'sales')
  prev = _sum(_window(target_rows, months, offset_years=1), 'sales')
  rivals_recent = _sum(_window(competitor_rows, months), 'sales')
  rivals_prev = _sum(_window(competitor_rows, months, offset_years=1), 'sales')

  def share(part: int, others: int) -> float | None:
    total = part + others
    return round(part * 100 / total, 1) if total > 0 and others > 0 else None

  return {
    'months': months,
    'recent_sales': recent,
    'prev_year_sales': prev,
    'yoy_pct': round((recent - prev) * 100 / prev, 1) if prev else None,
    'share_pct': share(recent, rivals_recent),
    'prev_share_pct': share(prev, rivals_prev),
    'competitor_sales': rivals_recent,
  }


def compute_competitor_table(rows_by_model: dict[str, list[dict]], *, months: int) -> list[dict]:
  """경쟁차종별 최근 N개월 판매·YoY 표 (AI 프롬프트·화면 공용)."""
  out = []
  for model, rows in rows_by_model.items():
    recent = _sum(_window(rows, months), 'sales')
    prev = _sum(_window(rows, months, offset_years=1), 'sales')
    out.append({
      'model': model,
      'sales': recent,
      'yoy_pct': round((recent - prev) * 100 / prev, 1) if prev else None,
    })
  return sorted(out, key=lambda x: -x['sales'])
