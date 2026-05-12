"""
기타 섹션 시계열 수집 관련 상수.
실제 수집 대상은 market_series 테이블에서 yf_symbol IS NOT NULL인 행을 조회해 사용.
"""
from typing import Final

HISTORY_YEARS: Final[int] = 5
