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


def test_앵커_미지정_시_자동으로_min_최신월_선택():
  """대상과 경쟁군 최신월이 다르면, 더 이른 쪽(min)을 기준으로 통일한다"""
  target = [_row(202601, 100), _row(202602, 100), _row(202603, 100)]  # 최신 202603
  rivals = [_row(202601, 300, 'R'), _row(202602, 300, 'R')]  # 최신 202602
  m = compute_market_metrics(target, rivals, months=2)
  # 앵커는 min(202603, 202602) = 202602
  # 양쪽 모두 202601~202602 기간을 쓴다
  assert m['anchor_month'] == 202602
  assert m['recent_sales'] == 200  # target 202601+202602 = 100+100
  assert m['competitor_sales'] == 600  # rivals 202601+202602 = 300+300


def test_앵커_명시_시_해당_값으로_기간_고정():
  """anchor를 명시하면 그 값으로 기간을 고정한다"""
  target = [_row(202601, 100), _row(202602, 100), _row(202603, 100)]
  rivals = [_row(202601, 300, 'R'), _row(202602, 300, 'R')]
  m = compute_market_metrics(target, rivals, months=2, anchor=202602)
  # 명시된 앵커 202602 사용
  assert m['anchor_month'] == 202602
  assert m['recent_sales'] == 200


def test_앵커_반환되고_경쟁표에_적용():
  """compute_competitor_table도 anchor를 받아 모든 모델이 같은 기간 사용"""
  # target이 202603 기준이라고 해서 전달한 anchor
  anchor = 202602
  rows_by_model = {
    'A': [_row(202601, 10), _row(202602, 20), _row(202603, 30)],
    'B': [_row(202601, 50), _row(202602, 60)],  # 202602까지만 있음
  }
  out = compute_competitor_table(rows_by_model, months=2, anchor=anchor)
  # 양쪽 모두 anchor(202602) 기준 2개월 (202601+202602) 사용
  models = {row['model']: row['sales'] for row in out}
  assert models['A'] == 30  # 202601(10) + 202602(20)
  assert models['B'] == 110  # 202601(50) + 202602(60)


def test_anchor_None일_때_자동계산():
  """anchor=None 이면 각 행의 최신월 중 min을 자동 계산"""
  rows_by_model = {
    'A': [_row(202601, 10), _row(202602, 20), _row(202603, 30)],  # max 202603
    'B': [_row(202601, 50), _row(202602, 60)],  # max 202602
  }
  out = compute_competitor_table(rows_by_model, months=2)
  # 자동 앵커 = min(202603, 202602) = 202602
  models = {row['model']: row['sales'] for row in out}
  assert models['A'] == 30  # 202601(10) + 202602(20)
  assert models['B'] == 110  # 202601(50) + 202602(60)
