"""M&A 딜별 DART 정형 메타를 모은다 — 외부평가 사후추인 판정의 「문서 밖」 재료.

🔴 **왜 웹 검색이 아니라 여기인가** (2026-08-28 실측 파일럿):
퍼플렉시티로 「삼도회계법인 중앙제어 감사인」을 물으니 **나무위키 문서와 무관 기업 3건**이 왔다.
감사인·최대주주·임원은 **웹 기사에 실릴 종류의 사실이 아니다** — DART 정형 API 가 정본이다.
반대로 「첫 보도 시점」·「딜 이후 후일담」은 웹이 강했다. 그래서 원천을 갈랐다.

받는 것 4종 (전부 동작 실측 확인):
  accnutAdtorNmNdAdtOpinion  감사인·감사의견   → 평가기관 ↔ 감사인 일치(이해상충)
  hyslrSttus                 최대주주 현황     → 같은 그룹 내 거래인가
  exctvSttus                 임원 현황+경력    → 대표이사 겸직
  hyslrChgSttus              최대주주 변동     → 딜 전후 지배구조 변화

⚠️ 대장의 `corp_code` 는 **공시자**의 것이다. 평가 대상이 비상장이면 그쪽은 못 얻는다.
   다만 이해상충의 핵심은 **평가기관을 선임한 쪽**(=공시자)이므로 목적에는 맞는다.

쓰는 법:
  python -X utf8 fetch_deal_meta.py            # 88건 수집 → agents/docs/data/ma-deal-meta.json
  python -X utf8 fetch_deal_meta.py --summary  # 수집 결과 요약만 다시 본다
"""
import argparse
import io
import json
import os
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
SM_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
AGENTS = r"C:\Users\junghwan.yoon\workspace\1.테스트\agents"
LEDGER = os.path.join(AGENTS, "docs", "data", "ma-valuation-params.json")
OUT = os.path.join(AGENTS, "docs", "data", "ma-deal-meta.json")

BASE = "https://opendart.fss.or.kr/api"
# 초당 호출 제한이 있다. 딜당 4회 × 88 = 352회 → 약 2분.
SLEEP = 0.3


def load_key() -> str:
    """DART API 키를 찾는다. 못 찾으면 경로를 알려주며 멈춘다."""
    key = os.environ.get("DART_API_KEY")
    if key:
        return key.strip()
    for name in (".env", ".env.local"):
        path = os.path.join(SM_ROOT, name)
        if not os.path.exists(path):
            continue
        for line in io.open(path, encoding="utf-8"):
            if line.startswith("DART_API_KEY"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"DART_API_KEY 를 못 찾았다 — 환경변수 또는 {SM_ROOT}\\.env")


def clean_opinion(opinion: str) -> str:
    """감사의견 문자열에서 판정에 쓸 핵심어만 남긴다.

    🔴 실측(2026-08-28): DART 는 각주와 연결/별도 표기를 같은 칸에 섞어 준다 —
       "적정의견\\n주1)" · "의견거절\\n(*1,*2)" · "(연결) 적정\\n(별도) 적정".
       걷어내지 않으면 「적정인데 적정이 아닌 것」으로 잡히는 오탐이 난다(실제로 2건 났다).
    """
    import re
    s = " ".join((opinion or "").split())
    s = re.sub(r"\(\*[^)]*\)|주\d+\)|\(연결\)|\(별도\)|\(당기\)|\(전기\)", " ", s)
    s = " ".join(s.split())
    # 🔴 순서가 중요하다 — "의견거절" 이 "적정" 보다 먼저 걸려야 한다
    for kw in ("의견거절", "부적정", "한정", "적정"):
        if kw in s:
            return kw
    return s


