"""fnguide 신버전(wcomp.fnguide.com) 접근 클라이언트 + 순수 파서.

배경(2026-08-04): 구버전 `comp.fnguide.com`이 폐지되고 `wcomp.fnguide.com`으로 이전됐다.
구 도메인은 **모든 경로에서 HTTP 200과 함께** "페이지가 없습니다 / 신버전 바로가기" 안내를
반환해 상태코드 검사로는 실패를 잡을 수 없다(조용한 실패).

신버전은 재무제표를 HTML 표가 아니라 **JSON 엔드포인트**로 제공하므로 브라우저(Playwright)가
필요 없다. 또 계정마다 회사 무관 표준 `AC_CODE`가 붙어 있어, 계정명 문자열 매칭이 유발하던
오파싱(2026-07-18 감사의 '부채총계'→'부채및자본총계' 사고)을 원천 차단한다.

계약 상세·계정 코드표·헤더 열 규칙은 `docs/fnguide-wcomp-migration.md` 참고.

네트워크 함수(fetch_*)와 순수 파서(parse_*/extract_*)를 분리해 파서는 단위 테스트한다.
"""
import json
import re
from calendar import monthrange
from datetime import date
from typing import Any, Optional

import requests

BASE_URL = 'https://wcomp.fnguide.com'

# 구 도메인. 남아 있으면 조용히 실패하므로 헬스체크가 감시한다.
LEGACY_BASE_URL = 'https://comp.fnguide.com'

USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
)

DEFAULT_TIMEOUT = 30  # 초

# 재무제표 JSON 엔드포인트 (freq_typ=Y|Q, consol_typ=C|P)
FIN_ENDPOINTS = {
    'income':   'getFinIncome',
    'balance':  'getFinBalance',
    'cashflow': 'getFinCashFlow',
}

FREQ_ANNUAL = 'Y'
FREQ_QUARTER = 'Q'
CONSOL_CONSOLIDATED = 'C'   # 연결
CONSOL_SEPARATE = 'P'       # 별도(Parent)

# 값이 없는 종목/엔드포인트 오류 페이지는 본문이 매우 짧다(실측 1,628B).
# 정상 JSON 응답은 최소 수 KB이므로 넉넉히 잡는다.
_MIN_VALID_BODY = 600

_PERIOD_RE = re.compile(r'(\d{4})[/.\-](\d{1,2})')
# 최신 분기 열. 연간(Y) 응답에도 섞여 오므로 연간 적재에서는 배제해야 한다.
_LATEST_QUARTER_RE = re.compile(r'\(최근분기\)')
# 전년 동기 비교 열. 손익에만 있고 재무상태 응답에는 없어 적재하면 재무상태가 빠진
# 반쪽 행이 되고, 이미 온전히 수집된 1년 전 행을 덮어 NULL로 만든다 → 항상 배제.
_PRIOR_PERIOD_RE = re.compile(r'\(전년동기\)')

_EMPTY_VALUES = frozenset({'', '-', 'N/A', 'NA', '--', 'None', 'null'})


# ──────────────────────────────────────────────
# 순수 파서
# ──────────────────────────────────────────────

def parse_number(text: Any) -> Optional[float]:
    """fnguide 수치 문자열을 float으로 변환한다. 빈 값·대시·N/A는 None."""
    if text is None:
        return None
    s = str(text).strip().replace(',', '').replace(' ', '')
    if s in _EMPTY_VALUES:
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def parse_period(header: str) -> Optional[date]:
    """'2024/03', '2026/03 (최근분기)' 형태에서 해당 월 말일 date를 얻는다.

    기간 패턴이 없는 열(예: '전년동기대비(%)')은 None이라 자연히 배제된다.
    """
    m = _PERIOD_RE.search(str(header).strip())
    if not m:
        return None
    try:
        year, month = int(m.group(1)), int(m.group(2))
        if not (1 <= month <= 12):
            return None
        return date(year, month, monthrange(year, month)[1])
    except (ValueError, OverflowError):
        return None


def period_columns(header: list[dict], freq: str) -> list[tuple[str, date]]:
    """헤더 정의에서 (값 키 CD, 기간 말일) 목록을 만든다.

    ⚠️ `freq_typ=Y` 응답에도 '2026/03 (최근분기)' 열이 섞여 온다. 연간으로 적재하면
    안 되므로 배제한다. 결산월 비교만으로는 **3월 결산 회사에서 최근분기 열이 결산월과
    일치해 통과**하므로 라벨 기반 배제가 필수다. `freq_typ=Q`에서는 이 열이 최신 분기
    실측값이라 반드시 채택한다.

    '(전년동기)' 열은 freq와 무관하게 항상 배제한다 — 손익 응답에만 있고 재무상태
    응답에는 없어서, 적재하면 재무상태가 빠진 반쪽 행이 1년 전의 온전한 행을 덮는다.
    """
    out: list[tuple[str, date]] = []
    for col in header or []:
        cd = col.get('CD')
        yymm = str(col.get('YYMM') or '')
        if not cd:
            continue
        if _PRIOR_PERIOD_RE.search(yymm):
            continue
        if freq == FREQ_ANNUAL and _LATEST_QUARTER_RE.search(yymm):
            continue
        period_end = parse_period(yymm)
        if period_end is None:
            continue
        out.append((cd, period_end))
    return out


