# -*- coding: utf-8 -*-
"""Q1a 층1 전수 스캔 — 5년치 「타법인주식및출자증권」 공시의 본문 XML을 훑어
   「8. 외부평가에 관한 사항」을 파싱하고 파라미터 대장을 만든다.

계획서 = agents 레포 `docs/superpowers/specs/2026-08-25-ma-knowledge-wiki.md`
        「확장 갈래 — DART 외부기관평가의견서 수집」 Q1a

이 층의 역할(계획서 「층1의 역할 재정의」)
  ① 게이트로 약 1,800건 -> 수백 건으로 압축한다
  ② 「평가액 대비 몇 %에 샀나」 통계를 전수로 만든다
  ⚠️ WACC·영구성장률은 여기서 거의 안 나온다(실측 0~1/20) — 층2(웹 정독)에서 채운다

🔴 웹(dart.fss.or.kr)을 전혀 건드리지 않는다. OpenAPI(opendart.fss.or.kr)만 쓰므로
   IP 차단과 무관하다. 정찰에서 웹은 0.15초 간격에 차단당했고 26분 뒤 풀렸다.

DB를 쓰지 않는다(조회 전용 · 산출은 JSON 파일). 따라서 `WriteSession` 대상이 아니다.

실행:
  ./scripts/venv/Scripts/python.exe -X utf8 -u scripts/dart_eval/scan_all.py
  옵션: --years 5 (기본) · --refresh-list (목록 캐시 무시) · --limit N (시험용)

산출:
  scan_all_list.json                          공시 목록 캐시(재실행 시 API 재호출 안 함)
  scan_all_raw.jsonl                          건별 파싱 결과(중단돼도 이어서 돌린다)
  agents/docs/data/ma-valuation-params.json   🔴 파라미터 대장(계획서가 지정한 산출물)
"""
import argparse
import io
import json
import os
import re
import sys
import time
import zipfile
from collections import Counter
from datetime import date, timedelta

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)  # scripts/.env + 루트 .env.local 을 둘 다 로드한다

import requests  # noqa: E402

KEY = os.environ["DART_API_KEY"].strip()
HERE = os.path.dirname(os.path.abspath(__file__))
SM = os.path.dirname(os.path.dirname(HERE))

# 대장은 agents 레포로 넘긴다(계획서 결정 11 — 수집기는 stock_monitor, 산출은 agents)
AGENTS = os.path.join(os.path.dirname(SM), "agents")
LEDGER = os.path.join(AGENTS, "docs", "data", "ma-valuation-params.json")

LIST_API = "https://opendart.fss.or.kr/api/list.json"
DOC_API = "https://opendart.fss.or.kr/api/document.xml"
COMP_API = "https://opendart.fss.or.kr/api/company.json"
GAP = 0.25  # OpenAPI 요청 간격(초). 일일 한도 20,000건 안쪽

S = requests.Session()
S.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})

PCT = r"-?\d{1,3}(?:\.\d+)?%"


# ─────────────────────────────── 1단계: 공시 목록 ───────────────────────────────

def fetch_list(bgn: str, end: str) -> list:
    """한 구간의 주요사항보고서 목록. status 100(구간 과다)이면 반으로 쪼개 재시도."""
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
        if st == "013":  # 조회 결과 없음
            return rows
        if st != "000":
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


def collect_list(years: int) -> list:
    """N년치 「타법인」 공시를 모은다. 91일씩 끊어 훑는다(구간이 길면 API가 거부한다)."""
    end = date.today()
    cur = end - timedelta(days=365 * years)
    hits = []
    while cur < end:
        nxt = min(cur + timedelta(days=91), end)
        rows = fetch_list(cur.strftime("%Y%m%d"), nxt.strftime("%Y%m%d"))
        hits += [r for r in rows if "타법인" in r.get("report_nm", "")]
        print(f"  {cur} ~ {nxt}  누적 {len(hits)}건", flush=True)
        cur = nxt + timedelta(days=1)
    return hits


# ─────────────────────────────── 2단계: 본문 XML 파싱 ───────────────────────────────

def strip_tags(x: str) -> str:
    x = re.sub(r"<[^>]+>", "\n", x)
    x = re.sub(r"&[a-zA-Z]+;|&#\d+;", " ", x)
    return re.sub(r"[ \t]+", " ", x)


