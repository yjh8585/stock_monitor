# DB 일간 JSONB 백업
Supabase Free 플랜은 PITR 미지원이라 GitHub Actions가 매일 02:00 KST에 핵심 테이블을 JSON.gz로 dump한다.
보존: 30일.
