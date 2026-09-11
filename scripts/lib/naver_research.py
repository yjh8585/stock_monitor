"""네이버 증권 리서치(산업분석·종목분석) 파싱 — 순수 함수만.

네트워크를 타지 않는다. HTTP 는 부르는 쪽이 담당하고 여기는 "받은 JSON 을 어떻게
읽나"만 갖는다. 그래야 테스트가 실물 없이 돈다.

🔴 **2026-09-12 전면 교체 — 네이버 금융이 Next.js 로 개편됐다.**
   옛 `finance.naver.com/research/*_list.naver` 는 HTTP 200 에 118KB 를 돌려주지만
   `<table class="type_1">` 도 `nid=` 도 **0회**다. 목록이 HTML 에 없고 클라이언트가
   따로 받아 간다. 그래서 HTML 파싱을 **모바일 JSON API 로 갈아탔다**:

     목록  GET m.stock.naver.com/api/research/{industry|company}?page=1&pageSize=100
     상세  GET m.stock.naver.com/api/research/{industry|company}/{researchId}

   이 개편은 **리서치·종목토론만** 덮쳤다. 종목 뉴스(`m.stock.naver.com/api/news/...`)와
   일별 시세(`item/sise_day.naver`)는 옛 모습 그대로다.

🔴 **키워드 검색이 사라졌다.** 옛 목록은 `keyword=로봇` 으로 좁혀 받았는데, 새 API 는
   어떤 파라미터 이름을 줘도(`keyword`·`query`·`q`·`searchKeyword`) **무시하고 전체
   최신 목록**을 준다. 그래서 전체를 받아 `is_relevant()` 로 거른다.
   ⚠️ 손해가 없음을 실측으로 확인했다 — 정리본 76건 기준 제목 핵심어로 72건(94%)이
   걸리고, 나머지 4건은 전부 종목분석이라 **`itemCode` 가 추적 종목**이라 잡힌다(100%).

실물에서 확인한 응답 모양:
  - 목록 = JSON 배열. 필드 `researchId`·`title`·`brokerName`·`writeDate`·`category`
    (+ 종목분석만 `itemCode`·`itemName`). **PDF 주소는 목록에 없다** — 상세에 있다.
  - 상세 = `{"researchContent": {...}, "researchSummaries": [...]}`.
    `researchContent.attachUrl` 이 PDF, `researchContent.content` 가 본문 HTML.
    `researchSummaries` 는 「같은 종목의 다른 리포트」 목록이라 우리는 안 쓴다.
  - 제목은 목록에서도 **안 잘린다**(옛 HTML 목록은 길면 `...` 로 잘렸다).
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta
from typing import Any

from bs4 import BeautifulSoup

API_BASE = "https://m.stock.naver.com/api/research"

# 네이버가 봇 취급하지 않도록. Referer 가 없으면 빈 배열을 주는 판본이 있다.
API_HEADERS = {
    "User-Agent": "Mozilla/5.0 (stock_monitor research collector)",
    "Referer": "https://m.stock.naver.com/",
}

KIND_INDUSTRY = "industry"
KIND_COMPANY = "company"
KINDS = (KIND_INDUSTRY, KIND_COMPANY)

# 한 번에 받아 올 행 수. 실측에서 200 까지 그대로 돌려준다.
# 🔴 키워드로 못 좁히니 전체를 훑어야 한다 — 작게 잡으면 요청 수만 늘어난다.
PAGE_SIZE = 100

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


def list_url(kind: str, page: int = 1, page_size: int = PAGE_SIZE) -> str:
    """목록 API 주소.

    🔴 키워드 인자가 없다 — 새 API 는 검색을 받지 않는다(위 모듈 설명 참조).
       옛 시그니처는 `list_url(kind, keyword, page)` 였다. 부르는 쪽을 함께 고칠 것.
    """
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}: {kind!r}")
    return f"{API_BASE}/{kind}?page={page}&pageSize={page_size}"


def read_url(kind: str, nid: int) -> str:
    """리포트 상세 API 주소."""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}: {kind!r}")
    return f"{API_BASE}/{kind}/{nid}"


def _parse_ymd(text: str) -> date | None:
    """'2026-09-11' → date(2026, 9, 11). 형식이 다르면 None.

    🔴 옛 HTML 목록은 `26.08.24`(두 자리 연도) 였고 새 API 는 `2026-09-11` 이다.
       둘 다 받는다 — 되돌아갈 일은 없지만, 판본이 섞여 오면 조용히 None 이 되어
       「전부 옛 글」로 보이고 만회가 통째로 헛돈다.
    """
    text = (text or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", text)
    if m:
        y, mm, dd = (int(g) for g in m.groups())
    else:
        m = re.match(r"^(\d{2})\.(\d{2})\.(\d{2})$", text)
        if not m:
            return None
        yy, mm, dd = (int(g) for g in m.groups())
        y = 2000 + yy
    try:
        return date(y, mm, dd)
    except ValueError:
        return None


def _parse_int(text: str) -> int | None:
    """'2,364' → 2364. 숫자가 아니면 None."""
    cleaned = re.sub(r"[^\d]", "", text or "")
    return int(cleaned) if cleaned else None


def parse_list_payload(payload: Any, kind: str) -> list[dict[str, Any]]:
    """목록 API 응답(JSON 배열 또는 그 문자열) → 행 목록.

    돌려주는 모양은 옛 HTML 파서와 **같다** — 부르는 쪽을 다시 안 고치려고 맞췄다.
    단 `pdf_url` 은 여기서 항상 None 이다. 새 목록 API 에 PDF 주소가 없고
    상세(`attachUrl`)에만 있다.

    🔴 응답이 배열이 아니면 **빈 목록**을 준다(에러를 던지지 않는다). 부르는 쪽이
       「파싱 0건 = 구조 변경」으로 판정해 exit 3 을 내는 구조라 그쪽에 맡긴다.
    """
    items = _as_items(payload)
    rows: list[dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        nid = it.get("researchId")
        title = (it.get("title") or "").strip()
        if nid is None or not title:
            continue
        # 종목분석은 종목코드·종목명이, 산업분석은 분류명(`category`)이 온다.
        ticker = (it.get("itemCode") or "").strip() or None
        target_name = (it.get("itemName") or it.get("category") or "").strip()
        rows.append(
            {
                "kind": kind,
                "naver_nid": int(nid),
                "target_name": target_name,
                "ticker": ticker,
                "title": title,
                "broker": (it.get("brokerName") or "").strip() or None,
                "pdf_url": None,  # 상세의 attachUrl 에서 채운다
                "published_at": _parse_ymd(it.get("writeDate") or ""),
                "view_count": _parse_int(it.get("readCount") or ""),
                "is_periodic": is_periodic_title(title),
            }
        )
    return rows


def _as_items(payload: Any) -> list[Any]:
    """문자열이면 JSON 으로 풀고, 배열이 아니면 빈 목록."""
    if isinstance(payload, (str, bytes)):
        try:
            payload = json.loads(payload)
        except (ValueError, TypeError):
            return []
    if isinstance(payload, dict):
        # 판본에 따라 배열을 한 겹 감싸는 경우를 대비한다.
        for key in ("researchList", "list", "items", "result"):
            if isinstance(payload.get(key), list):
                return payload[key]
        return []
    return payload if isinstance(payload, list) else []


def parse_detail_payload(
    payload: Any,
    broker: str | None = None,
    target_name: str | None = None,
) -> dict[str, Any]:
    """상세 API 응답 → 온전한 제목·PDF 주소·(있으면) 목표주가·투자의견.

    응답 모양은 `{"researchContent": {...}, "researchSummaries": [...]}` 이고,
    우리가 쓰는 것은 `researchContent` 뿐이다(`researchSummaries` 는 「같은 종목의
    다른 리포트」 목록이라 이 리포트의 내용이 아니다).

    🔴 옛 HTML 판의 제목 추출 함정은 **사라졌다.** 그때는 `.view_sbj` 한 덩어리에
       분류명 + 제목 + 증권사 + 날짜 + 조회수가 섞여 있어서 걷어내지 않으면 제목이
       분류명("기타"·"조선")으로 덮였고, 그렇게 407건이 통째로 오염된 적이 있다.
       새 API 는 `title` 을 따로 주므로 그 위험이 없다. 인자 `broker`·`target_name`
       은 옛 호출부와의 호환을 위해 남겨 두었고 지금은 쓰지 않는다.

    목표주가·투자의견은 증권사마다 표기가 제각각이라 **있을 때만** 채운다.
    """
    content = _detail_content(payload)
    body_html = content.get("content") or ""
    text = BeautifulSoup(body_html, "html.parser").get_text(" ", strip=True)

    opinion = None
    m = re.search(
        r"투자의견\s*[:\s]*(매수|중립|매도|BUY|HOLD|SELL|Buy|Hold|Sell|Outperform|Neutral)",
        text,
    )
    if m:
        opinion = normalize_opinion(m.group(1))

    return {
        "pdf_url": (content.get("attachUrl") or "").strip() or None,
        "title": (content.get("title") or "").strip() or None,
        "target_price": parse_target_price(text),
        "opinion": opinion,
        "body_len": len(text),
    }


def detail_body_text(payload: Any) -> str:
    """상세 응답의 **리포트 본문** 텍스트. 요약이 PDF 대신 쓸 폴백 재료다."""
    body_html = _detail_content(payload).get("content") or ""
    return BeautifulSoup(body_html, "html.parser").get_text("\n", strip=True)


def _detail_content(payload: Any) -> dict[str, Any]:
    """상세 응답에서 `researchContent` 를 꺼낸다. 모양이 다르면 빈 dict."""
    if isinstance(payload, (str, bytes)):
        try:
            payload = json.loads(payload)
        except (ValueError, TypeError):
            return {}
    if not isinstance(payload, dict):
        return {}
    content = payload.get("researchContent")
    if isinstance(content, dict):
        return content
    # 감싸개 없이 바로 오는 판본 대비 — 우리가 쓰는 키가 있으면 그대로 본다.
    if any(k in payload for k in ("attachUrl", "content", "title")):
        return payload
    return {}


# 요약 재료로 인정하는 리포트 본문 최소 길이.
# 🔴 `summarize_naver_research.MIN_PDF_TEXT` 와 **같은 값이어야 한다** — 수집이 저장한 것을
#    요약이 못 다루면 화면에 "정리 안 된 카드"가 남는다. 그 어긋남이 실제로 났다.
#
# 🔴 왜 이런 문턱이 필요한가 (2026-08-25 실측):
#    신한투자증권은 네이버에 PDF 를 올리지 않고 **자사 사이트 팝업**으로 보낸다
#    (`shinhansec.com/.../view-popup.do` — 리포트 식별자가 없어 원문을 특정할 수 없다).
#    네이버가 주는 것은 **131자 요지 한 줄**이 전부라 요약이 성립하지 않는다.
#    16건 중 12건이 이 상태로 "정리 안 된 카드"로 남아 있었다.
#    ⚠️ 그렇다고 「PDF 없으면 버린다」로 자르면 안 된다 — 같은 증권사의 **산업분석 3건**은
#       본문이 충실해 864~1,177자로 제대로 정리됐다. 기준은 PDF 유무가 아니라
#       **요약할 재료가 있느냐**다. 본문 길이는 `parse_detail_payload()` 가 `body_len` 으로 준다.
MIN_BODY_TEXT = 300


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
