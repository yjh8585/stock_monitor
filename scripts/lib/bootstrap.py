"""스크립트 boilerplate 축약 — dotenv 2종 + sys.path 표준 설정.

신규 스크립트는 첫 줄에 본 함수를 호출. 기존 90개 스크립트는 그대로 두되,
향후 수정·신규 작성 시 이 패턴 권장.

사용:
  from lib.bootstrap import init_script
  init_script(__file__)

  from lib.db import WriteSession  # noqa: E402

대체하는 보일러플레이트 (~11줄):
  from pathlib import Path
  from dotenv import load_dotenv
  load_dotenv(Path(__file__).parent / '.env')
  load_dotenv(Path(__file__).parent.parent / '.env.local')
  sys.path.insert(0, str(Path(__file__).parent))
"""
import sys
from pathlib import Path

from dotenv import load_dotenv


def init_script(file_path: str) -> None:
  """스크립트 첫 줄에 호출.

  file_path: 호출 스크립트의 ``__file__``. ``scripts/<name>.py`` 또는
             ``scripts/lib/<name>.py`` 모두 지원 — 경로에서 ``scripts/`` 디렉터리를
             찾아 dotenv·sys.path를 설정한다.

  설정 내용:
    - ``scripts/.env`` 로드 (있으면). 운영 secrets.
    - ``<project_root>/.env.local`` 로드 (있으면). 로컬 개발 secrets.
    - ``scripts/`` 디렉터리를 ``sys.path[0]``에 prepend (중복 시 skip) — ``from lib.xxx import ...`` 가 동작.

  멱등성: 동일 인자로 여러 번 호출해도 sys.path 중복 등록 없음.
  """
  # __file__은 Python 3.5+에서 절대 경로 보장 — resolve() 안 함 (Windows에서 cwd prepend 피함).
  here = Path(file_path).parent
  # scripts/ 디렉터리 찾기: 호출자가 scripts/ 직속이면 here, scripts/lib/ 같은
  # 하위면 부모를 올라간다.
  scripts_dir = here if here.name == 'scripts' else here.parent
  project_root = scripts_dir.parent

  load_dotenv(scripts_dir / '.env')
  load_dotenv(project_root / '.env.local')

  scripts_str = str(scripts_dir)
  if scripts_str not in sys.path:
    sys.path.insert(0, scripts_str)
