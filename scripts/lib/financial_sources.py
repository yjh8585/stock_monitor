"""`financials.source` 출처 식별자 (수집기 공용 상수).

배경(2026-08-04): `collect_uzauto_financials.py`를 뺀 **모든** 재무 수집기가 `source`를
넣지 않고 있었다. DB에 남아 있던 `fnguide`/`dart`/`yfinance` 값은 과거 코드의 유산이라,
어느 시점부터 새로 적재되는 행은 전부 `source = NULL`이었다. 한 회사에 여러 출처가
공존하는 구조(같은 회사에 dart 행과 fnguide 행이 함께 있다)라서, 출처가 비면 값이
어긋났을 때 **어느 수집기를 고쳐야 하는지 사후에 특정할 수 없다.**

문자열을 각 스크립트에 직접 박으면 오타 하나로 출처가 분열되므로(`fnguide` vs `fnGuide`)
여기 한 곳에서만 정의한다. 새 출처를 추가하면 이 목록에 넣고 `KNOWN_SOURCES`도 갱신할 것.
"""

# 국내 상장사 재무제표 — fnguide 신버전(wcomp) JSON. `collect_financials.py`
SOURCE_FNGUIDE = 'fnguide'

# 해외 상장사 재무제표 — yfinance. `collect_financials.py`, `collect_global_snapshot.py`
SOURCE_YFINANCE = 'yfinance'

# DART 공시(사업보고서·감사보고서). `collect_dart_audit.py`·`collect_dart_domestic.py`·
# `collect_dart_private.py`
SOURCE_DART = 'dart'

# MarkLines 부품사 매출. `collect_marklines*.py`
SOURCE_MARKLINES = 'marklines'

# LLM 웹 검색 폴백(공식 소스가 없는 비상장·해외 소형사). `collect_top100_*.py`
SOURCE_WEB_SEARCH = 'web_search'

# pykrx 시세 + DART 재무 조합(레거시 — 현재 신규 적재 없음)
SOURCE_PYKRX_DART = 'pykrx+dart'


def uzauto_pdf_source(pdf_url: str) -> str:
    """UzAuto는 PDF 원문 URL까지 출처에 담는다(재진술 추적용)."""
    return f'uzauto-pdf:{pdf_url}'


# 사후 검증·집계에서 쓰는 화이트리스트(uzauto-pdf는 URL이 붙어 접두어로 판정).
KNOWN_SOURCES = frozenset({
    SOURCE_FNGUIDE,
    SOURCE_YFINANCE,
    SOURCE_DART,
    SOURCE_MARKLINES,
    SOURCE_WEB_SEARCH,
    SOURCE_PYKRX_DART,
})

UZAUTO_SOURCE_PREFIX = 'uzauto-pdf:'
