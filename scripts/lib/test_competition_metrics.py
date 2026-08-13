from lib.competition_metrics import compute_market_metrics, compute_competitor_table, _window


def _row(ym, sales, model='T'):
  return {'year_month': ym, 'sales': sales, 'model': model}


def test_YoY와_경쟁군점유율이_계산된다():
  target = [_row(202501, 100), _row(202502, 100), _row(202601, 90), _row(202602, 90)]
  rivals = [_row(202501, 300, 'R'), _row(202502, 300, 'R'),
            _row(202601, 410, 'R'), _row(202602, 410, 'R')]
  m = compute_market_metrics(target, rivals, months=2)
  assert m['recent_sales'] == 180
  assert m['prev_year_sales'] == 200
  assert m['yoy_pct'] == -10.0
  # 점유율 180/(180+820)=18.0% ← 200/(200+600)=25.0%
  assert m['share_pct'] == 18.0
  assert m['prev_share_pct'] == 25.0


def test_경쟁군이_비면_점유율은_None():
  m = compute_market_metrics([_row(202601, 10)], [], months=1)
  assert m['share_pct'] is None


def test_경쟁표는_판매량_내림차순으로_정렬된다():
  out = compute_competitor_table(
    {'A': [_row(202601, 10)], 'B': [_row(202601, 30)]}, months=1
  )
  assert [x['model'] for x in out] == ['B', 'A']


def test_window_월경계_최신202603_months6():
  """최신이 202603, months=6 → 시작이 202510 (6개월)"""
  rows = [
    _row(202510, 10),
    _row(202511, 10),
    _row(202512, 10),
    _row(202601, 10),
    _row(202602, 10),
    _row(202603, 10),
  ]
  result = _window(rows, months=6)
  assert len(result) == 6
  assert [r['year_month'] for r in result] == [202510, 202511, 202512, 202601, 202602, 202603]


def test_window_월경계_최신202601_months3():
  """최신이 202601, months=3 → 시작이 202511 (3개월)"""
  rows = [
    _row(202511, 10),
    _row(202512, 10),
    _row(202601, 10),
  ]
  result = _window(rows, months=3)
  assert len(result) == 3
  assert [r['year_month'] for r in result] == [202511, 202512, 202601]


def test_window_월경계_offset_years1_최신202603_months6():
  """offset_years=1, 최신 202603, months=6 → 202410~202503 (전년 동기간)"""
  rows = [
    _row(202410, 10),
    _row(202411, 10),
    _row(202412, 10),
    _row(202501, 10),
    _row(202502, 10),
    _row(202503, 10),
    _row(202603, 20),  # 최신값
  ]
  result = _window(rows, months=6, offset_years=1)
  assert len(result) == 6
  assert [r['year_month'] for r in result] == [202410, 202411, 202412, 202501, 202502, 202503]
