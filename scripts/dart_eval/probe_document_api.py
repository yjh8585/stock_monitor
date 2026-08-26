# -*- coding: utf-8 -*-
"""Q0-잔여 규명 — OpenDART 공식 `document.xml` API 로 원본 zip 을 받아
「본문없음」으로 떨어진 건의 실제 형식을 확인한다.

웹 화면(dart.fss.or.kr)이 아니라 OpenAPI(opendart.fss.or.kr)를 쓰므로
IP 차단과 무관하고, 첨부문서까지 들어오는지도 여기서 판별된다.
"""
import io
import os
import sys
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

# 표본조사에서 「본문없음」으로 떨어진 건 + 성공한 건(대조군)
FAIL = ["20251229000318", "20260401000003", "20250731000374", "20260109000275", "20241231000363"]
OK = ["20260824000316"]


def probe(rcp: str, tag: str):
    r = requests.get(API, params={"crtfc_key": KEY, "rcept_no": rcp}, timeout=60)
    ct = r.headers.get("Content-Type", "")
    body = r.content
    print(f"\n=== [{tag}] rcpNo={rcp} ===")
    print(f"  HTTP {r.status_code} · {ct} · {len(body):,} bytes")

    # zip 이 아니면 에러 XML 이 온다
    if not body[:2] == b"PK":
        print("  !! zip 아님:", body[:300].decode("utf-8", "replace"))
        return

    path = os.path.join(HERE, f"doc_{rcp}.zip")
    io.open(path, "wb").write(body)
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        print(f"  zip 내부 {len(names)}개 파일:")
        for n in names:
            info = z.getinfo(n)
            print(f"    {info.file_size:>10,}B  {n}")
        # 첫 XML 을 열어 앞머리를 본다
        for n in names:
            if n.lower().endswith((".xml", ".html", ".htm")):
                raw = z.read(n)
                for enc in ("utf-8", "cp949", "euc-kr"):
                    try:
                        txt = raw.decode(enc)
                        break
                    except UnicodeDecodeError:
                        continue
                else:
                    txt = raw.decode("utf-8", "replace")
                io.open(os.path.join(HERE, f"doc_{rcp}_{os.path.basename(n)}.txt"),
                        "w", encoding="utf-8", newline="\n").write(txt)
                print(f"  -- {n}: {len(txt):,}자")
                # 평가의견서 흔적 찾기
                for kw in ("평가의견서", "외부평가", "가중평균자본비용", "현금흐름할인", "무위험이자율"):
                    print(f"     '{kw}' {txt.count(kw)}회")
                print("     앞머리:", txt[:200].replace("\n", " "))
                break


def main():
    for rcp in OK:
        probe(rcp, "성공 대조군")
    for rcp in FAIL:
        probe(rcp, "본문없음")


if __name__ == "__main__":
    main()
