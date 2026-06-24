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
  assert got.name == '자료정리_월별손익_2026 6 22.xlsx'  # 사전순 마지막


if __name__ == '__main__':
  import pytest
  sys.exit(pytest.main([__file__, '-v']))