def normalize_audit(rows: list) -> list:
    """감사인 응답을 정규화한다.

    🔴 실측에서 나온 함정 넷:
      ① 기수 표기에 줄바꿈이 든다("제55기\\n(당기)")
      ② 의견 표기가 "적정"/"적정의견" 으로 갈린다
      ③ 값이 "-" 인 회사가 있다(키이스트) — 빈 문자열로만 두면 「수집 안 함」과 구분이 안 된다
      ④ "의견거절" 에서 "의견" 을 지우면 "거절" 이 되어 **뜻이 바뀐다**(비케이탑스 2021)
    """
    out = []
    for r in rows:
        adtor = (r.get("adtor") or "").strip()
        opinion = (r.get("adt_opinion") or "").strip()
        if adtor == "-":
            adtor = ""
        if opinion == "-":
            opinion = ""
        norm = clean_opinion(opinion)
        out.append({
            "bsns_year": "".join((r.get("bsns_year") or "").split()),
            "adtor": adtor,
            "adt_opinion": opinion,
            "opinion_norm": norm,
            "missing": adtor == "",
        })
    return out


def call(key: str, api: str, corp_code: str, year: str) -> list:
    """DART 정형 API 하나를 부른다. 실패하면 빈 배열(예외를 삼키지 않고 이유를 찍는다)."""
    url = (f"{BASE}/{api}.json?crtfc_key={key}&corp_code={corp_code}"
           f"&bsns_year={year}&reprt_code=11011")
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # 네트워크·타임아웃
        print(f"    ! {api} 예외 {exc}")
        return []
    if data.get("status") != "000":
        return []
    return data.get("list") or []


def slim_holders(rows: list) -> list:
    """최대주주 현황에서 합계 행을 뺀다(「계」 행은 관계 판정에 쓸모가 없다)."""
    out = []
    for r in rows:
        name = (r.get("nm") or "").strip()
        if name in ("계", "-", ""):
            continue
        out.append({
            "nm": name,
            "relate": (r.get("relate") or "").strip(),
            "qota_rt": (r.get("trmend_posesn_stock_qota_rt") or "").strip(),
        })
    return out


def slim_execs(rows: list) -> list:
    """임원 현황을 줄인다. 🔴 경력(main_career)은 겸직 판정의 핵심이라 남긴다."""
    out = []
    for r in rows:
        out.append({
            "nm": (r.get("nm") or "").strip(),
            "ofcps": (r.get("ofcps") or "").strip(),
            "chrg_job": " ".join((r.get("chrg_job") or "").split()),
            "career": " ".join((r.get("main_career") or "").split())[:400],
        })
    return out


def slim_changes(rows: list) -> list:
    out = []
    for r in rows:
        out.append({
            "change_on": (r.get("change_on") or "").strip(),
            "mxmm_shrholdr_nm": (r.get("mxmm_shrholdr_nm") or "").strip(),
            "qota_rt": (r.get("qota_rt") or "").strip(),
            "change_cause": (r.get("change_cause") or "").strip(),
        })
    return out


def load_targets() -> list:
    """대장에서 **의견서를 실제로 받은** 딜만 고른다.

    ⚠️ 대장 회사명 키는 `corp` 다 — `corp_name` 이 아니다(2026-08-28 실측으로 잡았다).
    """
    led = json.load(io.open(LEDGER, encoding="utf-8"))
    rows = led.get("rows", led)
    vault = os.path.join(
        r"C:\Users\junghwan.yoon\workspace\3.옵시디언",
        "20_경영", "지식", "_추출", "dart-eval")
    have = {f.split("_", 1)[0] for f in os.listdir(vault) if f.endswith(".md")}
    return [r for r in rows if r.get("rcp") in have]


