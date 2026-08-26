# -*- coding: utf-8 -*-
"""남은 미확정 검증 — 정정공시 첨부의 `rcpNo` 쌍 가설을 실물로 확인한다.

가설: 「본문없음」의 원인은 형식이 아니라, 첨부 option value 의 rcpNo(원공시)를 쓰지 않고
      정정본 rcpNo 를 쓴 우리 파서의 버그다.

절차
 0) DART 웹 차단이 풀릴 때까지 기다린다(최대 대기시간 안에서 주기 확인)
 1) 표본조사에서 「본문없음」으로 떨어진 [기재정정] 건 10개를 고른다
 2) 각 건의 첨부 option value 에서 rcpNo·dcmNo 를 **쌍으로** 뽑는다
 3) 정정본 rcpNo 와 첨부 rcpNo 가 다른지 센다  <- 가설의 직접 증거
 4) 쌍으로 문서를 열어 본문이 나오는지 센다   <- 가설의 결과 증거
요청 간격은 1.5초 이상(차단 재발 방지).
"""
import io
import json
import os
import re
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
GAP = 2.0           # 요청 간격(초) — 정찰 때 0.15초로 두들겨 차단당했다
WAIT_MAX = 3600     # 차단 해제 대기 상한(초)
WAIT_STEP = 120     # 확인 주기(초)

S = requests.Session()
S.headers.update({
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": "https://dart.fss.or.kr/",
})

TREE_RE = re.compile(
    r"node\d+\['text'\]\s*=\s*\"([^\"]*)\";.*?node\d+\['rcpNo'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['dcmNo'\]\s*=\s*\"([^\"]*)\";.*?node\d+\['eleId'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['offset'\]\s*=\s*\"([^\"]*)\";.*?node\d+\['length'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['dtd'\]\s*=\s*\"([^\"]*)\";",
    re.DOTALL,
)


def alive() -> bool:
    try:
        S.get("https://dart.fss.or.kr/", timeout=20)
        return True
    except Exception:
        return False


def wait_unblock() -> bool:
    waited = 0
    while waited <= WAIT_MAX:
        if alive():
            print(f"  차단 해제 확인 (대기 {waited}초)", flush=True)
            return True
        print(f"  차단 지속… {waited}초 경과", flush=True)
        time.sleep(WAIT_STEP)
        waited += WAIT_STEP
    return False


def get(url: str) -> str | None:
    """지수 백오프 재시도."""
    for i in range(4):
        try:
            r = S.get(url, timeout=40)
            time.sleep(GAP)
            return r.text
        except Exception:
            time.sleep(5 * (i + 1))
    return None


def att_pairs(rcp: str):
    """첨부문서 [(문서명, 첨부rcpNo, dcmNo)] — 🔴 rcpNo 를 함께 뽑는 것이 이번 수정의 핵심."""
    h = get(f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp}")
    if h is None:
        return None
    m = re.search(r'<select[^>]*id="att".*?</select>', h, re.S)
    if not m:
        return []
    out = []
    for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(0), re.S):
        v = v.replace("&amp;", "&")
        mr, md = re.search(r"rcpNo=(\d+)", v), re.search(r"dcmNo=(\d+)", v)
        if mr and md:
            nm = re.sub(r"\s+", " ", re.sub("<[^>]+>", "", t)).replace("\xa0", " ").strip()
            out.append((nm, mr.group(1), md.group(1)))
    return out


def body(rcp_att: str, dcm: str):
    """(글자수, 표개수, 판정)"""
    h = get(f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp_att}&dcmNo={dcm}")
    if h is None:
        return 0, 0, "요청실패"
    nodes = TREE_RE.findall(h)
    if not nodes:
        return 0, 0, ("PDF전용" if "download" in h.lower() else "본문없음")
    n = max(nodes, key=lambda x: int(x[5]) if str(x[5]).isdigit() else 0)
    v = (f"https://dart.fss.or.kr/report/viewer.do?rcpNo={n[1]}&dcmNo={n[2]}"
         f"&eleId={n[3]}&offset={n[4]}&length={n[5]}&dtd={n[6]}")
    hv = get(v)
    if hv is None:
        return 0, 0, "뷰어실패"
    bs = BeautifulSoup(hv, "html.parser")
    return len(bs.get_text("\n", strip=True)), len(bs.find_all("table")), "HTML"


def main():
    src = json.load(io.open(os.path.join(HERE, "recon_sample.json"), encoding="utf-8"))
    targets = [r for r in src if r.get("kind") == "본문없음" and r["nm"].startswith("[")][:10]
    print(f"검증 대상 = 「본문없음」으로 떨어진 정정공시 {len(targets)}건\n")

    if not alive():
        print("DART 웹 차단 상태 — 해제를 기다린다", flush=True)
        if not wait_unblock():
            print("!! 대기 상한 초과. 나중에 다시 실행할 것")
            return

    rows, diff_cnt, ok_cnt = [], 0, 0
    for i, r in enumerate(targets, 1):
        rcp = r["rcp"]
        pairs = att_pairs(rcp)
        if pairs is None:
            print(f"  [{i:2d}] {rcp} 첨부조회 실패(차단?)", flush=True)
            continue
        ev = [p for p in pairs if any(k in p[0].replace(" ", "") for k in ("평가의견서", "외부평가"))]
        if not ev:
            print(f"  [{i:2d}] {r['corp'][:10]:<10} 평가의견서 첨부 없음")
            continue
        nm, rcp_att, dcm = ev[0]
        differs = rcp_att != rcp
        diff_cnt += differs
        ln, ntab, kind = body(rcp_att, dcm)
        ok_cnt += (kind == "HTML" and ln > 1000)
        rows.append({"rcp": rcp, "corp": r["corp"], "rcp_att": rcp_att, "dcm": dcm,
                     "differs": differs, "chars": ln, "tables": ntab, "kind": kind})
        print(f"  [{i:2d}] {r['corp'][:10]:<10} 정정rcp={rcp} 첨부rcp={rcp_att} "
              f"{'다름✔' if differs else '같음'} → {kind} {ln:,}자", flush=True)

    io.open(os.path.join(HERE, "verify_result.json"), "w", encoding="utf-8",
            newline="\n").write(json.dumps(rows, ensure_ascii=False, indent=1))

    n = len(rows)
    print(f"\n===== 검증 결과 (시도 {n}건) =====")
    print(f"첨부 rcpNo 가 정정본과 **다른** 건: {diff_cnt}/{n}  <- 가설의 직접 증거")
    print(f"쌍으로 열어 본문 확보 성공:        {ok_cnt}/{n}  <- 목표 9/10")
    if rows:
        cs = sorted(r["chars"] for r in rows if r["chars"] > 0)
        if cs:
            print(f"글자수: 최소 {cs[0]:,} / 중앙 {cs[len(cs)//2]:,} / 최대 {cs[-1]:,}")
        from collections import Counter
        print("판정 분포:", dict(Counter(r["kind"] for r in rows)))


if __name__ == "__main__":
    main()
