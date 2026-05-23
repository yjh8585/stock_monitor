"""bootstrap.init_script 자동 검증 — mock 기반 unittest.

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_bootstrap.py
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.bootstrap import init_script  # noqa: E402


class InitScriptTests(unittest.TestCase):
  """init_script 호출이 정확히 sys.path + load_dotenv를 설정하는지 검증."""

  def setUp(self) -> None:
    # 각 테스트 시작 시 sys.path를 깨끗하게 복사 — 다른 테스트 영향 회피.
    self._original_sys_path = sys.path.copy()

  def tearDown(self) -> None:
    sys.path[:] = self._original_sys_path

  @patch('lib.bootstrap.load_dotenv')
  def test_scripts_top_level(self, mock_load_dotenv) -> None:
    """scripts/collect_xxx.py 호출 시: scripts/.env + project/.env.local 로드."""
    fake_file = '/proj/scripts/collect_xxx.py'
    init_script(fake_file)

    # load_dotenv가 2번 호출 — scripts/.env + project/.env.local
    self.assertEqual(mock_load_dotenv.call_count, 2)
    called_paths = [call.args[0] for call in mock_load_dotenv.call_args_list]
    self.assertEqual(str(called_paths[0]).replace('\\', '/'), '/proj/scripts/.env')
    self.assertEqual(str(called_paths[1]).replace('\\', '/'), '/proj/.env.local')

  @patch('lib.bootstrap.load_dotenv')
  def test_scripts_lib_subdir(self, _mock) -> None:
    """scripts/lib/foo.py 호출 시에도 scripts/를 sys.path에 추가."""
    fake_file = '/proj/scripts/lib/foo.py'
    init_script(fake_file)

    # scripts/ 디렉터리가 sys.path 맨 앞에 추가
    self.assertEqual(sys.path[0].replace('\\', '/'), '/proj/scripts')

  @patch('lib.bootstrap.load_dotenv')
  def test_sys_path_idempotent(self, _mock) -> None:
    """같은 file_path로 두 번 호출해도 sys.path에 중복 등록 안 함."""
    fake_file = '/proj/scripts/collect_xxx.py'
    init_script(fake_file)
    init_script(fake_file)

    scripts_count = sum(1 for p in sys.path if p.replace('\\', '/') == '/proj/scripts')
    self.assertEqual(scripts_count, 1)

  @patch('lib.bootstrap.load_dotenv')
  def test_sys_path_prepend(self, _mock) -> None:
    """sys.path[0] 위치에 prepend되어 우선순위 최상위."""
    fake_file = '/proj/scripts/collect_xxx.py'
    init_script(fake_file)
    self.assertEqual(sys.path[0].replace('\\', '/'), '/proj/scripts')


if __name__ == '__main__':
  unittest.main()
