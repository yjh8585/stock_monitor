"""
운임 지수(KCCI/KUWI) 수집 대상 URL·셀렉터 상수.
"""
from typing import Final

# Korea Ocean Business Corporation (KOMSA) — KCCI Timeseries
# 매주 월요일 발표. POST로 (sDay, eDay) 보내면 HTML 그리드 반환.
KCCI_REFERER: Final[str] = (
  'https://www.kobc.or.kr/ebz/shippinginfo/timeseries/gridList.do?mId=0304000000'
)
KCCI_POST_URL: Final[str] = (
  'https://www.kobc.or.kr/ebz/shippinginfo/timeseries/gridList.do?mId=0304000000'
)

# KCCI Timeseries 그리드 컬럼명 → 적재 series_code 매핑
# (KCCI 종합 = KCCI, USWC 항로 = KUWI)
KCCI_COLUMN_MAP: Final[dict[str, str]] = {
  'KCCI': 'KCCI',
  'KUWI': 'KUWI',
}

USER_AGENT: Final[str] = (
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
)

# 보수적 rate-limit (요청 사이 대기 초)
REQUEST_SLEEP_SEC: Final[float] = 1.5

# 메타 source 갱신값
KCCI_SOURCE: Final[str] = 'KOMSA'
