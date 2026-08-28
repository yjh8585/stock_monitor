"""fetch_contracts.page_urls 의 시험.

🔴 여기 담긴 것은 **실측에서 실제로 나온 모양**이다(2026-08-28 Step 1).
계약서 페이지 이미지의 실제 src 는 아래처럼 생겼다 —

    /report/download.do?dcmNo=9974759&amp;flNm=%EC%9C%A4...%EB%B3%B8_240531_1.jpg

즉 확장자는 `.jpg` 이고 `&` 가 `&amp;` 로 이스케이프돼 있다. 되돌리지 않으면 404 가 온다.
"""
import json

from dart_eval.fetch_contracts import (
    NEVER_FETCHED, UNKNOWN, n_missing, page_name, page_urls, renumber, sort_pages,
)


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


def test_page_urls_unescapes_more_than_amp():
    """`html.unescape` 로 바꿨으니 `&amp;` 말고도 덮인다."""
    html = '<img src="/report/download.do?a=1&#38;b=2">'
    assert page_urls(html) == ["https://dart.fss.or.kr/report/download.do?a=1&b=2"]


# ───────────────────── 파일명 0채움 자릿수 ─────────────────────

def test_page_name_widens_for_large_folders():
    """🔴 2자리 고정이면 100장 넘는 폴더의 **파일명 사전순**이 깨진다.

    실측: KT지니뮤직 235장을 이름순으로 늘어놓으면
    `page_09 → page_10 → page_100 → … → page_11` 이 된다.
    `_meta.json` 순서가 맞아도 Task 2 가 `glob`+`sorted` 로 읽으면 계약서 4종이 뒤섞인다.
    """
    u = "https://d/report/download.do?flNm=a_1.jpg"
    assert page_name(1, 6, u) == "page_01.jpg"      # 6장 → 2자리
    assert page_name(9, 235, u) == "page_009.jpg"   # 235장 → 3자리
    assert page_name(100, 235, u) == "page_100.jpg"
    # 자릿수가 맞으면 이름순 == 번호순 이다(이게 이 함수의 존재 이유다)
    names = [page_name(i, 235, u) for i in range(1, 236)]
    assert sorted(names) == names


# ───────────────────── --renumber (파괴적 코드라 시험이 필요하다) ─────────────────────

def _folder(tmp_path, entries):
    """`entries` = [(파일명, src_url)] 순서 그대로 `_meta.json` 을 만든다."""
    d = tmp_path / "회사_20210101000001"
    d.mkdir()
    pages = []
    for i, (fn, url) in enumerate(entries, 1):
        (d / fn).write_bytes(b"x" * (i + 1))
        pages.append({"file": fn, "src_url": url, "bytes": i + 1})
    (d / "_meta.json").write_text(
        json.dumps({"rcp": "1", "corp": "회사", "pages": pages}, ensure_ascii=False),
        encoding="utf-8")
    return d


def _meta(d):
    return json.loads((d / "_meta.json").read_text(encoding="utf-8"))


def test_renumber_fixes_order_and_width(tmp_path):
    """잘못 매겨진 폴더를 바로잡는다 — 파일 개수·바이트는 그대로여야 한다."""
    u = "https://d/report/download.do?flNm=a_{}.jpg"
    # 일부러 뒤집어 놓는다: page_01 이 3쪽, page_02 가 1쪽 …
    d = _folder(tmp_path, [("page_01.jpg", u.format(3)),
                           ("page_02.jpg", u.format(1)),
                           ("page_03.jpg", u.format(2))])
    assert renumber(d) == "다시 매김"
    m = _meta(d)
    assert [p["file"] for p in m["pages"]] == ["page_01.jpg", "page_02.jpg", "page_03.jpg"]
    assert [p["src_url"] for p in m["pages"]] == [u.format(1), u.format(2), u.format(3)]
    # 3쪽짜리 파일(원래 page_01, 2바이트)이 이제 page_03 이어야 한다
    assert (d / "page_03.jpg").read_bytes() == b"xx"
    assert sorted(p.name for p in d.iterdir()) == [
        "_meta.json", "page_01.jpg", "page_02.jpg", "page_03.jpg"]


def test_renumber_is_idempotent(tmp_path):
    """두 번째 호출은 「그대로」 — 파괴적 코드가 매번 파일을 흔들면 안 된다."""
    u = "https://d/report/download.do?flNm=a_{}.jpg"
    d = _folder(tmp_path, [("page_01.jpg", u.format(2)), ("page_02.jpg", u.format(1))])
    assert renumber(d) == "다시 매김"
    assert renumber(d) == "그대로"


