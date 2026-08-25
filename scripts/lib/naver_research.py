"""네이버 증권 리서치(산업분석·종목분석) 파싱 — 순수 함수만.

네트워크를 타지 않는다. HTTP 는 collect_naver_research.py 가 담당하고 여기는
"받은 HTML 을 어떻게 읽나"만 갖는다. 그래야 테스트가 실물 없이 돈다.

🔴 실물에서 확인한 것 (2026-08-24, 계획서 스케치와 다른 부분):
  - 목록 행의 `<td>` 는 **6칸**이다: [분류/종목, 제목, 증권사, PDF첨부, 날짜, 조회수].
    계획서는 5칸이라 적었는데, 5칸으로 짜면 에러 없이 **조용히 0건**이 된다.
  - `keyword` 는 **EUC-KR 퍼센트 인코딩**이어야 한다. UTF-8 로 보내면 역시 0건.
  - 종목분석은 첫 칸 링크에 종목코드가 있다(`/item/main.naver?code=108490`).
    산업분석은 분류명뿐이라 링크가 없다.
  - 총 페이지 수는 `table.Nnavi` 의 「맨뒤」 링크 `page=N` 에 있다.
"""
from __future__ import annotations

import re
import urllib.parse
from datetime import date, timedelta
from typing import Any

from bs4 import BeautifulSoup

BASE_URL = "https://finance.naver.com/research"

KIND_INDUSTRY = "industry"
KIND_COMPANY = "company"
KINDS = (KIND_INDUSTRY, KIND_COMPANY)

# 목록 표 한 페이지에 담기는 행 수(실측 30). 페이지 수 추정에만 쓴다.
ROWS_PER_PAGE = 30

# 델타 요약을 묶을 때 "직전 리포트"로 인정하는 최대 간격.
# 반년 전 리포트를 기준으로 "변화만" 쓰면 맥락이 끊기므로 자른다.
DELTA_MAX_GAP_DAYS = 60

# 정기물(데일리·위클리 등) — 계획서에 실측 검증된 정규식이 있어 그대로 쓴다.
# 이런 글은 특정 종목 분석이 아니라 시황 나열이라 요약 대상에서 뺀다.
PERIODIC_RE = re.compile(
    r"(데일리|위클리|먼슬리|Weekly|Daily|Monthly|주간|월간|모닝|Morning"
    r"|이슈\s*코멘트|스몰캡\s*브리프|캘린더)",
    re.IGNORECASE,
)

# 산업분석 중 "로봇 이야기인가"를 제목만으로 가리는 핵심어.
# 🔴 넓히면 반도체·2차전지 리포트가 통째로 딸려 오고, 좁히면 부품 리포트를 놓친다.
#    지금 목록은 완성품(로봇·휴머노이드)과 우리가 추적하는 부품군 이름만 담는다.
ROBOT_KEYWORD_RE = re.compile(
    r"(로봇|로보|휴머노이드|robot|humanoid"
    r"|액추에이터|액츄에이터|감속기|하모닉|사이클로이드"
    r"|볼스크류|리니어\s*모터|그리퍼|로봇핸드|힘토크|협동로봇"
    # 「피지컬 AI」는 이 판의 로봇 리포트가 로봇이라는 말 없이 쓰는 대표 용어다.
    # 2026-08-25 실측에서 이 한 낱말이 9건을 갈랐다.
    r"|피지컬\s*AI|physical\s*ai)",
    re.IGNORECASE,
)

_NID_RE = re.compile(r"nid=(\d+)")
_CODE_RE = re.compile(r"code=([0-9A-Za-z]+)")
_PAGE_RE = re.compile(r"page=(\d+)")


def encode_keyword(keyword: str) -> str:
    """검색어를 네이버가 받는 형태로 바꾼다.

    🔴 EUC-KR 로 인코딩해야 한다. 이 사이트는 UTF-8 키워드를 받으면 에러를 내지 않고
       **빈 결과**를 돌려주므로, 틀렸을 때 "검색 결과가 없나 보다"로 오해하게 된다.
    """
    return urllib.parse.quote(keyword.encode("euc-kr"))


def list_url(kind: str, keyword: str, page: int = 1) -> str:
    """목록 페이지 주소."""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}: {kind!r}")
    return (
        f"{BASE_URL}/{kind}_list.naver"
        f"?keyword={encode_keyword(keyword)}&searchType=keyword&page={page}"
    )


def read_url(kind: str, nid: int) -> str:
    """리포트 본문 페이지 주소."""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}: {kind!r}")
    return f"{BASE_URL}/{kind}_read.naver?nid={nid}"


