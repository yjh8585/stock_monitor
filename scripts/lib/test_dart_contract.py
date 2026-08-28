"""fetch_contracts.page_urls 의 시험.

🔴 여기 담긴 것은 **실측에서 실제로 나온 모양**이다(2026-08-28 Step 1).
계약서 페이지 이미지의 실제 src 는 아래처럼 생겼다 —

    /report/download.do?dcmNo=9974759&amp;flNm=%EC%9C%A4...%EB%B3%B8_240531_1.jpg

즉 확장자는 `.jpg` 이고 `&` 가 `&amp;` 로 이스케이프돼 있다. 되돌리지 않으면 404 가 온다.
"""
from dart_eval.fetch_contracts import page_urls, sort_pages


def test_page_urls_extracts_images():
    html = '<img src="/report/viewer/img?a=1"><img src="/report/viewer/img?a=2">'
    assert page_urls(html, base="https://dart.fss.or.kr") == [
        "https://dart.fss.or.kr/report/viewer/img?a=1",
        "https://dart.fss.or.kr/report/viewer/img?a=2",
    ]


def test_page_urls_ignores_icons():
    """🔴 뷰어 껍데기의 아이콘·로고를 페이지로 세면 안 된다."""
    html = '<img src="/images/logo.gif"><img src="/report/viewer/img?a=1">'
    assert page_urls(html, base="https://dart.fss.or.kr") == [
        "https://dart.fss.or.kr/report/viewer/img?a=1",
    ]


def test_page_urls_unescapes_amp():
    """실측: DART 는 src 안의 `&` 를 `&amp;` 로 내보낸다 — 그대로 요청하면 404."""
    html = '<img src="/report/download.do?dcmNo=9974759&amp;flNm=a_1.jpg">'
    assert page_urls(html) == [
        "https://dart.fss.or.kr/report/download.do?dcmNo=9974759&flNm=a_1.jpg",
    ]


def test_page_urls_keeps_duplicates_out():
    """같은 페이지가 두 번 적힌 문서가 있다 — 중복은 한 번만 센다."""
    html = ('<img src="/report/download.do?dcmNo=1&amp;flNm=a_1.jpg">'
            '<img src="/report/download.do?dcmNo=1&amp;flNm=a_1.jpg">')
    assert len(page_urls(html)) == 1


# ───────────────────── 페이지 순서 (실측 네 갈래) ─────────────────────
#
# 🔴 아래 넷은 2026-08-28 실물 5건에서 **실제로 나온** 파일명 서식이다.
#    상상해서 만든 시험이 아니다 — 지우지 말 것.

def _u(name: str) -> str:
    return f"https://dart.fss.or.kr/report/download.do?dcmNo=1&flNm={name}"


def _names(urls):
    return [u.rsplit("flNm=", 1)[-1] for u in urls]


def test_sort_trailing_underscore_number():
    """① 이원컴포텍 — `..._1.jpg` 꼴. 이름순이면 1,10,2 가 된다."""
    urls = [_u(f"a_20210830_{i}.jpg") for i in (1, 10, 2, 11)]
    assert _names(sort_pages(urls)) == [
        "a_20210830_1.jpg", "a_20210830_2.jpg", "a_20210830_10.jpg", "a_20210830_11.jpg"]


def test_sort_number_glued_without_underscore():
    """② F&F — `계약서(양사날인)01.jpg` 꼴. 밑줄이 없어도 번호로 읽어야 한다."""
    urls = [_u(f"contract(sign){i:02d}.jpg") for i in (3, 1, 13, 2)]
    assert _names(sort_pages(urls)) == [
        "contract(sign)01.jpg", "contract(sign)02.jpg",
        "contract(sign)03.jpg", "contract(sign)13.jpg"]


def test_sort_bare_unpadded_numbers():
    """③ 아미코젠 — `1.jpg` `10.jpg`. 0채움이 없어 이름순이면 1,10,11,…,2 가 된다."""
    urls = [_u(f"{i}.jpg") for i in (1, 10, 11, 2, 20, 3)]
    assert _names(sort_pages(urls)) == [
        "1.jpg", "2.jpg", "3.jpg", "10.jpg", "11.jpg", "20.jpg"]


def test_sort_groups_multiple_documents():
    """④ KT지니뮤직·덱스터 — 한 첨부에 계약서가 여럿이다.

    🔴 번호만 보고 정렬하면 서로 다른 계약서의 페이지가 뒤섞인다.
       문서별로 묶은 뒤 그 안에서 번호순이어야 한다.
    """
    urls = [
        _u("주주간계약서0477_002.jpg"),
        _u("신주인수계약서0477_001.jpg"),
        _u("주주간계약서0477_001.jpg"),
        _u("신주인수계약서0477_002.jpg"),
    ]
    got = _names(sort_pages(urls))
    assert got.index("신주인수계약서0477_001.jpg") + 1 == got.index("신주인수계약서0477_002.jpg")
    assert got.index("주주간계약서0477_001.jpg") + 1 == got.index("주주간계약서0477_002.jpg")
