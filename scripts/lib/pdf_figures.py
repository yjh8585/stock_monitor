"""증권사 리포트 PDF 에서 차트·도표 영역을 찾아 PNG 로 잘라낸다.

왜 이 모듈이 필요한가:
    요약 파이프라인은 `page.get_text()` 로 **글자만** 뽑아 썼다. 증권사 리포트의 핵심인
    목표주가 밴드 차트·시장 규모 그래프·경쟁사 비교표가 읽는 순간 통째로 버려졌다
    (사용자 지적 2026-08-25: "이미지 중 필요한 것은 수록하고").

왜 페이지를 통째로 렌더하지 않는가(사용자 선택 2026-08-25):
    페이지 PNG 는 본문 글자와 증권사 로고까지 들어가 화면에서 작고 지저분하다.
    그래서 **그림 영역만 잘라낸다.**

어떻게 찾는가:
    증권사 리포트의 차트는 대부분 **벡터 도형**(선·사각형)이라 `page.get_images()` 로는
    잡히지 않는다. 그래서 `page.get_drawings()` 의 도형 bbox 와 래스터 이미지 bbox 를
    함께 모아, 서로 가까운 것들을 하나의 덩어리로 **뭉쳐서**(clustering) 영역을 만든다.

    🔴 뭉치기 전에 걸러야 하는 것이 있다. 페이지 전폭 구분선·배경 사각형을 그대로 두면
       페이지의 모든 도형이 하나로 이어져 「그림 = 페이지 전체」가 된다.

무엇을 건너뛰는가(사용자 지시 2026-08-25):
    리포트 뒤쪽 **표준 재무제표 부록**(요약 손익계산서·재무상태표·현금흐름표·투자지표 표)과
    컴플라이언스 고지 페이지는 통째로 건너뛴다. "재무실적 중 중요한 것은 기업 페이지에
    나오니까."

이 파일의 순수 함수(`fitz` 없이 도는 것)는 `scripts/lib/test_pdf_figures.py` 가 시험한다.
"""

from __future__ import annotations

from dataclasses import dataclass

# ── 튜닝 상수 ────────────────────────────────────────────────────────────────
# 값은 A4 기준 포인트(pt) 단위. 1pt = 1/72 인치이고 A4 는 595 x 842 pt 다.

#: 이 거리 안에 있는 도형들은 같은 그림으로 본다. 차트의 축·격자·막대가 서로
#: 조금씩 떨어져 있어도 한 덩어리로 뭉치게 하는 값.
CLUSTER_GAP_PT = 10.0

#: 페이지 폭 대비 이 비율을 넘고 아주 얇으면 «구분선»으로 보고 버린다.
#: 이걸 안 버리면 머리글 밑줄 하나가 페이지 위아래 도형을 전부 이어 붙인다.
RULE_WIDTH_RATIO = 0.72
RULE_MAX_THICKNESS_PT = 3.0

#: 페이지 면적의 이 비율을 넘는 단일 도형은 «배경»으로 보고 버린다.
BACKGROUND_AREA_RATIO = 0.80

#: 최종 그림으로 채택할 영역의 크기 조건.
MIN_FIGURE_WIDTH_PT = 90.0
MIN_FIGURE_HEIGHT_PT = 60.0
MIN_FIGURE_AREA_RATIO = 0.02
MAX_FIGURE_AREA_RATIO = 0.55

#: 페이지 높이의 이 비율을 넘는 영역은 «표지·사이드바» 로 본다.
#: 실측 2026-08-25: 표지 전체(0.70)·세로 사이드바(0.93)가 이렇게 걸러진다.
MAX_FIGURE_HEIGHT_RATIO = 0.72

#: 한 페이지에서 채택할 그림 수 상한. 넘으면 큰 것부터.
MAX_FIGURES_PER_PAGE = 4

#: 한 리포트에서 채택할 그림 수 상한. 헤드리스가 고를 후보를 주는 것이지
#: 전부 싣는 것이 아니므로 넉넉하게 둔다.
MAX_FIGURES_PER_REPORT = 14

