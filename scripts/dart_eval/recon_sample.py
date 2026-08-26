# -*- coding: utf-8 -*-
"""Q0 정찰 4 — 최근 2년 타법인 주요사항보고서를 받고, 표본으로 첨부율·분량·산업을 잰다.

1단계: list.json (pblntf_ty=B) 최근 2년 -> '타법인' 필터
2단계: 표본 N건에 대해 main.do 의 select#att 를 열어 '평가의견서' 첨부 여부 판정
3단계: 첨부된 건은 본문을 받아 글자수·DCF 포함 여부 측정
4단계: 회사별 업종(induty_code)을 company.json 으로 조회해 산업 분포 산출
"""
import io
import json
import os
import random
import re
import sys
import time
from collections import Counter
from datetime import date, timedelta

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

SM = r"C:\Users\junghwan.yoon\workspace\1.테스트\stock_monitor"
load_dotenv(os.path.join(SM, "scripts", ".env"))
load_dotenv(os.path.join(SM, ".env.local"))
KEY = os.environ["DART_API_KEY"].strip()

HERE = os.path.dirname(os.path.abspath(__file__))
LIST_API = "https://opendart.fss.or.kr/api/list.json"
COMP_API = "https://opendart.fss.or.kr/api/company.json"

S = requests.Session()
S.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})

TREE_RE = re.compile(
    r"node\d+\['text'\]\s*=\s*\"([^\"]*)\";.*?node\d+\['rcpNo'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['dcmNo'\]\s*=\s*\"([^\"]*)\";.*?node\d+\['eleId'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['offset'\]\s*=\s*\"([^\"]*)\";.*?node\d+\['length'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['dtd'\]\s*=\s*\"([^\"]*)\";",
    re.DOTALL,
)
SAMPLE_N = int(os.environ.get("SAMPLE_N", "70"))


def fetch_list(bgn, end):
    """한 구간의 주요사항보고서 목록. status 100 이 나면 구간을 반으로 쪼개 재시도."""
    rows, page = [], 1
    while True:
        p = {"crtfc_key": KEY, "bgn_de": bgn, "end_de": end,
             "pblntf_ty": "B", "page_no": page, "page_count": 100}
        try:
            j = S.get(LIST_API, params=p, timeout=30).json()
        except Exception:
            time.sleep(2)
            continue
        st = j.get("status")
        if st == "013":
            return rows
        if st != "000":
            # 구간을 반으로 쪼개 재시도 (한 번만)
            d1 = date(int(bgn[:4]), int(bgn[4:6]), int(bgn[6:]))
            d2 = date(int(end[:4]), int(end[4:6]), int(end[6:]))
            if (d2 - d1).days > 8:
                mid = d1 + (d2 - d1) / 2
                return (fetch_list(bgn, mid.strftime("%Y%m%d"))
                        + fetch_list((mid + timedelta(days=1)).strftime("%Y%m%d"), end))
            return rows
        rows.extend(j.get("list", []))
        if page >= int(j.get("total_page", 1)):
            return rows
        page += 1
        time.sleep(0.1)


def att_docs(rcp):
    """첨부문서 [(문서명, dcmNo)]"""
    h = S.get(f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp}", timeout=30).text
    m = re.search(r'<select[^>]*id="att".*?</select>', h, re.S)
    if not m:
        return []
    out = []
    for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(0), re.S):
        d = re.search(r"dcmNo=(\d+)", v.replace("&amp;", "&"))
        if d:
            nm = re.sub(r"\s+", " ", re.sub("<[^>]+>", "", t)).replace("\xa0", " ").strip()
            out.append((nm, d.group(1)))
    return out


def doc_text(rcp, dcm):
    """(글자수, 표개수, 형식) — PDF 전용이면 글자수 0"""
    h = S.get(f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp}&dcmNo={dcm}", timeout=30).text
    nodes = TREE_RE.findall(h)
    if not nodes:
        return 0, 0, ("PDF전용" if "download.do" in h else "본문없음"), ""
    n = max(nodes, key=lambda x: int(x[5]) if str(x[5]).isdigit() else 0)
    v = (f"https://dart.fss.or.kr/report/viewer.do?rcpNo={n[1]}&dcmNo={n[2]}"
         f"&eleId={n[3]}&offset={n[4]}&length={n[5]}&dtd={n[6]}")
    rv = S.get(v, timeout=60)
    rv.encoding = rv.apparent_encoding or "utf-8"
    bs = BeautifulSoup(rv.text, "html.parser")
    txt = bs.get_text("\n", strip=True)
    return len(txt), len(bs.find_all("table")), "HTML", txt


