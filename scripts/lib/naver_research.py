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
    r"|볼스크류|리니어\s*모터|그리퍼|로봇핸드|힘토크|협동로봇)",
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
    target_price = None
    m = re.search(r"목표(?:주)?가\s*[:\s]*([0-9,]+)", text)
    if m:
        target_price = _parse_int(m.group(1))

    opinion = None
    m = re.search(
        r"투자의견\s*[:\s]*(매수|중립|매도|BUY|HOLD|SELL|Buy|Hold|Sell|Outperform|Neutral)",
        text,
    )
    if m:
        opinion = m.group(1)

    return {
        "pdf_url": pdf_url,
        "title": title,
        "target_price": target_price,
        "opinion": opinion,
    }


def is_periodic_title(title: str) -> bool:
    """데일리·위클리 같은 정기물인가."""
    return bool(PERIODIC_RE.search(title or ""))


def has_robot_keyword(title: str) -> bool:
    """산업분석 제목이 로봇 이야기인가."""
    return bool(ROBOT_KEYWORD_RE.search(title or ""))


def is_summary_target(
    kind: str,
    is_tracked_company: bool,
    title: str,
    is_periodic: bool,
) -> bool:
    """요약할 것인가 (계획서 확정된 결정 3 — 리스트 연동 선별).

        요약한다  ← 우리 휴머노이드 리스트 종목이면 제목 무관 전부
        요약한다  ← 산업분석이면서 제목에 로봇 핵심어가 있고 정기물이 아닐 때
        그 외     ← 메타만 저장

    🔴 종목 리포트에 정기물 조건을 걸지 않는 것은 의도다. 우리가 추적하는 16사는
       리포트 자체가 드물어서, 「위클리」라는 말이 제목에 들어갔다고 버리면
       그 종목의 유일한 최신 정보를 놓친다.
    """
    if kind == KIND_COMPANY and is_tracked_company:
        return True
    if kind == KIND_INDUSTRY and has_robot_keyword(title) and not is_periodic:
        return True
    return False


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
