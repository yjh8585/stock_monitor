# Tier 2 백엔드 리뷰

## Critical
- [lib/reports/services/report-web.service.ts:63](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/lib/reports/services/report-web.service.ts:63>) `url.includes('marklines.com')` 조건으로 `MARKLINES_COOKIE`를 붙입니다. `source_url`은 [lib/reports/dto/post.dto.ts:19](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/lib/reports/dto/post.dto.ts:19>)에서 임의 URL만 검증하므로, `https://attacker.example/?marklines.com` 같은 URL로 사설 쿠키가 외부 호스트에 전송될 수 있습니다. `new URL(url).hostname`을 파싱해서 정확히 허용 도메인인지 확인해야 합니다.
- [lib/reports/services/report-web.service.ts:67](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/lib/reports/services/report-web.service.ts:67>) 인증된 사용자가 임의 URL을 서버에서 fetch하게 할 수 있어 SSRF 위험이 있습니다. `localhost`, 사설망, metadata IP, 비 HTTP(S), redirect 대상까지 차단하는 allowlist/egress 검증이 필요합니다.

## High
- [app/api/revalidate/route.ts:14](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/app/api/revalidate/route.ts:14>) / [app/api/revalidate/route.ts:59](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/app/api/revalidate/route.ts:59>) Route Handler에서 `updateTag()`를 사용합니다. 로컬 Next.js 16 문서 기준 `updateTag`는 Server Action 전용이고 Route Handler는 `revalidateTag(tag, 'max')`를 써야 합니다. 현재 `/api/revalidate`는 운영에서 런타임 실패 가능성이 큽니다.
- [proxy.ts:5](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/proxy.ts:5>)가 `/api/revalidate` 전체를 공개 처리하고, [app/api/revalidate/posts/[id]/route.ts:10](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/app/api/revalidate/posts/[id]/route.ts:10>)에는 별도 secret 검증이 없습니다. 누구나 임의 post id 캐시를 무효화할 수 있어 cache invalidation DoS가 가능합니다.
- [lib/auth/actions.ts:31](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/lib/auth/actions.ts:31>) 로그인에 rate limit/lockout/audit가 없습니다. `/login`은 공개 경로라 환경변수 기반 계정을 무제한 대입할 수 있습니다.

## Medium
- [app/api/revalidate/route.ts:29](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/app/api/revalidate/route.ts:29>)와 cron 라우트들([quotes-5min:24](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/app/api/cron/quotes-5min/route.ts:24>), [naver-board:20](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/app/api/cron/naver-board/route.ts:20>), [sentiment:19](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/app/api/cron/sentiment/route.ts:19>))이 secret query param을 허용합니다. URL 로그/히스토리/Referer로 secret이 새기 쉬워 header-only로 제한하는 편이 안전합니다.
- [app/api/uploads/report/route.ts:38](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/app/api/uploads/report/route.ts:38>) 업로드 검증이 브라우저 제공 `file.type`에만 의존합니다. magic bytes `%PDF-` 확인, 페이지/파일 구조 검증, 업로드 후 처리 전 재검증이 필요합니다.
- [lib/reports/dto/post.dto.ts:25](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/lib/reports/dto/post.dto.ts:25>) `report-file`의 `file_path`가 임의 문자열입니다. 업로드 API가 반환한 객체인지, bucket prefix/UUID 패턴인지 검증하지 않아 다른 Storage 객체 처리 시도가 가능합니다.

## Low / Nit
- [app/api/stock-prices/route.ts:14](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/app/api/stock-prices/route.ts:14>) `id` 형식 검증이 없습니다. UUID/known company id 검증을 추가하면 캐시 키 오염과 불필요한 DB 조회를 줄일 수 있습니다.
- 외부 fetch 대부분에 명시적 timeout/AbortSignal이 없습니다. 예: [app/api/news/search/route.ts:62](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/app/api/news/search/route.ts:62>), [lib/naver/board.ts:61](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/lib/naver/board.ts:61>), [lib/kiwoom/client.ts:108](</C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/lib/kiwoom/client.ts:108>). Vercel 300s 한도 안에서 실패를 빨리 확정하는 timeout이 필요합니다.

## 영향 범위
- `app/api/revalidate/`: 공개 범위와 Next.js 16 cache API 사용 오류.
- `app/api/cron/`: secret 전달 방식과 외부 API timeout.
- `app/api/uploads/`, `lib/reports/`: SSRF, 쿠키 유출, 업로드/파일 경로 검증.
- `lib/auth/`: 공개 로그인 brute force 방어 부족.
- `lib/stockPrices.ts`: 입력 검증 미흡.

## 검증
로컬 `node_modules/next/dist/docs/`의 Route Handler/Revalidation/Proxy 문서를 읽고 정적 리뷰했습니다. 코드 수정과 테스트 실행은 하지 않았습니다.