"""오케스트레이터 순수 함수 테스트 — 요약 빌드 / 경고 추출 (금액 비노출)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sync_management_excel import build_job_summary, extract_warnings  # noqa: E402


def test_extract_warnings_picks_mismatch_and_warning_lines():
  out = (
    'INFO 엑셀 로드: x\n'
    'WARNING 자산 != 부채+자본 mismatch: 1/5시점 (tol=0.5%)\n'
    'INFO 검증 OK\n'
  )
  w = extract_warnings(out)
  assert any('mismatch' in line for line in w)
  assert all('밸류' not in line for line in w)


def test_extract_warnings_filters_openpyxl_noise():
  out = (
    'site-packages/openpyxl/worksheet/_reader.py:329: UserWarning: '
    'Data Validation extension is not supported and will be removed\n'
    'WARNING 정합성 불일치(임계 0.5%): 매출 1개 연도\n'
  )
  w = extract_warnings(out)
  assert len(w) == 1
  assert '정합성 불일치' in w[0]


def test_extract_warnings_strips_ansi_color_codes():
  out = '\x1b[33m\x1b[1mWARNING\x1b[0m 정합성 불일치: 매출 1개 연도\n'
  w = extract_warnings(out)
  assert len(w) == 1
  assert '\x1b[' not in w[0]
  assert w[0].startswith('WARNING')


def test_build_job_summary_all_ok():
  results = [
    {'name': 'sync_finance', 'exit_code': 0, 'output': 'INFO 검증 OK\n'},
    {'name': 'sync_loan', 'exit_code': 0, 'output': 'INFO 완료\n'},
  ]
  s = build_job_summary(results)
  assert s['ok'] is True
  assert len(s['scripts']) == 2
  assert all(item['ok'] for item in s['scripts'])
  assert s['warnings'] == []


def test_build_job_summary_one_failed():
  results = [
    {'name': 'sync_finance', 'exit_code': 2, 'output': 'ERROR 헤더 불일치\n'},
    {'name': 'sync_loan', 'exit_code': 0, 'output': 'INFO 완료\n'},
  ]
  s = build_job_summary(results)
  assert s['ok'] is False
  finance = next(i for i in s['scripts'] if i['name'] == 'sync_finance')
  assert finance['ok'] is False
  assert finance['exit_code'] == 2


if __name__ == '__main__':
  import pytest
  sys.exit(pytest.main([__file__, '-v']))
