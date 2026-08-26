# dart_eval — DART 외부기관평가의견서 수집 (정찰 단계)

M&A 지식위키 보강용. **설계·결정 정본은 agents 레포**에 있다:
`agents/docs/superpowers/specs/2026-08-25-ma-knowledge-wiki.md` 하단 「확장 갈래 — DART 외부기관평가의견서 수집」

## 파일

| 파일 | 하는 일 |
|---|---|
| `recon_doc.py` | 공시 1건의 첨부문서 목록·평가의견서 본문·절 구조를 덤프(구조 확인용) |
| `recon_sample.py` | 최근 2년 「타법인…결정」 목록 + 표본의 첨부율·분량·산업 측정 |
| `probe_document_api.py` | OpenAPI `document.xml`(원본 zip)에 무엇이 들어오는지 확인 |
| `layer1_parse.py` | **층1** — 본문 XML의 「8. 외부평가에 관한 사항」 파싱(웹 안 거침) |
| `verify_rcpno_pair.py` | **층2 원형** — 첨부를 `rcpNo`+`dcmNo` **쌍**으로 열어 본문 확보. Q1b 수집기로 승격 예정 |
| `*_result.json` | 위 스크립트들의 실측 결과(계획서의 근거) |

## 🔴 반드시 지킬 것 (실측으로 얻은 것)

1. **첨부는 `rcpNo`+`dcmNo` 쌍으로 연다.** 정정공시의 첨부는 **원공시 rcpNo**에 매달려 있고
   원공시가 **최대 17개월** 앞선 경우도 있다. 정정본 rcpNo로는 구조적으로 절대 안 열린다.
2. **DART 웹(`dart.fss.or.kr`)은 IP를 차단한다.** 간격 0.15초에서 걸렸고 **26분 뒤** 풀렸다.
   간격 **2초**로 30요청을 돌렸을 땐 재차단이 없었다. 차단을 만나면 30분 대기 후 재개.
   OpenAPI(`opendart.fss.or.kr`)는 차단과 무관하다.
3. **평가의견서는 좌측 문서 트리에 없다.** 첨부 선택상자 `<select id="att">`에 있다.
4. `document.xml`(OpenAPI)은 **첨부를 주지 않는다.** 본문 XML 1개뿐이다.
   다만 본문에 「8. 외부평가에 관한 사항」(평가기관·평가액 범위·거래가액)이 있어 게이트 판정에 쓴다.
5. **정정본을 버리지 말 것.** 원본보다 두껍다(정정 재확보 중앙 20,386자 · 최대 65,559자).

## 실행

```bash
# stock_monitor 루트에서
./scripts/venv/Scripts/python.exe -X utf8 -u scripts/dart_eval/<파일>.py
```
키는 `scripts/.env`의 `DART_API_KEY`를 쓴다.