def fetch_xml(rcp: str) -> str | None:
    """원본 zip(document.xml)을 받아 본문 XML 문자열로 돌려준다."""
    for i in range(3):
        try:
            r = S.get(DOC_API, params={"crtfc_key": KEY, "rcept_no": rcp}, timeout=60)
        except Exception:
            time.sleep(2 * (i + 1))
            continue
        if r.content[:2] != b"PK":  # zip 이 아니면 오류 응답(XML 에러 메시지)
            return None
        try:
            with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                names = [x for x in z.namelist() if x.lower().endswith(".xml")]
                if not names:
                    return None
                raw = z.read(names[0])
        except zipfile.BadZipFile:
            return None
        for enc in ("utf-8", "cp949", "euc-kr"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", "replace")
    return None


def _num(s: str) -> float | None:
    """'1,524' -> 1524.0. 쉼표만 걷어낸다."""
    try:
        return float(s.replace(",", ""))
    except (ValueError, AttributeError):
        return None


def _norm(s: str) -> str:
    """라벨 비교용 정규화 — 공백·괄호·중점·마침표를 지운다.
    🔴 정찰에서 파싱 실패 4/20(20%)이 전부 서식 차이였다(라벨 표기가 조금씩 다르다).
       정확 일치 대신 정규화 후 앞부분 일치로 잡는다."""
    return re.sub(r"[\s()·.\-]", "", s or "")


def parse(xml: str) -> dict:
    """「8. 외부평가에 관한 사항」 블록에서 값을 뽑는다."""
    lines = [l.strip() for l in strip_tags(xml).split("\n") if l.strip()]
    norm = [_norm(l) for l in lines]
    out: dict = {}

    def after(labels, span: int = 5):
        """라벨 줄 다음의 실질 값. labels 중 하나라도 걸리면 된다."""
        keys = [_norm(x) for x in labels]
        for i, nl in enumerate(norm):
            if not any(k and nl.startswith(k) for k in keys):
                continue
            for j in range(1, span + 1):
                if i + j >= len(lines):
                    break
                if norm[i + j] in keys:
                    continue
                return lines[i + j]
        return None

    out["eval_yn"] = after(["외부평가 여부", "외부평가여부"])
    out["agency"] = after(["외부평가기관의 명칭", "외부평가기관명", "평가기관의 명칭"])
    out["eval_period"] = after(["외부평가 기간", "외부평가기간"])

    # 평가의견은 길다 — 라벨 뒤 가장 긴 줄
    op = None
    for i, nl in enumerate(norm):
        if nl.startswith(_norm("외부평가의견")):
            cand = [x for x in lines[i + 1:i + 8] if len(x) > 60]
            if cand:
                op = max(cand, key=len)
            break
    out["opinion"] = op

    # 🔴 금액 필드를 **의견 파싱보다 먼저** 뽑는다 — 거래가의 정본이라 힌트로 넘겨야 한다.
    for lb in ("양수금액", "양도금액", "취득금액", "처분금액", "거래대금", "양수가액", "양도가액"):
        v = after([lb])
        if v and re.search(r"\d", v):
            out["deal_amount_raw"] = f"{lb}={v}"
            break

    if op:
        out.update(parse_opinion(op, price_from_raw(out.get("deal_amount_raw"))))
    return out


def price_from_raw(raw: str | None) -> float | None:
    """🔴 거래가의 정본 — 공시 본문의 금액 필드(`양수금액=58,000,000,000`)를 백만원으로.

    의견서 본문 정규식보다 **이쪽이 먼저다.** 본문에서 뽑으면 「평가가액」이 섞여 들어간다
    (실측 9.2% 오염 · JW생명과학 건은 평가액 하단이 거래가 자리에 있었다).

    ⚠️ 단위를 크기로 추측하지 않는다. **9자리(1억) 이상 숫자만** 후보로 보고, 없으면 None 을
       돌려 되받이 경로로 넘긴다. 「양수금액(원)(A) : 39,150,136」 처럼 단위가 애매한 표기가 있다.
    """
    if not raw:
        return None
    cands = [int(x.replace(",", "")) for x in re.findall(r"[\d,]{9,}", raw)]
    cands = [c for c in cands if c >= 10 ** 8]
    return max(cands) / 1_000_000 if cands else None


def parse_opinion(op: str, price_hint: float | None = None) -> dict:
    """평가의견 전문에서 파생 값을 뽑는다.

    🔴 본문 XML 재수신 없이 재계산할 수 있도록 **의견 전문만** 입력으로 받는다
       (`--reparse`). 정규식을 고칠 때마다 1,800건을 다시 받으면 8분씩 든다.
    """
    out: dict = {}
    if op:  # 재파싱 경로에서는 opinion 이 비어 있는 행도 들어온다
        out["method_dcf"] = bool(re.search(r"현금흐름할인|DCF", op))
        out["method_asset"] = ("순자산" in op) or ("자산가치" in op)
        out["method_market"] = ("상대가치" in op) or ("유사기업" in op) or ("시장가치" in op)
        # 🔴 WACC 는 「가중평균자본비용」으로도, 그냥 「할인율」로도 쓴다.
        #    실물 예: "평가액은 6,055백만원(할인율 14.45%, 영구성장률 0%) 에서
        #             7,098백만원(할인율 12.45%, 영구성장률 0%) 의 범위"
        #    → 할인율만 쓰는 의견서를 놓치면 층1의 WACC 확보율이 0에 가깝게 나온다.
        w = re.findall(r"가중평균자본비용[^)]{0,40}?(" + PCT + r")\s*[~∼-]\s*(" + PCT + r")", op)
        if w:
            out["wacc_range"] = list(w[0])
        else:
            disc = re.findall(r"(?:가중평균자본비용|할인율)\s*[은는:]?\s*(" + PCT + r")", op)
            uniq_d = list(dict.fromkeys(disc))
            if len(uniq_d) >= 2:
                out["wacc_range"] = [uniq_d[0], uniq_d[1]]
            elif uniq_d:
                out["wacc_point"] = uniq_d[0]

        g = re.findall(r"영구성장률[^)]{0,30}?\(?\s*(" + PCT + r")\s*[~∼-]\s*\(?\s*(" + PCT + r")", op)
        if g:
            out["growth_range"] = list(g[0])
        else:
            g1 = list(dict.fromkeys(re.findall(r"영구성장률\s*[은는:]?\s*(" + PCT + r")", op)))
            if len(g1) >= 2:
                out["growth_range"] = [g1[0], g1[1]]
            elif g1:
                out["growth_point"] = g1[0]
        # 평가액 후보 — 백만원 단위 금액을 앞에서부터
        out["values_mn"] = re.findall(r"([\d,]{4,})\s*백만원", op)[:8]

        # 🔴 이 층의 핵심 산출물 — 「평가액 대비 몇 %에 샀나」
        #    평가액 범위가 여러 번 나오면(대상자산이 둘 이상) **마지막 = 합산 범위**를 쓴다.
        #    실물 예: "…이알 1,524~1,665 … ER VINA 5,567~6,320 … 합산은 7,091~7,985"
        #    🔴 구분자가 「~」가 아니라 **「에서」**인 의견서가 더 많다. 그리고 금액과 구분자
        #       사이에 괄호(할인율·영구성장률·환율 주석)가 끼어든다. 실물 3종:
        #         "평가액은 6,055백만원(할인율 14.45%…) **에서** 7,098백만원(…) 의 범위"
        #         "33,343 천CAD에서 37,711 천CAD(**33,530 백만원에서 37,922 백만원**, 환율…)"
        #         "가치는 226,865백만원**에서** 267,851백만원의 범위로"
        #       → 「에서」를 안 넣으면 이 층의 핵심 산출물이 대부분 빈다.
        # 🔴 `[^.]`(마침표 제외)를 쓰면 **소수점에서 매칭이 끊긴다.** 실물:
        #      "대상 주식의 평가액(지분 15.36% 기준)은 59,046백만원 ~ 64,771백만원"
        #    `15.36` 의 소수점 때문에 이 두 번째 범위를 통째로 놓쳐 회사 전체 범위와
        #    지분 거래가를 맞대는 오류가 났다(비보존 제약 15.1% ← 정답 97%).
        #    문장 경계는 마침표가 아니라 **길이 상한(80자)**으로 지킨다.
        rng = re.findall(
            r"(?:평가액|평가금액|주식가치|가치).{0,80}?([\d,]{3,})\s*백만\s*원?"
            r"\s*(?:\([^)]{0,80}\))?\s*(?:에서|부터|~|∼|-)\s*"
            r"([\d,]{3,})\s*백만\s*원?", op)
        # 실제 거래가액 (범위 선택보다 먼저 뽑는다)
        # 🔴 1순위는 **공시 본문의 금액 필드**(`price_hint`)다. 본문 정규식은 되받이일 뿐이다.
        #    옛 정규식은 앞부분이 선택이라 **「평가가액」까지 걸려** 평가액이 거래가 자리에
        #    들어갔다(실측 9.2% 오염). 앞부분을 **필수**로 바꿔 그 경로를 막는다.
        if price_hint is not None:
            out["deal_price_mn"] = price_hint
        else:
            pr = re.findall(
                r"(?:양수도?|양도|취득|처분|거래)\s*(?:예정)?\s*가액.{0,20}?([\d,]{3,})"
                r"\s*백만\s*원?", op)
            if pr:
                out["deal_price_mn"] = _num(pr[-1])

        # 🔴 범위가 여러 개 나오면 **거래가가 실제로 들어가는 범위**를 고른다.
        #    의견서는 회사 **전체** 가치와 **취득 지분분** 가치를 함께 적는다. 실물:
        #      "평가액은 384,412~412,686백만원 … 대상 주식의 평가액(지분 15.36% 기준)은
        #       59,046~64,771백만원 … 양수도예정가액 60,221백만원"
        #    전체 범위와 지분 거래가를 맞대면 15%처럼 터무니없는 값이 나온다(정답 97%).
        #    의견서의 결론이 "거래가가 이 범위 안이라 적정하다"이므로 그 규칙이 의미상으로도 옳다.
        price = out.get("deal_price_mn")
        cands = [(_num(a), _num(b)) for a, b in rng]
        cands = [(a, b) for a, b in cands if a and b and a <= b]
        if cands:
            pick = None
            if price:
                inside = [c for c in cands if c[0] <= price <= c[1]]
                if inside:
                    pick = min(inside, key=lambda c: c[1] - c[0])  # 가장 좁은 범위
            if pick is None:
                pick = cands[-1]
            out["eval_low_mn"], out["eval_high_mn"] = pick
            out["eval_range_count"] = len(cands)

        lo, hi, pv = out.get("eval_low_mn"), out.get("eval_high_mn"), out.get("deal_price_mn")
        if lo and hi and pv:
            mid = (lo + hi) / 2
            if mid:
                # 평가 중앙값 대비 실제 거래가 비율(%). 100 이면 중앙값에 산 것
                out["price_vs_eval_pct"] = round(pv / mid * 100, 1)
                out["within_range"] = lo <= pv <= hi
                # 범위 폭 — 넓으면 그 평가 자체가 헐거운 것이다(예림당 = 하단의 4.3배)
                out["range_width_x"] = round(hi / lo, 2) if lo else None
    return out


_comp_cache: dict = {}


def industry(corp_code: str) -> str:
    """회사의 업종코드(KSIC). 계획서가 정한 산업 버킷의 근거다."""
    if corp_code in _comp_cache:
        return _comp_cache[corp_code]
    try:
        j = S.get(COMP_API, params={"crtfc_key": KEY, "corp_code": corp_code}, timeout=20).json()
        v = j.get("induty_code") or ""
    except Exception:
        v = ""
    _comp_cache[corp_code] = v
    time.sleep(0.08)
    return v


# ─────────────────────────────── 3단계: dedup ───────────────────────────────

CORRECTION_RE = re.compile(r"\[(기재정정|첨부정정|첨부추가|정정)\]")


def dedup_key(row: dict) -> str:
    """회사 + 거래 성격으로 묶는다. 🔴 정정본이 41%이고 같은 딜이 여러 번 올라온다.
    보고서명에서 정정 표식과 공백을 걷어내면 원공시와 정정본이 같은 키로 모인다."""
    nm = CORRECTION_RE.sub("", row.get("report_nm", ""))
    nm = re.sub(r"\s+", "", nm)
    return f"{row.get('corp_code', '')}|{nm}"


def mark_latest(rows: list) -> None:
    """dedup 키별로 접수일이 가장 늦은 것에 is_latest 를 세운다.
    🔴 「정정본을 버린다」가 아니라 「정정본을 최신본으로 남긴다」 — 재확보 실측에서
       정정본이 원본보다 두꺼웠다(중앙 20,386자 · 최대 65,559자)."""
    best: dict = {}
    for r in rows:
        k = r["dedup_key"]
        if k not in best or r["dt"] > best[k]["dt"]:
            best[k] = r
    for r in rows:
        r["is_latest"] = best[r["dedup_key"]] is r


# ─────────────────────────────── 실행 ───────────────────────────────

def load_done(path: str) -> dict:
    """중단된 실행을 이어 돌리기 위해 기존 결과를 읽는다."""
    done: dict = {}
    if os.path.exists(path):
        with io.open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                done[r["rcp"]] = r
    return done


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=5)
    ap.add_argument("--refresh-list", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="시험용 — 앞의 N건만 처리")
    ap.add_argument("--reparse", action="store_true",
                    help="🔴 API 재호출 없이 저장된 의견 전문으로 파생값만 다시 계산한다. "
                         "정규식을 고칠 때마다 2,000건을 다시 받으면 8분씩 든다")
    args = ap.parse_args()

    list_path = os.path.join(HERE, "scan_all_list.json")
    raw_path = os.path.join(HERE, "scan_all_raw.jsonl")

    # 1단계 — 목록
    if args.refresh_list or not os.path.exists(list_path):
        print(f"[1/3] 최근 {args.years}년 「타법인」 공시 목록 수집")
        hits = collect_list(args.years)
        io.open(list_path, "w", encoding="utf-8", newline="\n").write(
            json.dumps(hits, ensure_ascii=False, indent=1))
    else:
        hits = json.load(io.open(list_path, encoding="utf-8"))
        print(f"[1/3] 목록 캐시 사용 — {len(hits)}건 (새로 받으려면 --refresh-list)")

    # 접수일 오름차순 · 중복 접수번호 제거
    seen, uniq = set(), []
    for h in sorted(hits, key=lambda x: x.get("rcept_dt", "")):
        if h["rcept_no"] in seen:
            continue
        seen.add(h["rcept_no"])
        uniq.append(h)
    if args.limit:
        uniq = uniq[:args.limit]
    print(f"      대상 {len(uniq)}건")

    # 2단계 — 본문 XML 전수 파싱 (중단돼도 이어서)
    done = load_done(raw_path)

    if args.reparse:
        # 저장된 의견 전문으로 파생값만 재계산하고 raw 를 덮어쓴다(API 호출 0회)
        n = 0
        for rec in done.values():
            op = rec.get("opinion")
            if not op:
                continue
            for k in ("wacc_range", "wacc_point", "growth_range", "growth_point",
                      "eval_low_mn", "eval_high_mn", "deal_price_mn",
                      "price_vs_eval_pct", "within_range", "range_width_x",
                      "eval_range_count", "values_mn"):
                rec.pop(k, None)
            rec.update(parse_opinion(op, price_from_raw(rec.get("deal_amount_raw"))))
            n += 1
        with io.open(raw_path, "w", encoding="utf-8", newline="\n") as f:
            for rec in done.values():
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"[2/3] 재파싱 — 의견 전문 {n}건 재계산 (API 호출 0회)")

    todo = [] if args.reparse else [h for h in uniq if h["rcept_no"] not in done]
    if not args.reparse:
        print(f"[2/3] 본문 XML 파싱 — 남은 {len(todo)}건 (완료 {len(done)}건)")
    with io.open(raw_path, "a", encoding="utf-8", newline="\n") as fout:
        for i, h in enumerate(todo, 1):
            rcp = h["rcept_no"]
            xml = fetch_xml(rcp)
            rec = {"rcp": rcp, "corp": h.get("corp_name", ""),
                   "corp_code": h.get("corp_code", ""), "dt": h.get("rcept_dt", ""),
                   "report_nm": h.get("report_nm", "")}
            rec.update(parse(xml) if xml else {"fetch_fail": True})
            fout.write(json.dumps(rec, ensure_ascii=False) + "\n")
            fout.flush()
            done[rcp] = rec
            if i % 50 == 0:
                print(f"      {i}/{len(todo)}", flush=True)
            time.sleep(GAP)

    # 3단계 — 업종 + dedup + 대장
    rows = [done[h["rcept_no"]] for h in uniq if h["rcept_no"] in done]
    codes = {r["corp_code"] for r in rows if r.get("corp_code")}
    print(f"[3/3] 업종코드 조회 {len(codes)}개사 · dedup · 대장 작성")
    for r in rows:
        r["induty"] = industry(r["corp_code"]) if r.get("corp_code") else ""
        r["is_correction"] = bool(CORRECTION_RE.search(r.get("report_nm", "")))
        r["dedup_key"] = dedup_key(r)
    mark_latest(rows)

    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)
    io.open(LEDGER, "w", encoding="utf-8", newline="\n").write(json.dumps({
        "source": "층1 — DART OpenAPI document.xml 「8. 외부평가에 관한 사항」",
        "years": args.years,
        "total": len(rows),
        "rows": rows,
    }, ensure_ascii=False, indent=1))

    # ── 통계 (검증 기준 대조) ──
    latest = [r for r in rows if r.get("is_latest")]
    n_corr = sum(1 for r in rows if r["is_correction"])
    yes = [r for r in latest if (r.get("eval_yn") or "").startswith("예")]
    n_agency = sum(1 for r in latest if r.get("agency"))
    n_op = sum(1 for r in latest if r.get("opinion"))
    n_val = sum(1 for r in latest if r.get("values_mn"))
    n_wacc = sum(1 for r in latest if r.get("wacc_range") or r.get("wacc_point"))
    n_g = sum(1 for r in latest if r.get("growth_range"))
    n_deal = sum(1 for r in latest if r.get("deal_amount_raw"))
    fail = sum(1 for r in rows if r.get("fetch_fail"))

    print("\n===== 층1 전수 스캔 결과 =====")
    print(f"공시 {len(rows)}건 · 본문 확보 실패 {fail}건")
    print(f"정정본 {n_corr}건 ({n_corr / max(len(rows), 1) * 100:.0f}%)")
    print(f"dedup 후 최신본 {len(latest)}건")
    print(f"  외부평가 '예'      {len(yes)}건")
    print(f"  평가기관 명칭      {n_agency}건")
    print(f"  평가의견 전문      {n_op}건")
    print(f"  평가액(백만원)     {n_val}건   <- 「평가액 대비 몇 %에 샀나」 재료")
    print(f"  거래금액           {n_deal}건")
    print(f"  WACC               {n_wacc}건   (층1에서는 원래 거의 안 나온다)")
    print(f"  영구성장률         {n_g}건")

    # 🔴 이 층의 핵심 통계 — 평가액 대비 실제 거래가
    pv = [r["price_vs_eval_pct"] for r in latest if r.get("price_vs_eval_pct")]
    if pv:
        pv.sort()
        inside = sum(1 for r in latest if r.get("within_range") is True)
        print(f"\n🔴 평가액 대비 실제 거래가 — 산출 {len(pv)}건")
        print(f"   중앙 {pv[len(pv) // 2]}% · 최소 {pv[0]}% · 최대 {pv[-1]}%")
        print(f"   평가액 범위 **안**에서 거래된 건: {inside}건 "
              f"({inside / len(pv) * 100:.0f}%)")
        for th, lab in ((90, "90% 미만(범위 하단 이하)"), (100, "100% 미만(중앙값 이하)"),
                        (110, "110% 이상")):
            c = sum(1 for x in pv if (x < th if th <= 100 else x >= th))
            print(f"   {lab}: {c}건")
    print("\n🔴 검증 기준(계획서 「검증 기준」 7번) — 평가기관 800행 이상: "
          f"{'통과' if n_agency >= 800 else f'미달({n_agency})'}")
    print("\n평가기관 상위 15:")
    for k, c in Counter(r["agency"] for r in latest if r.get("agency")).most_common(15):
        print(f"  {c:4d}  {k}")
    print("\n업종(KSIC 앞 2자리) 상위 15:")
    for k, c in Counter(r["induty"][:2] for r in latest if r.get("induty")).most_common(15):
        print(f"  {c:4d}  {k}xxx")
    print(f"\n대장: {LEDGER}")


if __name__ == "__main__":
    main()