def test_renumber_recovers_from_interrupted_run(tmp_path):
    """🔴 2단 개명 도중 끊기면 `.tmp` 가 남고 `_meta.json` 은 옛 이름을 가리킨다.

    되돌리지 않으면 재실행이 `FileNotFoundError` 로 죽는다.
    """
    u = "https://d/report/download.do?flNm=a_{}.jpg"
    d = _folder(tmp_path, [("page_01.jpg", u.format(2)), ("page_02.jpg", u.format(1))])
    # 앞선 실행이 1단만 끝내고 죽은 상태를 흉내낸다
    (d / "page_01.jpg").rename(d / "page_01.jpg.tmp")
    assert renumber(d).startswith("다시 매김")
    assert list(d.glob("*.tmp")) == []
    assert [p["src_url"] for p in _meta(d)["pages"]] == [u.format(1), u.format(2)]


def test_renumber_flags_pages_whose_file_vanished(tmp_path):
    """메타엔 있는데 파일이 없으면 `missing` 에 남긴다 — 「받음」으로 굳으면 안 된다."""
    u = "https://d/report/download.do?flNm=a_{}.jpg"
    d = _folder(tmp_path, [("page_01.jpg", u.format(1)), ("page_02.jpg", u.format(2))])
    (d / "page_02.jpg").unlink()
    renumber(d)
    assert [m["page"] for m in _meta(d)["missing"]] == [2]


# ───────────────────── 미완 폴더를 「받음」으로 굳히지 않는다 ─────────────────────

def test_n_missing_says_never_fetched(tmp_path):
    assert n_missing(tmp_path / "없는폴더") == NEVER_FETCHED


def test_n_missing_will_not_read_absent_key_as_empty(tmp_path):
    """🔴 옛 폴더엔 `missing` 키가 아예 없다 — 그것을 「빈 배열」로 읽으면 안 된다.

    `.get("missing", [])` 로 읽으면 기본값 덕에 «우연히» 완전해 보인다.
    못 잰 것은 0 이 아니다 → 판정 불가(`UNKNOWN`)로 갈라야 백필 대상이 드러난다.
    """
    u = "https://d/report/download.do?flNm=a_1.jpg"
    d = _folder(tmp_path, [("page_01.jpg", u)])          # 옛 서식(키 없음)
    assert n_missing(d) == UNKNOWN


def test_n_missing_zero_after_backfill(tmp_path):
    u = "https://d/report/download.do?flNm=a_1.jpg"
    d = _folder(tmp_path, [("page_01.jpg", u)])
    renumber(d)                                          # 백필
    assert n_missing(d) == 0


def test_n_missing_counts_failed_pages(tmp_path):
    """🔴 페이지가 빠진 폴더는 건너뛰면 안 된다 — 빠진 장이 영영 안 받힌다."""
    u = "https://d/report/download.do?flNm=a_1.jpg"
    d = _folder(tmp_path, [("page_01.jpg", u)])
    m = _meta(d)
    m["missing"] = [{"page": 2, "src_url": "https://d/x?flNm=a_2.jpg"}]
    (d / "_meta.json").write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
    assert n_missing(d) == 1


# ───────────────────── 옛 폴더 키 백필 (n_expected · missing) ─────────────────────

def test_renumber_backfills_keys_on_old_folder(tmp_path):
    """🔴 순서가 이미 맞아도 키가 없으면 「그대로」로 통과시키면 안 된다."""
    u = "https://d/report/download.do?flNm=a_{}.jpg"
    d = _folder(tmp_path, [("page_01.jpg", u.format(1)), ("page_02.jpg", u.format(2))])
    assert "n_expected" not in _meta(d)
    assert renumber(d) == "키 백필"
    m = _meta(d)
    assert m["n_expected"] == 2
    assert m["missing"] == []
    # 수집 당시에 «잰» 값이 아니라 사후에 파일에서 «세운» 값임을 남긴다
    assert m["n_expected_source"] == "backfill"


def test_renumber_does_not_overwrite_measured_n_expected(tmp_path):
    """수집 당시에 잰 값이 있으면 덮지 않는다 — 그쪽이 더 믿을 만하다."""
    u = "https://d/report/download.do?flNm=a_1.jpg"
    d = _folder(tmp_path, [("page_01.jpg", u)])
    m = _meta(d)
    m["n_expected"] = 5            # 5장 중 1장만 받은 미완 폴더
    m["missing"] = [{"page": 2, "src_url": "https://d/x?flNm=a_2.jpg"}]
    (d / "_meta.json").write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
    renumber(d)
    out = _meta(d)
    assert out["n_expected"] == 5
    assert "n_expected_source" not in out
    assert [x["page"] for x in out["missing"]] == [2]