def summarize(data: dict) -> None:
    """🔴 수집 결과를 눈으로 본다. 전량이 비면 API 가 아니라 corp_code 를 의심한다."""
    n = len(data)
    no_audit = sum(1 for v in data.values() if not v["audit"])
    empty_adtor = sum(1 for v in data.values()
                      if v["audit"] and all(a["missing"] for a in v["audit"]))
    no_holder = sum(1 for v in data.values() if not v["holders"])
    no_exec = sum(1 for v in data.values() if not v["execs"])
    print(f"\n=== 수집 요약 (딜 {n}건) ===")
    print(f"  감사인 응답 자체가 없음 : {no_audit}건")
    print(f"  응답은 있으나 감사인 공란: {empty_adtor}건")
    print(f"  최대주주 없음           : {no_holder}건")
    print(f"  임원 없음               : {no_exec}건")
    if no_audit == n:
        print("  🔴 전량이 비었다 — API 가 아니라 corp_code 를 의심할 것")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--summary", action="store_true", help="수집하지 않고 기존 결과만 요약")
    ap.add_argument("--renormalize", action="store_true",
                    help="API 호출 0회로 저장본만 다시 정규화(정규화 규칙을 고쳤을 때)")
    args = ap.parse_args()

    if args.renormalize:
        # 🔴 원문(adt_opinion)을 그대로 보관해 뒀기에 재수집 없이 다시 계산할 수 있다.
        #    파생값만 저장하고 원문을 버리면 규칙을 고칠 때마다 API 를 다시 때려야 한다.
        data = json.load(io.open(OUT, encoding="utf-8"))
        for v in data.values():
            for a in v.get("audit", []):
                a["opinion_norm"] = clean_opinion(a.get("adt_opinion", ""))
                a["bsns_year"] = "".join(a.get("bsns_year", "").split())
        io.open(OUT, "w", encoding="utf-8", newline="\n").write(
            json.dumps(data, ensure_ascii=False, indent=1))
        print(f"재정규화 완료 — {len(data)}건 (API 호출 0회)")
        return

    if args.summary:
        summarize(json.load(io.open(OUT, encoding="utf-8")))
        return

    key = load_key()
    targets = load_targets()
    print(f"대상 {len(targets)}건 · 딜당 API 4회 · 예상 {len(targets) * 4 * SLEEP / 60:.1f}분")

    out: dict = {}
    for i, r in enumerate(targets, start=1):
        rcp, corp, code = r["rcp"], r.get("corp", ""), r.get("corp_code", "")
        year = str(r.get("dt", ""))[:4]
        if not code or not year:
            print(f"[{i:3}/{len(targets)}] {corp:16} corp_code/연도 없음 — 건너뜀")
            continue
        # 🔴 공시 연도의 사업보고서는 아직 없을 수 있다(2026년 공시 16건이 전부 공란이었다).
        #    확정된 가장 최근 사업연도를 찾아 **최대 2년까지 내려간다.**
        audit, used_year = [], year
        for back in range(0, 3):
            y = str(int(year) - back)
            audit = normalize_audit(call(key, "accnutAdtorNmNdAdtOpinion", code, y))
            time.sleep(SLEEP)
            if audit:
                used_year = y
                break
        year = used_year
        holders = slim_holders(call(key, "hyslrSttus", code, year))
        time.sleep(SLEEP)
        execs = slim_execs(call(key, "exctvSttus", code, year))
        time.sleep(SLEEP)
        changes = slim_changes(call(key, "hyslrChgSttus", code, year))
        time.sleep(SLEEP)
        # 🔴 결과가 0건인 딜도 기록한다 — 빼면 「수집 안 함」과 「없음」이 구분되지 않는다
        out[rcp] = {"corp": corp, "corp_code": code, "year": year,
                    "audit": audit, "holders": holders,
                    "execs": execs, "holder_changes": changes}
        adt = audit[0]["adtor"] if audit else "-"
        print(f"[{i:3}/{len(targets)}] {corp:16} {year} 감사인={adt or '(공란)'} "
              f"주주{len(holders)} 임원{len(execs)} 변동{len(changes)}")

    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(out, ensure_ascii=False, indent=1))
    print(f"\nsaved -> {OUT}")
    summarize(out)


if __name__ == "__main__":
    main()
