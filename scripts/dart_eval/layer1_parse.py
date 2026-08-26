# -*- coding: utf-8 -*-
"""층1 실증 — 본문 XML(document.xml)에서 「8. 외부평가에 관한 사항」을 파싱한다.

계획서의 핵심 가정("웹 없이 OpenAPI만으로 게이트·파라미터를 얻는다")을 표본으로 검증한다.
"""
import io
import json
import os
import re
import sys
import time
import zipfile
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import requests
from dotenv import load_dotenv

SM = r"C:\Users\junghwan.yoon\workspace\1.테스트\stock_monitor"
load_dotenv(os.path.join(SM, "scripts", ".env"))
load_dotenv(os.path.join(SM, ".env.local"))
KEY = os.environ["DART_API_KEY"].strip()
HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://opendart.fss.or.kr/api/document.xml"

PCT = r"\d{1,3}(?:\.\d+)?%"


def strip_tags(x: str) -> str:
    x = re.sub(r"<[^>]+>", "\n", x)
    x = re.sub(r"&[a-zA-Z]+;|&#\d+;", " ", x)
    return re.sub(r"[ \t]+", " ", x)


def fetch_xml(rcp: str) -> str | None:
    for i in range(3):
        try:
            r = requests.get(API, params={"crtfc_key": KEY, "rcept_no": rcp}, timeout=60)
        except Exception:
            time.sleep(2 * (i + 1))
            continue
        if r.content[:2] != b"PK":
            return None
        path = os.path.join(HERE, "_tmp.zip")
        io.open(path, "wb").write(r.content)
        with zipfile.ZipFile(path) as z:
            n = [x for x in z.namelist() if x.lower().endswith(".xml")]
            if not n:
                return None
            raw = z.read(n[0])
        for enc in ("utf-8", "cp949", "euc-kr"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", "replace")
    return None


def parse(xml: str) -> dict:
    """「8. 외부평가에 관한 사항」 블록에서 값을 뽑는다."""
    t = strip_tags(xml)
    lines = [l.strip() for l in t.split("\n") if l.strip()]
    out = {}

    def after(label, span=4):
        """라벨 줄 다음의 실질 값을 돌려준다."""
        for i, l in enumerate(lines):
            if l.replace(" ", "") == label.replace(" ", ""):
                for k in range(1, span + 1):
                    if i + k < len(lines) and lines[i + k] != label:
                        return lines[i + k]
        return None

    out["eval_yn"] = after("외부평가 여부")
    out["agency"] = after("외부평가기관의 명칭")
    out["period"] = after("외부평가 기간")
    # 평가의견은 길다 — 라벨 뒤 가장 긴 줄
    op = None
    for i, l in enumerate(lines):
        if l.replace(" ", "") == "외부평가의견":
            cand = [x for x in lines[i + 1:i + 6] if len(x) > 60]
            if cand:
                op = max(cand, key=len)
            break
    out["opinion"] = op

    if op:
        out["method_dcf"] = bool(re.search(r"현금흐름할인|DCF", op))
        out["method_asset"] = "순자산" in op or "자산가치" in op
        out["method_market"] = "상대가치" in op or "유사기업" in op or "시장가치" in op
        wacc = re.findall(r"가중평균자본비용[^)]{0,40}?(" + PCT + r")\s*~\s*(" + PCT + r")", op)
        out["wacc_range"] = wacc[0] if wacc else None
        w1 = re.findall(r"가중평균자본비용\s*(" + PCT + r")", op)
        out["wacc_point"] = w1[0] if w1 else None
        g = re.findall(r"영구성장률[^)]{0,30}?\(?\-?\)?\s*(-?\d{1,2}(?:\.\d+)?%)\s*~\s*\(?\-?\)?\s*(-?\d{1,2}(?:\.\d+)?%)", op)
        out["growth_range"] = g[0] if g else None
        vals = re.findall(r"([\d,]{4,})\s*백만원", op)
        out["values_mn"] = vals[:6]
    # 거래금액
    for lb in ("양수금액", "양도금액", "취득금액", "처분금액", "거래대금"):
        v = after(lb)
        if v and re.search(r"\d", v):
            out["deal_amount_raw"] = f"{lb}={v}"
            break
    return out


def main():
    src = json.load(io.open(os.path.join(HERE, "recon_major2y.json"), encoding="utf-8"))
    import random
    random.seed(826)
    sample = random.sample(src, 20)
    recs = []
    for i, h in enumerate(sample, 1):
        rcp = h["rcept_no"]
        xml = fetch_xml(rcp)
        if xml is None:
            print(f"  [{i:2d}] {rcp} zip 실패")
            continue
        d = parse(xml)
        d.update(rcp=rcp, corp=h["corp_name"], nm=h["report_nm"], dt=h["rcept_dt"])
        recs.append(d)
        print(f"  [{i:2d}] {h['corp_name'][:10]:<10} 평가={d.get('eval_yn')} "
              f"기관={str(d.get('agency'))[:12]:<12} WACC={d.get('wacc_range') or d.get('wacc_point')} "
              f"g={d.get('growth_range')}", flush=True)
        time.sleep(0.25)

    io.open(os.path.join(HERE, "layer1_sample.json"), "w", encoding="utf-8",
            newline="\n").write(json.dumps(recs, ensure_ascii=False, indent=1))

    n = len(recs)
    yes = [r for r in recs if r.get("eval_yn") == "예"]
    print(f"\n===== 층1 실증 결과 (표본 {n}건) =====")
    print(f"외부평가 여부 파싱 성공: {sum(1 for r in recs if r.get('eval_yn')) }건")
    print(f"  '예' {len(yes)}건 / '아니오' {sum(1 for r in recs if r.get('eval_yn')=='아니오')}건")
    print(f"평가기관명 확보: {sum(1 for r in recs if r.get('agency'))}건")
    print(f"평가의견 전문 확보: {sum(1 for r in recs if r.get('opinion'))}건")
    print(f"WACC(범위 or 점): {sum(1 for r in recs if r.get('wacc_range') or r.get('wacc_point'))}건")
    print(f"영구성장률 범위: {sum(1 for r in recs if r.get('growth_range'))}건")
    print(f"DCF 적용: {sum(1 for r in recs if r.get('method_dcf'))}건")
    print("\n평가기관 분포:", dict(Counter(r.get("agency") for r in recs if r.get("agency"))))


if __name__ == "__main__":
    main()