#: 잘라낸 그림을 렌더할 배율. 2배면 A4 반 폭 차트가 대략 800px 가 된다.
RENDER_ZOOM = 2.0

#: 그림에 걸친 글자 덩어리를 품을 때 한 변당 최대로 넓히는 거리.
#: 축 라벨·파이 조각 라벨을 살리되 본문 문단까지 삼키지 않는 선.
MAX_TEXT_GROW_PT = 26.0

#: 잘라낸 그림 둘레에 두는 여백. 선이 가장자리에 딱 붙어 잘리는 것을 막는다.
FIGURE_PAD_PT = 4.0

#: 캡션 후보를 찾을 때 그림 위·아래로 훑는 거리.
CAPTION_SCAN_PT = 34.0

#: 재료 파일에 실을 캡션 최대 길이.
MAX_CAPTION_CHARS = 120


# ── 페이지 건너뛰기 판정 ─────────────────────────────────────────────────────

#: 표준 재무제표 부록의 표제어. **두 개 이상** 나와야 부록으로 본다 —
#: 본문에서 "현금흐름" 한 번 언급했다고 그 페이지의 차트를 버리면 손해다.
_FINANCIAL_APPENDIX_MARKERS = (
    "포괄손익계산서",
    "손익계산서",
    "재무상태표",
    "대차대조표",
    "현금흐름표",
    "주요 투자지표",
    "주요투자지표",
    "투자지표",
    "재무비율",
    "Income Statement",
    "Balance Sheet",
    "Cash Flow",
)

#: 컴플라이언스·면책 페이지. **하나만** 나와도 건너뛴다 — 이 표현들은 본문에 안 쓰인다.
_COMPLIANCE_MARKERS = (
    "Compliance Notice",
    "본 조사분석자료는",
    "투자등급 및 적용기준",
    "이해관계 고지",
    "종목별 투자의견",
    "compliance notice",
)

_MIN_FINANCIAL_MARKERS = 2


def is_skippable_page(page_text: str) -> bool:
    """이 페이지를 그림 후보에서 통째로 뺄 것인가.

    사용자 지시 2026-08-25 — 표준 재무제표 부록과 컴플라이언스 고지는 다루지 않는다.
    """
    text = page_text or ""
    if any(m in text for m in _COMPLIANCE_MARKERS):
        return True
    hits = sum(1 for m in _FINANCIAL_APPENDIX_MARKERS if m in text)
    return hits >= _MIN_FINANCIAL_MARKERS


# ── 사각형 유틸 (순수) ───────────────────────────────────────────────────────

Rect = tuple[float, float, float, float]  # (x0, y0, x1, y1)


def rect_width(r: Rect) -> float:
    return r[2] - r[0]


def rect_height(r: Rect) -> float:
    return r[3] - r[1]


def rect_area(r: Rect) -> float:
    return max(0.0, rect_width(r)) * max(0.0, rect_height(r))


def union_rect(a: Rect, b: Rect) -> Rect:
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def rects_near(a: Rect, b: Rect, gap: float) -> bool:
    """두 사각형을 `gap` 만큼 부풀렸을 때 겹치는가."""
    return not (
        a[2] + gap < b[0] or b[2] + gap < a[0] or a[3] + gap < b[1] or b[3] + gap < a[1]
    )


def clip_to_page(r: Rect, page_width: float, page_height: float) -> Rect:
    """페이지 밖으로 삐져나간 좌표를 페이지 안으로 자른다.

    🔴 PDF 도형은 페이지 경계를 넘는 좌표를 가질 수 있다. 실측 2026-08-25 에
       폭 1134pt(A4 는 595pt)짜리 «그림»이 나왔고, 그대로 렌더하면 오른쪽 절반이
       빈 여백인 이미지가 된다.
    """
    return (
        max(0.0, min(r[0], page_width)),
        max(0.0, min(r[1], page_height)),
        max(0.0, min(r[2], page_width)),
        max(0.0, min(r[3], page_height)),
    )


