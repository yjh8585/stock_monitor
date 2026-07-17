"""fnguide 폴백(삼성전자 기본 페이지) 감지 가드 회귀 검증.

배경(2026-07-17): 로그인 없는 세션에서 fnguide가 요청 종목 대신 삼성전자(A005930)를
반환해 국내 상장사 ~170개 소개가 전부 삼성전자 설명으로 덮였다. is_fnguide_fallback이
이를 감지해 저장을 막는다. 가드가 깨지면 재오염된다.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_fnguide_guard.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.fnguide_guard import is_fnguide_fallback  # noqa: E402

SAMSUNG = (
    '동사는 1969년 설립된 글로벌 전자 기업으로, DX, DS, SDC, Harman 산하 '
    '308개 종속기업으로 구성됨. DX 부문은 TV, 가전, 스마트폰...'
)
REAL = '동사는 자동차용 제어케이블과 전동식 파킹브레이크 액추에이터를 제조하는 부품사임.'


class TestFnguideFallback(unittest.TestCase):
    def test_samsung_text_on_other_ticker_is_fallback(self):
        # 인팩(023810)을 요청했는데 삼성 텍스트가 오면 폴백
        self.assertTrue(is_fnguide_fallback(SAMSUNG, '023810'))
        self.assertTrue(is_fnguide_fallback(SAMSUNG, '023810', gi_name='삼성전자'))

    def test_giname_signal(self):
        # 소개 텍스트가 비어도 헤더가 삼성전자면 폴백
        self.assertTrue(is_fnguide_fallback('', '000240', gi_name='삼성전자'))
        self.assertTrue(is_fnguide_fallback(REAL, '000240', gi_name='삼성 전자'))

    def test_real_company_text_is_ok(self):
        self.assertFalse(is_fnguide_fallback(REAL, '023810'))
        self.assertFalse(is_fnguide_fallback(REAL, '023810', gi_name='인팩'))

    def test_actual_samsung_request_is_ok(self):
        # 실제로 삼성전자(005930)를 요청하면 폴백 아님(정상)
        self.assertFalse(is_fnguide_fallback(SAMSUNG, '005930'))
        self.assertFalse(is_fnguide_fallback(SAMSUNG, '5930', gi_name='삼성전자'))  # zero-fill

    def test_none_summary_safe(self):
        self.assertFalse(is_fnguide_fallback(None, '023810'))


if __name__ == '__main__':
    unittest.main()