def _parse_ymd(text: str) -> date | None:
    """'26.08.24' → date(2026, 8, 24). 형식이 다르면 None."""
    m = re.match(r"^\s*(\d{2})\.(\d{2})\.(\d{2})\s*$", text)
    if not m:
        return None
    yy, mm, dd = (int(g) for g in m.groups())
    try:
        return date(2000 + yy, mm, dd)
    except ValueError:
        return None


def _parse_int(text: str) -> int | None:
    """'2,364' → 2364. 숫자가 아니면 None."""
    cleaned = re.sub(r"[^\d]", "", text or "")
    return int(cleaned) if cleaned else None


def parse_list_page(html: str, kind: str) -> list[dict[str, Any]]:
    """목록 페이지 HTML → 행 목록.

    🔴 `table.type_1` 안만 본다. 페이지에는 「인기검색어」 표(`type_r1`)도 있어서
       문서 전체에서 `<tr>` 을 훑으면 그 행이 섞인다(td 4칸이라 지금은 걸러지지만,
       네이버가 칸 수를 바꾸면 조용히 섞여 들어온다).
    """
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", class_="type_1")
    if table is None:
        return []

    rows: list[dict[str, Any]] = []
    for tr in table.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) != 6:
            continue

        title_a = tds[1].find("a")
        if title_a is None:
            continue
        href = title_a.get("href") or ""
        m = _NID_RE.search(href)
        if not m:
            continue
        nid = int(m.group(1))

        # 종목분석은 첫 칸에 종목 링크가 있다(산업분석은 분류명뿐).
        ticker = None
        target_a = tds[0].find("a")
        if target_a is not None:
            code_m = _CODE_RE.search(target_a.get("href") or "")
            if code_m:
                ticker = code_m.group(1)

        pdf_a = tds[3].find("a")
        pdf_url = pdf_a.get("href") if pdf_a is not None else None

        title = title_a.get_text(strip=True)
        rows.append(
            {
                "kind": kind,
                "naver_nid": nid,
                "target_name": tds[0].get_text(strip=True),
                "ticker": ticker,
                "title": title,
                "broker": tds[2].get_text(strip=True) or None,
                "pdf_url": pdf_url,
                "published_at": _parse_ymd(tds[4].get_text(strip=True)),
                "view_count": _parse_int(tds[5].get_text(strip=True)),
                "is_periodic": is_periodic_title(title),
            }
        )
    return rows


def parse_total_pages(html: str) -> int:
    """총 페이지 수. 못 찾으면 1.

    「맨뒤」 링크의 `page=N` 이 정답이다. 마지막 묶음에서는 「맨뒤」가 사라지므로
    그때는 보이는 숫자 링크 중 최대값을 쓴다.
    """
    soup = BeautifulSoup(html, "html.parser")
    nav = soup.find("table", class_="Nnavi")
    if nav is None:
        return 1

    best = 1
    for a in nav.find_all("a"):
        m = _PAGE_RE.search(a.get("href") or "")
        if m:
            best = max(best, int(m.group(1)))
    return best


def parse_detail_page(
    html: str,
    broker: str | None = None,
    target_name: str | None = None,
) -> dict[str, Any]:
    """리포트 본문 페이지에서 온전한 제목·PDF 주소와 (있으면) 목표주가·투자의견을 뽑는다.

    목표주가·투자의견은 증권사마다 표기가 제각각이라 **있을 때만** 채운다.
    없다고 실패로 보지 않는다.

    🔴 제목 추출이 이 함수의 핵심이자 함정이다(2026-08-24 실측으로 한 번 사고).
       `.view_sbj` 한 덩어리에 **분류/종목명 + 제목 + 증권사 | 날짜 | 조회수**가 모두 들어 있다:

         `<em>기타</em> 안녕하세요 위클리에요(로봇/방산) 유진투자증권 | 2026.08.24 | 조회 871`

       여기서 앞뒤 장식을 걷어내지 않으면 제목이 **분류명("기타"·"조선")으로 덮인다.**
       그렇게 되면 목록의 진짜 제목까지 지워지는데, 잘림(`...`) 검사에는 걸리지 않아
       **아무도 눈치채지 못한다.** 실제로 407건이 통째로 그렇게 오염됐었다.
    """
    soup = BeautifulSoup(html, "html.parser")

    pdf_url = None
    for a in soup.find_all("a"):
        href = a.get("href") or ""
        if href.lower().endswith(".pdf"):
            pdf_url = href
            break

    # 목록 제목은 길면 잘려 오므로(`…`) 본문 제목을 함께 돌려준다.
    title = None
    node = soup.find(class_="view_sbj")
    if node is not None:
        # ① 분류/종목명은 <em> 안에 있다 — 제목이 아니므로 통째로 들어낸다.
        for em in node.find_all("em"):
            em.decompose()
        text = node.get_text(" ", strip=True)

        # ② 꼬리의 `| 2026.08.24 | 조회 871` 를 자른다.
        text = re.sub(r"\s*\|\s*\d{4}\.\d{2}\.\d{2}\s*\|\s*조회\s*[\d,]+\s*$", "", text)

        # ③ 그러고 남은 꼬리의 증권사명을 자른다. 목록에서 받아 둔 이름이 가장 정확하고,
        #    없으면 '…증권/…운용' 형태를 자른다(폴백).
        if broker and text.endswith(broker):
            text = text[: -len(broker)]
        else:
            text = re.sub(r"\s+\S*(증권|자산운용|투자자문|리서치)\s*$", "", text)

        # ④ <em> 이 없는 판본 대비 — 머리에 분류/종목명이 그대로 붙어 있으면 떼어낸다.
        text = text.strip()
        if target_name and text.startswith(target_name):
            text = text[len(target_name) :].strip()

        title = text or None

    text = soup.get_text(" ", strip=True)

    # 🔴 「목표주가」만 찾으면 놓친다 — 네이버 상세 페이지의 요약 줄은 **「목표가」**로 적는다
    #    (예: `목표가 790,000 | 투자의견 매수`). 2026-08-24 실측에서 종목분석 194건 중
    #    목표주가가 채워진 것이 65건(33.5%)뿐이었던 원인이 이것이다.
    target_price = parse_target_price(text)

    opinion = None
    m = re.search(
        r"투자의견\s*[:\s]*(매수|중립|매도|BUY|HOLD|SELL|Buy|Hold|Sell|Outperform|Neutral)",
        text,
    )
    if m:
        opinion = normalize_opinion(m.group(1))

    return {
        "pdf_url": pdf_url,
        "title": title,
        "target_price": target_price,
        "opinion": opinion,
        "body_len": body_text_length(html),
    }