def drop_non_figure_shapes(
    rects: list[Rect], page_width: float, page_height: float
) -> list[Rect]:
    """뭉치기 **전에** 버릴 것 — 페이지 전폭 구분선과 배경 사각형.

    🔴 이걸 건너뛰면 머리글 밑줄 하나가 페이지 위아래 도형을 전부 이어 붙여
       「그림 = 페이지 전체」가 된다. 실패 모드가 조용해서 더 위험하다.
    """
    page_area = max(1.0, page_width * page_height)
    kept: list[Rect] = []
    for raw in rects:
        r = clip_to_page(raw, page_width, page_height)
        w, h = rect_width(r), rect_height(r)
        if w <= 0 or h <= 0:
            continue
        if rect_area(r) / page_area >= BACKGROUND_AREA_RATIO:
            continue
        is_wide = w >= page_width * RULE_WIDTH_RATIO
        if is_wide and h <= RULE_MAX_THICKNESS_PT:
            continue
        if h >= page_height * RULE_WIDTH_RATIO and w <= RULE_MAX_THICKNESS_PT:
            continue
        kept.append(r)
    return kept


def cluster_rects(rects: list[Rect], gap: float = CLUSTER_GAP_PT) -> list[Rect]:
    """가까운 사각형들을 한 덩어리로 뭉친다.

    합쳐진 결과가 또 다른 덩어리와 가까워질 수 있으므로 **변화가 없을 때까지** 돈다.
    입력이 수백 개라 O(n^2) 이지만 페이지 한 장 단위라 실측상 문제가 없다.

    SHORTCUT: O(n^2) 반복 병합 → 페이지당 도형이 수천 개가 되면 공간 색인(R-tree)으로.
    """
    groups: list[Rect] = list(rects)
    changed = True
    while changed:
        changed = False
        merged: list[Rect] = []
        for r in groups:
            for i, m in enumerate(merged):
                if rects_near(r, m, gap):
                    merged[i] = union_rect(m, r)
                    changed = True
                    break
            else:
                merged.append(r)
        groups = merged
    return groups


def select_figure_rects(
    rects: list[Rect],
    page_width: float,
    page_height: float,
    limit: int = MAX_FIGURES_PER_PAGE,
) -> list[Rect]:
    """뭉친 덩어리 중 «그림» 이라 부를 만한 것만, 큰 것부터 고른다."""
    page_area = max(1.0, page_width * page_height)
    page_h = max(1.0, page_height)
    picked = [
        r
        for r in rects
        if rect_width(r) >= MIN_FIGURE_WIDTH_PT
        and rect_height(r) >= MIN_FIGURE_HEIGHT_PT
        and rect_height(r) / page_h <= MAX_FIGURE_HEIGHT_RATIO
        and MIN_FIGURE_AREA_RATIO <= rect_area(r) / page_area <= MAX_FIGURE_AREA_RATIO
    ]
    picked.sort(key=rect_area, reverse=True)
    picked = picked[:limit]
    # 페이지에 실린 순서(위 → 아래, 왼쪽 → 오른쪽)로 되돌린다.
    picked.sort(key=lambda r: (round(r[1], 1), r[0]))
    return picked


def expand_to_text_blocks(
    rect: Rect,
    text_blocks: list[Rect],
    page_width: float,
    page_height: float,
    max_grow: float = MAX_TEXT_GROW_PT,
) -> Rect:
    """그림 영역에 걸친 «글자 덩어리»를 품도록 영역을 넓힌다.

    🔴 왜 필요한가 — 축 눈금·파이 조각 라벨은 **글자**라서 `get_drawings()` 에 안 잡힌다.
       도형 bbox 만 쓰면 파이 차트 라벨("기타 11.2%")이 잘려 나간다(실측 2026-08-25 격자
       26·27번). 그렇다고 아무 글자나 품으면 본문 문단까지 삼켜 영역이 페이지가 된다.

    그래서 **이미 영역과 겹치는** 글자 덩어리만 품고, 한 변당 `max_grow` 이상은 안 넓힌다.
    """
    grown = rect
    for tb in text_blocks:
        if not rects_near(rect, tb, gap=0.0):
            continue  # 겹치지 않는 글자는 남의 것이다
        grown = union_rect(grown, tb)

    limited = (
        max(rect[0] - max_grow, grown[0]),
        max(rect[1] - max_grow, grown[1]),
        min(rect[2] + max_grow, grown[2]),
        min(rect[3] + max_grow, grown[3]),
    )
    padded = (
        limited[0] - FIGURE_PAD_PT,
        limited[1] - FIGURE_PAD_PT,
        limited[2] + FIGURE_PAD_PT,
        limited[3] + FIGURE_PAD_PT,
    )
    return clip_to_page(padded, page_width, page_height)


