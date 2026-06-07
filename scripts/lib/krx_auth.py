"""pykrx import-time 자동 로그인의 크래시를 막고 best-effort KRX 로그인을 제공한다.

pykrx는 import 시점(webio.py)에 KRX_ID/KRX_PW가 환경에 있으면 KRX에 자동 로그인한다.
그런데 KRX가 GitHub Actions 데이터센터 IP에 간헐적으로 빈 응답을 주면 pykrx login_krx의
resp.json()이 예외 처리 없이 JSONDecodeError를 던져 import 전체가 죽고, 같은 스크립트의
다른 수집(yfinance/FRED 등)까지 함께 중단된다.

사용법 — pykrx import **전에** 자동 로그인을 끄고, 수집 직전 직접 로그인한다:

    from lib.krx_auth import disable_pykrx_autologin, ensure_krx_login

    disable_pykrx_autologin()          # KRX_ID/KRX_PW를 환경에서 빼 자동 로그인 비활성화
    from pykrx import stock            # 이제 크래시 없이 import
    ...
    if ensure_krx_login():
        ...  # KRX 수집
"""
import os
import time

from loguru import logger

_krx_id: str | None = None
_krx_pw: str | None = None


def disable_pykrx_autologin() -> None:
  """pykrx import **전에** 호출. KRX_ID/KRX_PW를 환경에서 빼 import-time 자동 로그인을
  막고, 자격증명은 모듈에 보관해 ensure_krx_login에서 사용한다. .env 자격증명까지
  캡처하려면 load_dotenv 이후에 호출한다."""
  global _krx_id, _krx_pw
  _krx_id = os.environ.pop('KRX_ID', None)
  _krx_pw = os.environ.pop('KRX_PW', None)


def ensure_krx_login(attempts: int = 3, delay: int = 3) -> bool:
  """KRX 로그인을 직접 수행해 pykrx 세션에 주입한다(best-effort). 실패해도 예외를 전파하지 않는다.

  pykrx의 import-time 자동 로그인은 KRX 빈 응답 시 예외가 import를 통째로 중단시키므로
  disable_pykrx_autologin()으로 비활성화한 뒤, 여기서 재시도·예외 처리로 감싸 로그인한다.
  성공 시 True(세션 주입 완료), 실패 시 False(호출부가 KRX 수집을 건너뛰도록).
  """
  krx_id = _krx_id or os.getenv('KRX_ID')
  krx_pw = _krx_pw or os.getenv('KRX_PW')
  if not (krx_id and krx_pw):
    logger.warning("KRX_ID/KRX_PW 미설정 — KRX 수집을 건너뜁니다.")
    return False

  from pykrx.website.comm import auth

  for attempt in range(1, attempts + 1):
    try:
      session = auth.build_krx_session(krx_id, krx_pw)
    except Exception as e:
      logger.warning(f"KRX 로그인 시도 {attempt}/{attempts} 예외 — {e}")
      session = None
    if session is not None:
      auth.set_auth_session(session)
      return True
    if attempt < attempts:
      time.sleep(delay)

  logger.warning("KRX 로그인 실패 — KRX 수집을 건너뜁니다.")
  return False
