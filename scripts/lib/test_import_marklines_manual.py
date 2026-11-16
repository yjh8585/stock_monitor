"""수동 적재의 종류 판별 — 실물 엑셀 머리 모양(2026-11-16 실측)을 그대로 쓴다."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from import_marklines_manual import classify_header  # noqa: E402

META = ['Country', 'Group', 'Maker/Brand', 'Type', 'Segment', 'Model']


def test_sales_has_powertrain_column():
  assert classify_header(['Sheet1'], META + ['PowerTrain', 202401.0, 202512.0, 202601.0], {'China', 'Japan'}) == ('sales', None)


def test_sales_yearly_history_is_unknown():
  # 판매 연도별 이력 파일(…_2023_en)을 롤링 파일로 덮으면 그 해가 두 번 더해진다 — 2026-11-16 검토
  assert classify_header(['Sheet1'], META + ['PowerTrain', 202301.0, 202312.0], {'China', 'Japan'}) == (None, None)


def test_meta_mismatch_with_months_is_unknown():
  # 월 칸이 있어도 메타 6칸이 다르면 MarkLines 파일이 아니다(메타 검사를 지우면 이 시험이 깨진다)
  other = ['Nation', 'Group', 'Maker/Brand', 'Type', 'Segment', 'Model']
  assert classify_header(['Sheet1'], other + [202401.0, 202512.0], {'China', 'Japan'}) == (None, None)


def test_production_rolling_spans_years():
  assert classify_header(['Sheet1'], META + [202401.0, 202512.0, 202601.0], {'China', 'Japan'}) == ('production', None)


def test_passenger_is_single_year_china():
  assert classify_header(['Sheet1'], META + [202601.0, 202602.0, 202603.0], {'China'}) == ('passenger', 2026)


def test_single_year_not_china_is_unknown():
  # 생산 연도별 이력 파일(2020_en 등)은 한 해짜리지만 나라가 섞여 있다 — 승용차로 오인하면 안 된다
  # 첫 행이 China 여도(국가 이름순이라 먼저 나온다) 다른 나라가 섞이면 승용차가 아니다 — 2026-11-16 실측 오인
  assert classify_header(['Sheet1'], META + [202101.0, 202102.0], {'China', 'Japan'}) == (None, None)


def test_export_by_sheet_name():
  assert classify_header(['2026 by Chinese Group', '2026 by Group'], [], set()) == ('export', None)


def test_unrelated_workbook_is_unknown():
  assert classify_header(['Sheet1'], ['날짜', '금액'], set()) == (None, None)
  assert classify_header(['Sheet1'], META + ['합계'], {'China'}) == (None, None)