_comp_cache = {}


def industry(corp_code):
    if corp_code in _comp_cache:
        return _comp_cache[corp_code]
    try:
        j = S.get(COMP_API, params={"crtfc_key": KEY, "corp_code": corp_code}, timeout=20).json()
        v = (j.get("induty_code") or "", j.get("corp_name") or "")
    except Exception:
        v = ("", "")
    _comp_cache[corp_code] = v
    time.sleep(0.08)
    return v


def main():
    end, cur = date(2026, 8, 26), date(2024, 8, 26)
    hits = []
    while cur < end:
        nxt = min(cur + timedelta(days=91), end)
        rows = fetch_list(cur.strftime("%Y%m%d"), nxt.strftime("%Y%m%d"))
        hits += [r for r in rows if "타법인" in r.get("report_nm", "")]
        print(f"  {cur}~{nxt} 누적 {len(hits)}건", flush=True)
        cur = nxt + timedelta(days=1)

    io.open(os.path.join(HERE, "recon_major2y.json"), "w", encoding="utf-8",
            newline="\n").write(json.dumps(hits, ensure_ascii=False, indent=1))
    print(f"\n최근 2년 타법인 주요사항보고서 = {len(hits)}건")
    print("보고서명:", dict(Counter(h["report_nm"] for h in hits)))

    random.seed(20260826)
    sample = random.sample(hits, min(SAMPLE_N, len(hits)))
    print(f"\n=== 표본 {len(sample)}건 첨부·분량 조사 ===", flush=True)

    recs = []
    for i, h in enumerate(sample, 1):
        rcp = h["rcept_no"]
        try:
            docs = att_docs(rcp)
        except Exception as e:
            print(f"  [{i}] {rcp} 첨부조회 실패 {e}")
            continue
        ev = [(nm, d) for nm, d in docs
              if any(k in nm.replace(" ", "") for k in ("평가의견서", "외부평가"))]
        rec = {"rcp": rcp, "corp": h["corp_name"], "corp_code": h["corp_code"],
               "dt": h["rcept_dt"], "nm": h["report_nm"],
               "n_att": len(docs), "has_eval": bool(ev)}
        if ev:
            try:
                ln, ntab, kind, txt = doc_text(rcp, ev[0][1])
            except Exception as e:
                ln, ntab, kind, txt = 0, 0, f"err:{e}", ""
            rec.update(chars=ln, tables=ntab, kind=kind,
                       dcf=any(k in txt for k in ("현금흐름할인", "가중평균자본비용", "DCF")),
                       wacc=("가중평균자본비용" in txt),
                       sens=("민감도" in txt))
        rec["induty"], rec["corp_full"] = industry(h["corp_code"])
        recs.append(rec)
        print(f"  [{i}/{len(sample)}] {h['corp_name'][:12]:<12} 첨부{rec['n_att']} "
              f"평가서{'O' if rec['has_eval'] else 'X'} "
              f"{rec.get('chars',0):>7}자 {rec.get('kind','')}", flush=True)
        time.sleep(0.15)

    io.open(os.path.join(HERE, "recon_sample.json"), "w", encoding="utf-8",
            newline="\n").write(json.dumps(recs, ensure_ascii=False, indent=1))

    n = len(recs)
    ev = [r for r in recs if r["has_eval"]]
    print(f"\n===== 결과 =====")
    print(f"표본 {n}건 · 평가의견서 첨부 {len(ev)}건 ({len(ev)/max(n,1)*100:.0f}%)")
    if ev:
        print("형식:", dict(Counter(r.get("kind") for r in ev)))
        cs = sorted(r.get("chars", 0) for r in ev)
        print(f"글자수: 최소 {cs[0]:,} / 중앙 {cs[len(cs)//2]:,} / 최대 {cs[-1]:,}")
        for th in (10000, 15000, 20000, 30000, 50000):
            print(f"  {th:,}자 이상: {sum(1 for c in cs if c>=th)}건 ({sum(1 for c in cs if c>=th)/len(cs)*100:.0f}%)")
        print(f"DCF 포함 {sum(1 for r in ev if r.get('dcf'))}건 · "
              f"민감도 {sum(1 for r in ev if r.get('sens'))}건")
    print("\n업종코드(KSIC) 상위:")
    for k, c in Counter(r["induty"][:2] for r in recs if r["induty"]).most_common(15):
        print(f"  {k}xxx: {c}건")


if __name__ == "__main__":
    main()
