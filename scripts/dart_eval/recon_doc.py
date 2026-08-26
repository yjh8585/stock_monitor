# -*- coding: utf-8 -*-
"""Q0 정찰 3단계 — 첨부문서(외부평가기관의평가의견서) 본문을 받아 구조를 확인한다.

경로: main.do?rcpNo=..            -> select#att 에서 '평가의견서' option 의 dcmNo 추출
      main.do?rcpNo=..&dcmNo=..   -> 그 문서의 좌측 트리(node) 파싱
      report/viewer.do?...        -> 실제 HTML 본문
PDF 첨부형이면 트리가 비고 PDF 링크만 나온다 -> 그 사실을 판정해 돌려준다.
"""
import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import requests
from bs4 import BeautifulSoup

OUTDIR = os.path.dirname(os.path.abspath(__file__))
S = requests.Session()
S.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})

TREE_RE = re.compile(
    r"node\d+\['text'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['rcpNo'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['dcmNo'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['eleId'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['offset'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['length'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['dtd'\]\s*=\s*\"([^\"]*)\";",
    re.DOTALL,
)
EVAL_KW = ("평가의견서", "외부평가")


def att_docs(rcp: str):
    """첨부문서 목록 [(문서명, dcmNo)] 를 돌려준다."""
    h = S.get(f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp}", timeout=30).text
    m = re.search(r'<select[^>]*id="att".*?</select>', h, re.S)
    if not m:
        return [], h
    out = []
    for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(0), re.S):
        d = re.search(r"dcmNo=(\d+)", v.replace("&amp;", "&"))
        if not d:
            continue
        nm = re.sub(r"\s+", " ", re.sub("<[^>]+>", "", t)).replace("\xa0", " ").strip()
        out.append((nm, d.group(1)))
    return out, h


def doc_text(rcp: str, dcm: str):
    """문서 하나의 본문 텍스트를 돌려준다. (text, 표개수, 판정) — PDF 전용이면 text=None."""
    h = S.get(f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp}&dcmNo={dcm}", timeout=30).text
    nodes = TREE_RE.findall(h)
    if not nodes:
        has_pdf = "download.do" in h or "pdf" in h.lower()
        return None, 0, ("PDF전용" if has_pdf else "본문없음")
    t, r_, d_, ele, off, lng, dtd = max(
        nodes, key=lambda n: int(n[5]) if str(n[5]).isdigit() else 0
    )
    v = (
        f"https://dart.fss.or.kr/report/viewer.do?"
        f"rcpNo={r_}&dcmNo={d_}&eleId={ele}&offset={off}&length={lng}&dtd={dtd}"
    )
    rv = S.get(v, timeout=60)
    rv.encoding = rv.apparent_encoding or "utf-8"
    bs = BeautifulSoup(rv.text, "html.parser")
    return bs.get_text("\n", strip=True), len(bs.find_all("table")), "HTML"


def main():
    rcp = sys.argv[1] if len(sys.argv) > 1 else "20260824000316"
    docs, _ = att_docs(rcp)
    print(f"=== 첨부문서 {len(docs)}개 ===")
    for nm, d in docs:
        print(f"  dcmNo={d}  {nm}")

    target = [(nm, d) for nm, d in docs if any(k in nm.replace(" ", "") for k in EVAL_KW)]
    if not target:
        print("!! 평가의견서 첨부 없음")
        return
    nm, dcm = target[0]
    print(f"\n>> 선택: {nm} (dcmNo={dcm})")
    text, ntab, kind = doc_text(rcp, dcm)
    print(f"   형식={kind}")
    if text is None:
        return
    io.open(os.path.join(OUTDIR, f"evaltext_{rcp}.txt"), "w", encoding="utf-8", newline="\n").write(text)
    print(f"   글자수={len(text):,} · 표={ntab}개")

    print("\n=== 절 제목 후보 ===")
    for line in text.split("\n"):
        s = line.strip()
        if 2 < len(s) < 70 and re.match(
            r"^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\s*[.．]?|[0-9]{1,2}\s*[.．]\s*[가-힣]|[가-힣]\s*[.．]\s*[가-힣])", s
        ):
            print("  ", s)


if __name__ == "__main__":
    main()