def clean_caption(text: str) -> str:
    """캡션 후보 문자열을 한 줄로 다듬는다."""
    one_line = " ".join((text or "").split())
    if len(one_line) <= MAX_CAPTION_CHARS:
        return one_line
    return one_line[:MAX_CAPTION_CHARS].rstrip() + "…"


#: 「자료: 에프앤가이드」 같은 출처 줄. 캡션으로는 쓸모가 없어 뒤로 미룬다.
_SOURCE_LINE_PREFIXES = ("자료", "출처", "Source", "source", "주)", "주:")

_MIN_CAPTION_LEN = 4


def _usable_lines(text: str) -> list[str]:
    return [ln.strip() for ln in (text or "").splitlines() if len(ln.strip()) >= _MIN_CAPTION_LEN]


def pick_caption_line(above_text: str, below_text: str) -> str:
    """그림 위·아래 텍스트에서 캡션 한 줄을 고른다.

    증권사 리포트는 관례상 그림 **위**에 「그림 3. …」·「표 2. …」 제목을 달고
    **아래**에 「자료: …」를 단다. 그래서 이렇게 고른다.

    1. 위쪽 줄들을 **그림에 가까운 것부터**(= 아래에서 위로) 보고, 출처 줄이 아닌 첫 줄
    2. 없으면 아래쪽에서 출처 줄이 아닌 첫 줄
    3. 그래도 없으면 위쪽 마지막 줄(출처 줄이라도 없는 것보다 낫다)

    🔴 위쪽 상자를 통째로 이어 붙이면 **앞 그림의 출처 줄**이 캡션 앞에 붙는다
       (실측 2026-08-25: "자료: 에프앤가이드, 미래에셋증권 리서치센터 자료: …").
    """
    above = _usable_lines(above_text)
    below = _usable_lines(below_text)

    def is_source(line: str) -> bool:
        return line.startswith(_SOURCE_LINE_PREFIXES)

    for line in reversed(above):
        if not is_source(line):
            return clean_caption(line)
    for line in below:
        if not is_source(line):
            return clean_caption(line)
    if above:
        return clean_caption(above[-1])
    return ""


# ── 추출 결과 ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Figure:
    """PDF 에서 잘라낸 그림 한 장."""

    page_no: int  # 1-base
    index: int  # 그 페이지 안에서의 순번 (1-base)
    rect: Rect
    caption: str
    png: bytes

    @property
    def name(self) -> str:
        """Storage 객체 이름(확장자 포함)."""
        return f"p{self.page_no:02d}_{self.index}.png"


# ── fitz 를 쓰는 부분 ────────────────────────────────────────────────────────


def _shape_rects(page) -> list[Rect]:
    """페이지의 벡터 도형 + 래스터 이미지 bbox 를 모은다."""
    rects: list[Rect] = []
    for d in page.get_drawings():
        r = d.get("rect")
        if r is not None:
            rects.append((float(r.x0), float(r.y0), float(r.x1), float(r.y1)))
    for info in page.get_images(full=True):
        try:
            r = page.get_image_bbox(info)
        except Exception:
            continue
        rects.append((float(r.x0), float(r.y0), float(r.x1), float(r.y1)))
    return rects


def _text_block_rects(page) -> list[Rect]:
    """페이지의 «글자 덩어리» bbox. 축 라벨·범례를 그림에 되돌리는 데 쓴다."""
    blocks: list[Rect] = []
    for b in page.get_text("blocks"):
        # (x0, y0, x1, y1, text, block_no, block_type) — block_type 0 이 글자다.
        if len(b) >= 7 and b[6] != 0:
            continue
        blocks.append((float(b[0]), float(b[1]), float(b[2]), float(b[3])))
    return blocks


