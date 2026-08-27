"""fetch_deal_meta 의 정규화 시험.

🔴 여기 담긴 세 가지는 **실측에서 실제로 나온 함정**이다(2026-08-28).
상상해서 만든 시험이 아니다 — 그래서 지우지 말 것.
"""
from fetch_deal_meta import clean_opinion, normalize_audit


def test_기수_표기의_줄바꿈을_걷어낸다():
    # 실측: DART 는 "제55기\n(당기)" 처럼 줄바꿈이 든 값을 준다
    raw = [{"bsns_year": "제55기\n(당기)", "adtor": "삼정회계법인", "adt_opinion": "적정"}]
    out = normalize_audit(raw)
    assert out[0]["bsns_year"] == "제55기(당기)"
    assert out[0]["adtor"] == "삼정회계법인"


def test_감사의견_표기를_정규화한다():
    # 실측: 회사에 따라 "적정" 과 "적정의견" 이 섞여 온다(시스웍 vs 와이엠텍)
    raw = [{"bsns_year": "제5기", "adtor": "이촌회계법인", "adt_opinion": "적정의견"}]
    assert normalize_audit(raw)[0]["opinion_norm"] == "적정"


def test_감사인이_빈_값이면_표식을_남긴다():
    # 실측: 키이스트는 건수 3인데 adtor 가 "-" 였다.
    # 조용히 빈 문자열로 통과시키면 「수집 안 함」과 구분되지 않는다.
    raw = [{"bsns_year": "제20기", "adtor": "-", "adt_opinion": "-"}]
    out = normalize_audit(raw)
    assert out[0]["adtor"] == ""
    assert out[0]["missing"] is True


def test_의견거절도_정규화가_망가뜨리지_않는다():
    # 실측: 비케이탑스 2021 = "의견거절". "의견" 을 지우면 "거절" 이 되어 뜻이 바뀐다
    raw = [{"bsns_year": "제20기", "adtor": "성현회계법인", "adt_opinion": "의견거절"}]
    assert normalize_audit(raw)[0]["opinion_norm"] == "의견거절"


def test_각주가_붙어도_판정이_선다():
    # 실측 오탐 2건: "적정의견\n주1)" 과 "(연결) 적정\n(별도) 적정" 이
    # 「적정이 아닌 것」으로 잡혔다. 각주·연결/별도 표기를 걷어내야 한다.
    assert clean_opinion("적정의견\n주1)") == "적정"
    assert clean_opinion("(연결) 적정\n(별도) 적정") == "적정"


def test_각주가_붙은_의견거절은_의견거절로_남는다():
    # 비에프랩스 실측값. 각주를 걷어내되 판정을 무르게 만들면 안 된다.
    assert clean_opinion("의견거절\n(*1,*2)") == "의견거절"


def test_빈_목록이면_빈_배열을_준다():
    assert normalize_audit([]) == []