# 요약 재료로 인정하는 상세 페이지 본문 최소 길이.
# 🔴 `summarize_naver_research.MIN_PDF_TEXT` 와 **같은 값이어야 한다** — 수집이 저장한 것을
#    요약이 못 다루면 화면에 "정리 안 된 카드"가 남는다. 그 어긋남이 실제로 났다(아래).
MIN_BODY_TEXT = 300


def body_text_length(html: str) -> int:
    """상세 페이지의 **리포트 본문** 길이. 네비게이션·목록은 세지 않는다.

    🔴 왜 필요한가 (2026-08-25 실측):
       신한투자증권은 네이버에 PDF 를 올리지 않고 **자사 사이트 팝업**으로 보낸다
       (`shinhansec.com/.../view-popup.do` — 리포트 식별자가 없어 원문을 특정할 수 없다).
       네이버가 주는 것은 `.view_cnt` 안의 **131자 요지 한 줄**이 전부라 요약이 성립하지
       않는다. 16건 중 12건이 이 상태로 "정리 안 된 카드"로 남아 있었다.

       ⚠️ 그렇다고 「PDF 없으면 버린다」로 자르면 안 된다 — 같은 증권사의 **산업분석 3건**은
          상세 본문이 충실해 864~1,177자로 제대로 정리됐다. 기준은 PDF 유무가 아니라
          **요약할 재료가 있느냐**다.
    """
    soup = BeautifulSoup(html, "html.parser")
    node = soup.find(class_="view_cnt")
    if node is None:
        return 0
    return len(node.get_text(" ", strip=True))


# 목표주가 문구. 「목표주가」/「목표가」 뒤에 소수점과 만/억 단위가 붙을 수 있다.
_TARGET_PRICE_RE = re.compile(r"목표(?:주)?가\s*[:\s]*([0-9][0-9,]*(?:\.\d+)?)\s*(만|억)?\s*원?")

_PRICE_UNIT_MULTIPLIER = {None: 1, "": 1, "만": 10_000, "억": 100_000_000}


def parse_target_price(text: str) -> int | None:
    """본문에서 목표주가를 원 단위 정수로 뽑는다. 없으면 None.

    🔴 단위를 안 보면 조용히 1/10000 이 된다. 실측(2026-08-25): 「목표주가 35.6만원」이
       `35` 로 저장돼 있었다 — 옛 정규식이 `[0-9,]+` 만 잡아 소수점 앞에서 끊기고
       「만원」을 버렸기 때문이다. 65건 중 26건이 이렇게 망가져 있었다.

    소수점도 반드시 받아야 한다. 「35.6만원」에서 `.6` 을 버리면 35만원이 되어
    6천원이 사라진다.
    """
    m = _TARGET_PRICE_RE.search(text or "")
    if not m:
        return None
    try:
        amount = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    value = round(amount * _PRICE_UNIT_MULTIPLIER[m.group(2)])
    return value if value > 0 else None


