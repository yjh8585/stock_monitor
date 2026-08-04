"""fnguide Snapshot 스크레이핑 폴백 페이지 가드(순수 함수).

배경(2026-07-17): 로그인 없는 세션으로 fnguide SVD_Main에 접근하면 요청 종목 대신
기본 페이지인 **삼성전자(A005930)** 가 반환된다. enrich_description_v2·collect_kr_snapshot이
페이지 신원 검증 없이 `ul#bizSummaryContent`를 저장해, 국내 상장사 ~170개의 회사 소개가
전부 삼성전자 설명으로 덮였다. 이 순수 함수로 폴백을 감지해 저장을 차단한다.

신버전(wcomp) 이전 후에도 유효하다(2026-08-04 실측):
`/CompanyInfo/Snapshot` 에 파라미터 이름을 틀리면(`cmp_cd` 아닌 것) 여전히 삼성전자
기본 페이지가 HTTP 200으로 돌아오고, 아래 마커 문구도 신버전에서 동일하게 확인됐다.

DOM 셀렉터에 의존하지 않는 텍스트 시그니처(포이즌필) + 회사명 헤더(#giName) 이중 신호.
"""

# fnguide 삼성전자 기본 페이지 bizSummary 고유 문구(회사 소개 텍스트에만 등장).
_SAMSUNG_FALLBACK_MARKERS = (
    'DX, DS, SDC, Harman',
    '1969년 설립된 글로벌 전자',
)


def is_fnguide_fallback(summary: str | None, ticker: str, gi_name: str = '') -> bool:
    """요청 종목이 아닌 fnguide 기본 페이지(삼성전자)가 반환됐는지 판정.

    Args:
      summary: `ul#bizSummaryContent`에서 추출한 회사 소개 텍스트.
      ticker: 요청한 종목코드(6자리 문자열, zero-fill 무관).
      gi_name: 페이지 헤더(#giName)에서 읽은 회사명(있으면 이중 검증).

    Returns:
      True면 폴백(삼성전자 기본 페이지) → 저장하면 안 된다. 실제로 삼성전자(005930)를
      요청한 경우는 False(정상).
    """
    if (ticker or '').strip().zfill(6) == '005930':
        return False  # 삼성전자 자체를 요청 — 정상
    if gi_name and gi_name.replace(' ', '').strip() == '삼성전자':
        return True
    s = summary or ''
    return any(m in s for m in _SAMSUNG_FALLBACK_MARKERS)
