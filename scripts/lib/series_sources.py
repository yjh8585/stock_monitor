"""
원자재/운임 보조 시계열(STEEL_KR/DUBAI/SCFI 백필) 수집 대상 URL·셀렉터 상수.
"""
from typing import Final

# --- KOMIS (한국자원정보서비스) 철광석 ---
# 메인 페이지(GET으로 세션 쿠키 확보 후 ajax POST 사용)
KOMIS_PAGE_URL: Final[str] = 'https://www.komis.or.kr/Komis/RsrcPrice/IronOre'
KOMIS_CHART_API: Final[str] = (
  'https://www.komis.or.kr/Komis/RsrcPrice/ajax/getChartData'
)
# 광종 코드: 철(=Iron Ore Fines, 62%, Australian CNF China)
KOMIS_IRON_MNRL_CODE: Final[str] = 'MNRL1011'
# 가격기준 코드 (KOMIS가 내부적으로 사용하는 ID, 2026-05 기준 확인값)
KOMIS_IRON_PRICE_CODE: Final[str] = '793'
# 메타 갱신용 라벨/단위 (KOMIS Iron Ore Fines는 USD/MT)
STEEL_KR_LABEL: Final[str] = '철광석 (Iron Ore Fines 62%, CFR China)'
STEEL_KR_UNIT: Final[str] = 'USD/MT'
STEEL_KR_SOURCE: Final[str] = 'KOMIS'

# --- FRED Dubai Crude (월별, USD/bbl, IMF 발표) ---
FRED_CSV_URL: Final[str] = 'https://fred.stlouisfed.org/graph/fredgraph.csv'
DUBAI_FRED_SYMBOL: Final[str] = 'POILDUBUSDM'
DUBAI_LABEL: Final[str] = '원유 Dubai (월별)'
DUBAI_UNIT: Final[str] = 'USD/bbl'
DUBAI_SOURCE: Final[str] = 'FRED (IMF POILDUBUSDM)'

# 공통 UA / 요청 간 대기
USER_AGENT: Final[str] = (
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
)
REQUEST_SLEEP_SEC: Final[float] = 1.5

# 백필 연수
BACKFILL_YEARS: Final[int] = 5
