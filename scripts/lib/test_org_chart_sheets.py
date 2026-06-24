import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from org_chart_sheets import parse_kor_sheets


def test_filters_kor_and_parses_date():
    names = [
        '변경 전 조직도(Kor.)_20260201',
        '변경 전 조직도(Eng.)_20260201',
        '변경 후 조직도(Kor.)_20260701',
        '변경 후 조직도(Eng.)_20260701',
    ]
    assert parse_kor_sheets(names) == [
        ('변경 전 조직도(Kor.)_20260201', '2026-02-01'),
        ('변경 후 조직도(Kor.)_20260701', '2026-07-01'),
    ]


def test_returns_empty_when_no_kor_sheet():
    assert parse_kor_sheets(['Sheet1', 'data']) == []


def test_sorted_by_date_ascending():
    names = ['변경 후 조직도(Kor.)_20260701', '변경 전 조직도(Kor.)_20260201']
    assert [d for _, d in parse_kor_sheets(names)] == ['2026-02-01', '2026-07-01']
