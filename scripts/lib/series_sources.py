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
# 가격기준 코드는 KOMIS 내부 ID라 예고 없이 바뀐다(2026-11 초 793→878, 옛 코드는 HTTP 200 빈 배열).
# 그래서 박지 않고 페이지와 같은 엔드포인트로 매 실행마다 이름(cdVal)으로 조회한다.
KOMIS_PRICE_CRTR_API: Final[str] = (
  'https://www.komis.or.kr/Komis/RsrcPrice/ajax/getMnrlPriceCrtr'
)
KOMIS_IRON_PRICE_NAME: Final[str] = 'Iron Ore Fines'
# 광종 그룹: 철광석·에너지(HP003) / 비철금속(HP001)
KOMIS_IRON_HP_GROUP: Final[str] = 'HP003'

# --- KOMIS 비철금속 — 구리(동) LME 현물 ---
KOMIS_BASE_METALS_URL: Final[str] = 'https://www.komis.or.kr/Komis/RsrcPrice/BaseMetals'
KOMIS_BASE_METALS_HP_GROUP: Final[str] = 'HP001'
KOMIS_COPPER_MNRL_CODE: Final[str] = 'MNRL0008'
KOMIS_COPPER_PRICE_NAME: Final[str] = 'LME CASH'

# --- 조달청 비축물자 「원자재 판매가격」 게시판 (영업일마다 1건, 원/톤 · 부가세 포함) ---
PPS_LIST_URL: Final[str] = 'https://www.pps.go.kr/bichuk/bbs/list.do'
PPS_VIEW_URL: Final[str] = 'https://www.pps.go.kr/bichuk/bbs/view.do'
PPS_PRICE_BOARD_KEY: Final[str] = '00825'
PPS_COPPER_ITEM: Final[str] = '구리(99.99%이상)'

# --- SHFE(상하이선물거래소) 일별 시세 JSON — 휴장일은 404 HTML ---
SHFE_DAILY_URL: Final[str] = 'https://www.shfe.com.cn/data/tradedata/future/dailydata/kx{ymd}.dat'
SHFE_HRC_PRODUCT: Final[str] = 'hc'  # 热轧卷板(열연강판), CNY/t, 중국 증치세 포함 가격
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
