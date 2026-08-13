"""차종 경쟁 지표 계산 — 순수 함수만 둔다(DB 접근 없음).

계산을 Python 한 곳에서만 하고 결과를 oem_model_outlook.metrics(JSONB)에 저장한다.
TypeScript 쪽은 표시만 하므로 계산 로직이 두 언어로 갈리지 않는다.
"""


def _sum(rows: list[dict], field: str) -> int:
  return sum(int(r.get(field) or 0) for r in rows)


def _window(rows: list[dict], months: int, offset_years: int = 0,
            anchor: int | None = None) -> list[dict]:
  """최근 N개월(offset_years=1 이면 1년 전 동기간) 행만.

  anchor를 주면 그 값을 기준월로 쓴다. 서로 다른 데이터셋(대상 차종 vs 경쟁군)을
  비교할 때 각자의 max(year_month)를 쓰면 기간이 어긋나 점유율이 왜곡되므로,
  caller가 공통 기준월을 넘겨 맞춘다.
  """
  if not rows:
    return []
  latest = anchor if anchor is not None else max(r['year_month'] for r in rows)
  y, m = divmod(latest, 100)
  y -= offset_years
  end = y * 100 + m
  start_total = (y * 12 + m - 1) - (months - 1)
  start = (start_total // 12) * 100 + (start_total % 12) + 1
  return [r for r in rows if start <= r['year_month'] <= end]


def compute_market_metrics(target_rows: list[dict], competitor_rows: list[dict], *, months: int,
                          anchor: int | None = None) -> dict:
  """한 시장의 대상 차종 지표 — 최근 N개월 판매, YoY, 경쟁군 내 점유율(현재/전년).

  anchor가 None이면 자동으로 대상과 경쟁군의 최신월 중 더 이른 쪽을 기준으로 사용한다.
  이를 통해 서로 다른 도착 시점의 데이터를 공정하게 비교한다.
  """
  # 공통 앵커 계산 (anchor 미지정 시 자동)
  if anchor is None:
    target_latest = max((r['year_month'] for r in target_rows), default=0)
    competitor_latest = max((r['year_month'] for r in competitor_rows), default=0)
    if target_latest and competitor_latest:
      anchor = min(target_latest, competitor_latest)
    elif target_latest:
      anchor = target_latest
    elif competitor_latest:
      anchor = competitor_latest

  recent = _sum(_window(target_rows, months, anchor=anchor), 'sales')
  prev = _sum(_window(target_rows, months, offset_years=1, anchor=anchor), 'sales')
  rivals_recent = _sum(_window(competitor_rows, months, anchor=anchor), 'sales')
  rivals_prev = _sum(_window(competitor_rows, months, offset_years=1, anchor=anchor), 'sales')

  def share(part: int, others: int) -> float | None:
    total = part + others
    return round(part * 100 / total, 1) if total > 0 and others > 0 else None

  return {
    'months': months,
    'anchor_month': anchor,
    'recent_sales': recent,
    'prev_year_sales': prev,
    'yoy_pct': round((recent - prev) * 100 / prev, 1) if prev else None,
    'share_pct': share(recent, rivals_recent),
    'prev_share_pct': share(prev, rivals_prev),
    'competitor_sales': rivals_recent,
  }


def compute_competitor_table(rows_by_model: dict[str, list[dict]], *, months: int,
                            anchor: int | None = None) -> list[dict]:
  """경쟁차종별 최근 N개월 판매·YoY 표 (AI 프롬프트·화면 공용).

  anchor를 전달받으면 모든 모델이 같은 기준 기간을 쓴다.
  """
  # anchor 미지정 시 자동으로 모든 행의 최신월 중 최소값 계산
  if anchor is None:
    all_months = []
    for rows in rows_by_model.values():
      if rows:
        all_months.append(max(r['year_month'] for r in rows))
    anchor = min(all_months) if all_months else None

  out = []
  for model, rows in rows_by_model.items():
    recent = _sum(_window(rows, months, anchor=anchor), 'sales')
    prev = _sum(_window(rows, months, offset_years=1, anchor=anchor), 'sales')
    out.append({
      'model': model,
      'sales': recent,
      'yoy_pct': round((recent - prev) * 100 / prev, 1) if prev else None,
    })
  return sorted(out, key=lambda x: -x['sales'])
