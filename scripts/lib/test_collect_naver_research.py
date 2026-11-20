"""collect_naver_research 구조 변경 판정 회귀 검증 — 네트워크·DB 없이.

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_collect_naver_research.py

2026-11-20 코드 리뷰: 「목록 파싱 0건 = 구조 변경」을 산업·종목 합계로 판정해, 한 목록만 고장 나면
다른 목록 건수에 가려 exit 0 으로 끝났다. 종류마다 판정하고, 하나라도 0이면 저장 없이 exit 3.
"""
import importlib.util
import sys
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

# 수집 스크립트는 scripts/ 루트의 단일 파일 — 패키지가 아니라 파일 경로로 로드한다.
_spec = importlib.util.spec_from_file_location(
  'collect_naver_research', SCRIPTS_DIR / 'collect_naver_research.py'
)
col = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(col)


def _run(parsed_by_kind: dict[str, int]) -> tuple[int, mock.MagicMock]:
  """종류별 파싱 건수를 흉내 내 main() 을 돌린다. (종료코드, 저장 세션 mock) 을 돌려준다."""
  def fake_collect(kind, since, known, seen):
    return [], parsed_by_kind[kind]

  args = mock.Mock(mode='incremental', months=1, dry_run=False)
  with mock.patch.object(col, 'parse_args', return_value=args), \
       mock.patch.object(col, 'get_client'), \
       mock.patch.object(col, 'load_tracked_companies', return_value={}), \
       mock.patch.object(col, 'load_known_nids', return_value=set()), \
       mock.patch.object(col, 'resolve_since', return_value=date(2026, 11, 1)), \
       mock.patch.object(col, 'collect_kind', side_effect=fake_collect), \
       mock.patch.object(col, 'WriteSession') as ws:
    return col.main(), ws


class StructureChangeTest(unittest.TestCase):
  def test_one_kind_zero_is_structure_change(self):
    first, second = col.KINDS[0], col.KINDS[1]
    code, ws = _run({first: 120, second: 0})
    self.assertEqual(code, col.EXIT_STRUCTURE_CHANGED)
    ws.assert_not_called()  # 성한 목록도 저장하지 않는다(증분 하한이 앞으로 가지 않게)

  def test_all_zero_is_structure_change(self):
    code, _ = _run({k: 0 for k in col.KINDS})
    self.assertEqual(code, col.EXIT_STRUCTURE_CHANGED)

  def test_both_parsed_but_nothing_new_is_ok(self):
    code, _ = _run({k: 50 for k in col.KINDS})
    self.assertEqual(code, col.EXIT_OK)


if __name__ == '__main__':
  unittest.main()
