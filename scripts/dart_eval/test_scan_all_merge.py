"""scan_all 의 대장 병합 시험.

🔴 **2026-09-01 에 실제로 터진 사고를 막는 시험이다** — cron 이 `--years 1` 로 도는데
   대장을 통째로 다시 쓰는 바람에 5년치 2,181행이 1년치 417행으로 잘렸고, 행마다 있던
   분석 필드(method_dcf·values_mn·deal_price_mn)까지 함께 날아갔다.
   실패해도 화면엔 「성공」이 찍혀 일주일 넘게 아무도 몰랐다. **그래서 지우지 말 것.**
"""
from scan_all import merge_rows


def test_창_밖의_과거_행을_지킨다():
    # 실측: 이번 스캔 창(1년) 밖에 있는 2021년 행이 통째로 사라졌던 자리다
    old = [{"rcp": "20210830001222", "dt": "20210830", "method_dcf": True}]
    new = [{"rcp": "20260831000111", "dt": "20260831"}]
    merged = merge_rows(old, new)
    assert len(merged) == 2
    by = {r["rcp"]: r for r in merged}
    assert by["20210830001222"]["method_dcf"] is True  # 분석 필드도 함께 살아남아야 한다


def test_같은_접수번호는_이번_스캔이_이긴다():
    # 본문을 다시 파싱한 결과를 반영해야 하므로 새 값이 이긴다
    old = [{"rcp": "20250904000002", "dt": "20250904", "opinion": "옛 값"}]
    new = [{"rcp": "20250904000002", "dt": "20250904", "opinion": "새 값"}]
    assert merge_rows(old, new)[0]["opinion"] == "새 값"


def test_접수일_순으로_정렬한다():
    old = [{"rcp": "20260831000111", "dt": "20260831"}]
    new = [{"rcp": "20210830001222", "dt": "20210830"}]
    assert [r["dt"] for r in merge_rows(old, new)] == ["20210830", "20260831"]


def test_첫_실행처럼_기존_대장이_비어도_동작한다():
    new = [{"rcp": "20260831000111", "dt": "20260831"}]
    assert merge_rows([], new) == new


def test_접수번호가_없는_행은_버린다():
    # rcp 가 병합의 열쇠라 없는 행은 합칠 수 없다(조용히 중복되는 것보다 버리는 쪽이 낫다)
    old = [{"dt": "20200101"}]
    new = [{"rcp": "20260831000111", "dt": "20260831"}]
    assert len(merge_rows(old, new)) == 1