def is_periodic_title(title: str) -> bool:
    """데일리·위클리 같은 정기물인가."""
    return bool(PERIODIC_RE.search(title or ""))


def has_robot_keyword(title: str) -> bool:
    """산업분석 제목이 로봇 이야기인가."""
    return bool(ROBOT_KEYWORD_RE.search(title or ""))


def is_relevant(
    kind: str,
    is_tracked_company: bool,
    title: str,
    is_periodic: bool,
) -> bool:
    """이 리포트를 **저장하고 정리할 것인가** (사용자 지시·승인 2026-08-25).

        버린다   ← 정기물(데일리·위클리·모닝 등)이면 무조건
        남긴다   ← 종목분석이면서 (우리 추적 종목 OR 제목에 로봇 핵심어)
        남긴다   ← 산업분석이면서 제목에 로봇 핵심어
        그 외    ← 버린다

    🔴 판정이 두 번 바뀌었다. 되돌리지 않도록 경위를 남긴다.

    ① 처음(2026-08-24)엔 종목분석을 **추적 종목만** 통과시켰다. 그런데 2026-08-25 실측에서
       그 규칙이 클로봇·씨메스·큐렉소·피앤에스로보틱스·나우로보틱스·한국피아이엠 같은
       **명백한 로봇 기업 리포트를 통째로 떨어뜨리고** 있었다. 추적 67사 밖이라는 이유
       하나였고 제목에는 로봇·액추에이터·감속기가 들어 있었다. 그래서 제목 핵심어를 OR 로 더했다.

    ② 처음엔 종목분석에 정기물 조건을 **일부러 걸지 않았다**("추적사는 리포트가 드무니
       위클리라도 건지자"). 사용자가 "위클리 등 관련성 떨어지는 거 제거하고 필요한 것만"
       이라고 명시해 뒤집었다(2026-08-25). 정기물은 시황 나열이라 종목 분석이 아니다.

    🔴 이 판정은 **수집 단계의 저장 여부**로도 쓴다. 화면에서만 걸러 두면 지운 행이
       다음 수집 때 그대로 되살아난다.
    """
    if is_periodic:
        return False
    if kind == KIND_COMPANY:
        return is_tracked_company or has_robot_keyword(title)
    if kind == KIND_INDUSTRY:
        return has_robot_keyword(title)
    return False


# 요약 대상 = 저장 대상. 남긴 것은 전부 정리해 둔다 — "PDF 링크만 있는 행"을 만들지
# 않는 것이 2026-08-25 변경의 목적이다.
is_summary_target = is_relevant


# 투자의견 표기는 증권사마다 제각각이다(실측 2026-08-25: Buy · BUY · Hold · 매수 공존).
# 화면에서 같은 뜻이 다른 배지로 갈리지 않도록 한국어 3종으로 접는다.
_OPINION_MAP = {
    "buy": "매수",
    "매수": "매수",
    "outperform": "매수",
    "strongbuy": "매수",
    "hold": "중립",
    "중립": "중립",
    "neutral": "중립",
    "marketperform": "중립",
    "sell": "매도",
    "매도": "매도",
    "underperform": "매도",
}


def normalize_opinion(raw: str | None) -> str | None:
    """투자의견 표기를 매수/중립/매도로 접는다. 모르는 표기는 원문 그대로 둔다."""
    if not raw:
        return None
    key = re.sub(r"[\s_-]+", "", raw).lower()
    return _OPINION_MAP.get(key, raw.strip())


def delta_group_key(row: dict[str, Any]) -> tuple[str, str]:
    """델타 요약을 묶는 단위 = (증권사, 대상).

    같은 증권사가 같은 종목을 이어서 다루는 흐름이라야 "직전 대비 무엇이 바뀌었나"가
    성립한다. 증권사가 다르면 논조 자체가 달라 비교가 의미 없다.
    """
    return (row.get("broker") or "", row.get("target_name") or "")


def pick_delta_base(
    candidates: list[dict[str, Any]],
    row: dict[str, Any],
    max_gap_days: int = DELTA_MAX_GAP_DAYS,
) -> dict[str, Any] | None:
    """같은 묶음에서 이 리포트의 '직전 리포트'를 고른다. 없으면 None(=전체 요약).

    조건: 같은 (증권사, 대상) · 발행일이 더 이르고 · 간격이 max_gap_days 이내 ·
          그중 가장 가까운 것.
    """
    published = row.get("published_at")
    if published is None:
        return None
    key = delta_group_key(row)
    limit = published - timedelta(days=max_gap_days)

    best: dict[str, Any] | None = None
    for c in candidates:
        if c is row:
            continue
        if delta_group_key(c) != key:
            continue
        cp = c.get("published_at")
        if cp is None or cp >= published or cp < limit:
            continue
        if best is None or cp > best["published_at"]:
            best = c
    return best
