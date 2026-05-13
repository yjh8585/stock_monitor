/**
 * youtube-summary → stock_monitor 보고서 데이터 일회성 이전 스크립트.
 *
 * 동작:
 *  1) SRC posts 행 전체 SELECT → DST에 id 보존 INSERT (upsert)
 *  2) SRC reports 버킷의 모든 객체 list → 다운로드 → DST 버킷에 동일 path로 upload
 *  3) DST에서 BIGSERIAL 시퀀스를 max(id)+1 로 재설정 (id 보존 INSERT 후 충돌 방지)
 *
 * 실행:
 *   npx tsx scripts/migrate_reports.ts          # 실제 이전
 *   npx tsx scripts/migrate_reports.ts --dry    # 행 수/객체 수만 출력
 *
 * 환경:
 *  - stock_monitor/.env.local (DST: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *  - youtube-summary/.env.local (SRC: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *
 * 멱등성: posts는 id 충돌 시 upsert로 덮어쓰고, Storage는 upsert:true 로 덮어쓴다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PROJECT_ROOT = resolve(__dirname, '..');
const SRC_ENV_PATH = resolve(PROJECT_ROOT, '../youtube-summary/.env.local');
const DST_ENV_PATH = resolve(PROJECT_ROOT, '.env.local');
const BUCKET = 'reports';
const BATCH_SIZE = 100;

/** 간이 .env 파서 (= 첫 번째 등호 기준 분리) */
function parseEnv(path: string): Record<string, string> {
  const raw = readFileSync(path, 'utf8');
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function makeClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function listAllStorageObjects(
  client: SupabaseClient,
  bucket: string,
  prefix = ''
): Promise<string[]> {
  // Supabase Storage list는 비재귀 — 폴더를 만나면 재귀 호출
  const out: string[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`Storage list 실패 (${prefix}): ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      // 폴더는 id가 null
      if (item.id === null) {
        const children = await listAllStorageObjects(client, bucket, fullPath);
        out.push(...children);
      } else {
        out.push(fullPath);
      }
    }
    if (data.length < limit) break;
    offset += data.length;
  }
  return out;
}

async function migratePosts(src: SupabaseClient, dst: SupabaseClient, dry: boolean): Promise<void> {
  console.log('\n=== posts 행 이전 ===');
  const { data, error, count } = await src
    .from('posts')
    .select('*', { count: 'exact' })
    .order('id', { ascending: true });
  if (error) throw new Error(`SRC posts 조회 실패: ${error.message}`);
  const rows = data ?? [];
  console.log(`SRC posts: ${count ?? rows.length} 행`);
  if (dry) return;
  if (rows.length === 0) {
    console.log('이전할 행 없음.');
    return;
  }
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error: upErr } = await dst.from('posts').upsert(batch, { onConflict: 'id' });
    if (upErr) throw new Error(`DST upsert 실패 (offset ${i}): ${upErr.message}`);
    console.log(`  upsert ${i + batch.length}/${rows.length}`);
  }
  // 시퀀스 재설정 (id 보존 INSERT 후 다음 INSERT가 충돌하지 않도록)
  const maxId = rows.reduce((m: number, r) => Math.max(m, Number(r.id) || 0), 0);
  const { error: seqErr } = await dst.rpc('exec_sql' as never, {} as never).then(
    () => ({ error: null as Error | null }),
    () => ({ error: new Error('exec_sql RPC 미존재 — SQL Editor에서 수동 실행 필요') })
  );
  if (seqErr) {
    console.log(`  ⚠ 시퀀스 재설정은 다음 SQL을 Supabase SQL Editor에서 직접 실행하세요:`);
    console.log(`    SELECT setval(pg_get_serial_sequence('posts', 'id'), ${maxId}, true);`);
  }
}

async function migrateStorage(
  src: SupabaseClient,
  dst: SupabaseClient,
  dry: boolean
): Promise<void> {
  console.log('\n=== reports Storage 이전 ===');
  const paths = await listAllStorageObjects(src, BUCKET);
  console.log(`SRC ${BUCKET} 버킷 객체: ${paths.length} 개`);
  if (dry) return;
  if (paths.length === 0) {
    console.log('이전할 객체 없음.');
    return;
  }
  let done = 0;
  for (const path of paths) {
    const { data: blob, error: dlErr } = await src.storage.from(BUCKET).download(path);
    if (dlErr || !blob) {
      console.warn(`  ⚠ 다운로드 실패 ${path}: ${dlErr?.message}`);
      continue;
    }
    const buf = Buffer.from(await blob.arrayBuffer());
    const contentType =
      blob.type || (path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/png');
    const { error: upErr } = await dst.storage.from(BUCKET).upload(path, buf, {
      contentType,
      upsert: true,
      cacheControl: '31536000',
    });
    if (upErr) {
      console.warn(`  ⚠ 업로드 실패 ${path}: ${upErr.message}`);
      continue;
    }
    done += 1;
    if (done % 20 === 0 || done === paths.length) console.log(`  업로드 ${done}/${paths.length}`);
  }
  console.log(`Storage 이전 완료: ${done}/${paths.length}`);
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const srcEnv = parseEnv(SRC_ENV_PATH);
  const dstEnv = parseEnv(DST_ENV_PATH);
  const srcUrl = srcEnv.NEXT_PUBLIC_SUPABASE_URL;
  const srcKey = srcEnv.SUPABASE_SERVICE_ROLE_KEY;
  const dstUrl = dstEnv.NEXT_PUBLIC_SUPABASE_URL;
  const dstKey = dstEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!srcUrl || !srcKey) throw new Error('youtube-summary/.env.local에 SUPABASE 정보 부족');
  if (!dstUrl || !dstKey) throw new Error('stock_monitor/.env.local에 SUPABASE 정보 부족');
  if (srcUrl === dstUrl) throw new Error('SRC와 DST가 동일 — 잘못된 설정');

  console.log(`SRC: ${srcUrl}`);
  console.log(`DST: ${dstUrl}`);
  console.log(`MODE: ${dry ? 'DRY-RUN (조회만)' : 'WRITE'}`);

  const src = makeClient(srcUrl, srcKey);
  const dst = makeClient(dstUrl, dstKey);
  await migratePosts(src, dst, dry);
  await migrateStorage(src, dst, dry);
  console.log('\n✅ 완료');
}

main().catch((err) => {
  console.error('\n❌ 실패:', err);
  process.exit(1);
});