def extract_accounts(
    dataset: dict,
    code_map: dict[str, str],
    freq: str,
    unit: float = 1.0,
) -> dict[str, dict]:
    """재무 dataset을 {기간 ISO: {DB 컬럼: 값}} 으로 변환한다.

    계정 식별은 `AC_CODE`(회사 무관 표준 코드)로만 한다 — 계정명 문자열 매칭 금지.
    같은 기간에 같은 컬럼이 중복되면 먼저 나온 값(상위 계정)을 유지한다.
    """
    cols = period_columns(dataset.get('header') or [], freq)
    result: dict[str, dict] = {}
    for row in dataset.get('data') or []:
        db_col = code_map.get(str(row.get('AC_CODE') or '').strip())
        if not db_col:
            continue
        for cd, period_end in cols:
            val = parse_number(row.get(cd))
            if val is None:
                continue
            key = period_end.isoformat()
            bucket = result.setdefault(key, {'_period_end': period_end})
            if db_col not in bucket:
                bucket[db_col] = round(val * unit, 4)
    return result


def extract_inline_json(html: str, var_name: str) -> Optional[dict]:
    """페이지 HTML에 인라인으로 박힌 JS 객체(`<var_name>: {...}`)를 파싱한다.

    투자지표는 XHR이 아니라 페이지 스크립트 안에 실려 온다. 중첩 중괄호가 있어
    정규식으로는 끊기므로 문자열 리터럴을 존중하며 괄호 균형을 직접 센다.
    """
    idx = html.find(var_name + ':')
    if idx < 0:
        return None
    start = html.find('{', idx)
    if start < 0:
        return None
    depth = 0
    in_str = False
    escaped = False
    for pos in range(start, len(html)):
        ch = html[pos]
        if in_str:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(html[start:pos + 1])
                except json.JSONDecodeError:
                    return None
    return None


def extract_invest_map(obj: Optional[dict], name_map: dict[str, str]) -> dict[str, dict]:
    """투자지표 객체를 {기간 ISO: {DB 컬럼: 값}} 으로 변환한다.

    `NM`은 들여쓰기 공백이 붙어 오므로 strip 후 매칭한다. 배수·원 단위라 단위 배수는
    곱하지 않는다.
    """
    invest_map: dict[str, dict] = {}
    if not obj:
        return invest_map
    cols = period_columns(obj.get('header') or [], FREQ_ANNUAL)
    for row in obj.get('data') or []:
        db_col = name_map.get(str(row.get('NM') or '').strip())
        if not db_col:
            continue
        for cd, period_end in cols:
            val = parse_number(row.get(cd))
            if val is None:
                continue
            invest_map.setdefault(period_end.isoformat(), {}).setdefault(db_col, val)
    return invest_map


def has_dataset_values(dataset: Optional[dict]) -> bool:
    """dataset에 기간 열과 실제 수치가 하나라도 있는지 확인한다(헬스체크용)."""
    if not dataset:
        return False
    if not period_columns(dataset.get('header') or [], FREQ_QUARTER):
        return False
    for row in dataset.get('data') or []:
        for key, val in row.items():
            if key.startswith('VAL') and parse_number(val) is not None:
                return True
    return False


# ──────────────────────────────────────────────
# 네트워크
# ──────────────────────────────────────────────

def new_session() -> requests.Session:
    """공용 User-Agent가 설정된 세션을 만든다."""
    session = requests.Session()
    session.headers.update({'User-Agent': USER_AGENT})
    return session


def build_fin_url(statement: str, cmp_cd: str, freq: str, consol: str) -> str:
    """재무제표 JSON 엔드포인트 URL을 만든다."""
    endpoint = FIN_ENDPOINTS[statement]
    return (f'{BASE_URL}/CompanyInfo/{endpoint}'
            f'?cmp_cd={cmp_cd}&freq_typ={freq}&consol_typ={consol}')


def fetch_fin_dataset(
    cmp_cd: str,
    statement: str,
    freq: str = FREQ_ANNUAL,
    consol: str = CONSOL_CONSOLIDATED,
    session: Optional[requests.Session] = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> Optional[dict]:
    """재무제표 dataset(JSON)을 가져온다. 오류 페이지·비JSON이면 None."""
    http = session or new_session()
    resp = http.get(build_fin_url(statement, cmp_cd, freq, consol), timeout=timeout)
    if resp.status_code != 200 or len(resp.content) < _MIN_VALID_BODY:
        return None
    try:
        payload = resp.json()
    except ValueError:
        return None
    dataset = payload.get('dataset') if isinstance(payload, dict) else None
    return dataset if isinstance(dataset, dict) else None


def fetch_page_html(
    path: str,
    cmp_cd: str,
    session: Optional[requests.Session] = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> Optional[str]:
    """회사 페이지 HTML을 가져온다(`Invest`, `Snapshot` 등).

    ⚠️ 파라미터 이름을 틀리면 신버전도 기본 종목(삼성전자) 페이지를 200으로 준다.
    호출부는 `lib/fnguide_guard.is_fnguide_fallback`으로 반드시 신원을 검증할 것.
    """
    http = session or new_session()
    resp = http.get(f'{BASE_URL}/CompanyInfo/{path}?cmp_cd={cmp_cd}', timeout=timeout)
    if resp.status_code != 200 or len(resp.content) < _MIN_VALID_BODY:
        return None
    return resp.content.decode('utf-8', errors='replace')


def fetch_invest_index(
    cmp_cd: str,
    session: Optional[requests.Session] = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> Optional[dict]:
    """투자지표(invValueIndex) 객체를 가져온다.

    ⚠️ 렌더된 `<table id="tbl_value_idx">`는 requests로는 빈 골격(헤더가 더미 연도)이라
    파싱하면 안 된다. 실제 값은 인라인 스크립트에만 있다.
    """
    html = fetch_page_html('Invest', cmp_cd, session=session, timeout=timeout)
    if not html:
        return None
    return extract_inline_json(html, 'invValueIndex')
