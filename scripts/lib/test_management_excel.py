"""resolve_excel_path() 단위 테스트 — 환경변수 우선 / glob 폴백."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.management_excel import resolve_excel_path  # noqa: E402


def test_env_override_takes_precedence(tmp_path, monkeypatch):
  f = tmp_path / 'uploaded.xlsx'
  f.write_bytes(b'x')
  monkeypatch.setenv('MANAGEMENT_EXCEL_PATH', str(f))
  assert resolve_excel_path() == f


def test_env_missing_file_raises(monkeypatch):
  monkeypatch.setenv('MANAGEMENT_EXCEL_PATH', '/no/such/file.xlsx')
  try:
    resolve_excel_path()
    assert False, 'should raise'
  except FileNotFoundError:
    pass


def test_glob_fallback_when_no_env(tmp_path, monkeypatch):
  monkeypatch.delenv('MANAGEMENT_EXCEL_PATH', raising=False)
  base = tmp_path / '참고' / '손익'
  base.mkdir(parents=True)
  (base / '자료정리_월별손익_2026 5 27.xlsx').write_bytes(b'a')
  (base / '자료정리_월별손익_2026 6 22.xlsx').write_bytes(b'b')
  got = resolve_excel_path(base_dir=base)
  assert got.name == '자료정리_월별손익_2026 6 22.xlsx'


def test_glob_picks_latest_date_not_last_by_name(tmp_path, monkeypatch):
  """2026-11-23 실측: 글자순이면 「6 22」가 「10 31」보다 뒤라 6월 파일을 골랐다."""
  monkeypatch.delenv('MANAGEMENT_EXCEL_PATH', raising=False)
  for name in ('2026 6 22', '2026 10 31', '2026 5 27 - 복사본', '2026 5 27', '2025 12 31'):
    (tmp_path / f'자료정리_월별손익_{name}.xlsx').write_bytes(b'x')
  assert resolve_excel_path(base_dir=tmp_path).name == '자료정리_월별손익_2026 10 31.xlsx'


def test_same_date_prefers_original_over_copy(tmp_path, monkeypatch):
  monkeypatch.delenv('MANAGEMENT_EXCEL_PATH', raising=False)
  for name in ('2026 5 27 - 복사본', '2026 5 27'):
    (tmp_path / f'자료정리_월별손익_{name}.xlsx').write_bytes(b'x')
  assert resolve_excel_path(base_dir=tmp_path).name == '자료정리_월별손익_2026 5 27.xlsx'


def test_undated_name_loses_to_dated(tmp_path, monkeypatch):
  monkeypatch.delenv('MANAGEMENT_EXCEL_PATH', raising=False)
  for name in ('최종', '2026 1 5'):
    (tmp_path / f'자료정리_월별손익_{name}.xlsx').write_bytes(b'x')
  assert resolve_excel_path(base_dir=tmp_path).name == '자료정리_월별손익_2026 1 5.xlsx'


if __name__ == '__main__':
  import pytest
  sys.exit(pytest.main([__file__, '-v']))