def _caption_near(page, rect: Rect) -> str:
    """그림 바로 위·아래의 텍스트를 읽어 캡션 한 줄을 고른다(고르는 규칙은 순수 함수)."""
    import fitz  # 지역 import — 순수 함수만 쓰는 시험이 fitz 없이 돌게

    above = fitz.Rect(rect[0], max(0.0, rect[1] - CAPTION_SCAN_PT), rect[2], rect[1])
    below = fitz.Rect(rect[0], rect[3], rect[2], rect[3] + CAPTION_SCAN_PT)
    return pick_caption_line(page.get_textbox(above), page.get_textbox(below))


def extract_figures(
    pdf_bytes: bytes, max_figures: int = MAX_FIGURES_PER_REPORT
) -> list[Figure]:
    """PDF 바이트에서 그림들을 잘라낸다. 실패하면 빈 목록(호출자가 그림 없이 진행)."""
    import fitz  # pymupdf

    figures: list[Figure] = []
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        matrix = fitz.Matrix(RENDER_ZOOM, RENDER_ZOOM)
        for page_no, page in enumerate(doc, start=1):
            if len(figures) >= max_figures:
                break
            if is_skippable_page(page.get_text()):
                continue

            pw, ph = float(page.rect.width), float(page.rect.height)
            shapes = drop_non_figure_shapes(_shape_rects(page), pw, ph)
            picked = select_figure_rects(cluster_rects(shapes), pw, ph)
            blocks = _text_block_rects(page)

            for i, rect in enumerate(picked, start=1):
                if len(figures) >= max_figures:
                    break
                rect = expand_to_text_blocks(rect, blocks, pw, ph)
                clip = fitz.Rect(*rect)
                try:
                    png = page.get_pixmap(matrix=matrix, clip=clip).tobytes("png")
                except Exception:
                    continue
                figures.append(
                    Figure(
                        page_no=page_no,
                        index=i,
                        rect=rect,
                        caption=_caption_near(page, rect),
                        png=png,
                    )
                )
    return figures


# ── 본문이 이미지인 PDF 를 위한 폴백 ────────────────────────────────────────────
# 🔴 증권사에 따라 본문 글자를 **글리프 이미지로** 심는다(미래에셋 실측: 1쪽에 이미지 462개,
#    추출되는 글자는 90자). 이런 PDF 는 텍스트 경로로는 절대 못 읽으므로 페이지를 통째로
#    렌더해 헤드리스가 **눈으로** 읽게 한다. 텍스트가 정상인 PDF 에는 쓰지 않는다(비싸다).
MAX_RENDER_PAGES = 12


def render_pages(
    pdf_bytes: bytes, max_pages: int = MAX_RENDER_PAGES, zoom: float = RENDER_ZOOM
) -> list[tuple[int, bytes]]:
    """페이지를 통째로 PNG 로 렌더한다. `[(쪽번호, png bytes), ...]`.

    실패하면 빈 목록을 돌려준다(호출자가 텍스트만으로 진행한다).
    """
    import fitz  # pymupdf

    out: list[tuple[int, bytes]] = []
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            matrix = fitz.Matrix(zoom, zoom)
            for page_no, page in enumerate(doc, start=1):
                if len(out) >= max_pages:
                    break
                try:
                    out.append((page_no, page.get_pixmap(matrix=matrix).tobytes("png")))
                except Exception:
                    continue
    except Exception:
        return []
    return out


# 정상 리포트는 쪽당 2,000~6,000자가 나온다. 글리프 이미지 PDF 는 90~220자에 그친다.
# 🔴 **총 길이로 판정하면 안 된다** — 5쪽짜리가 576자여도 "300자 이상"이라 정상으로 통과한다
#    (2026-08-25 실측: 이 오판 때문에 미래에셋 3편이 계속 실패했다).
MIN_CHARS_PER_PAGE = 400


def is_image_body(text_len: int, page_count: int) -> bool:
    """본문 글자가 이미지로 심긴 PDF 인가. 쪽당 글자 밀도로 판정한다."""
    if page_count <= 0:
        return False
    return text_len / page_count < MIN_CHARS_PER_PAGE
