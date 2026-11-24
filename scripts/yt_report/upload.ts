/**
 * 게시용 그림 폴더의 *.png → Supabase Storage `reports` 버킷의 batch.json.storage_folder 로 업로드.
 * 유튜브 회차 = RUN_DIR/png_final/(finalize.py 가 만든 게시용 그림 · 본문에 실린 것만 · 크롭본이 있으면 크롭본).
 *   🔴 png/ 는 올리지 않는다 — crop.py 의 png/<slug>_<오프셋>.png 는 중간 산출물이라 본문 주소(pub_base/<slug>.png)와
 *   이름이 다르다(2026-11-24 정본화 D5).
 * PDF 회차(docs/report-from-pdf.md §1-A) = RUN_DIR/png/ 를 그대로 올린다(finalize 를 안 거친다 · selected.json 없음).
 * env: .env.local(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * 버킷 허용 MIME는 image/png·application/pdf 뿐 → png만.
 * usage: npx tsx scripts/yt_report/upload.ts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const RUN_DIR = process.env.YT_RUN_DIR || join(ROOT, 'scripts', '_yt_report');

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * 올릴 폴더 — 유튜브 회차(selected.json 있음)는 png_final/(없으면 멈춤), PDF 회차는 png/.
 * 🔴 회차 종류를 먼저 본다 — 폴더 존재를 먼저 보면 PDF 회차에 남은 옛 png_final/ 을 올린다(2026-11-24 최종 검토).
 */
function uploadDir(): string {
  if (!existsSync(join(RUN_DIR, 'selected.json'))) return join(RUN_DIR, 'png');
  const finalDir = join(RUN_DIR, 'png_final');
  if (existsSync(finalDir)) return finalDir;
  console.error(`png_final/ 이 없다 — 유튜브 회차는 finalize.py 를 먼저 돌린다(${finalDir})`);
  process.exit(1);
}

async function main() {
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const batch = JSON.parse(readFileSync(join(RUN_DIR, 'batch.json'), 'utf8'));
  const folder: string = batch.storage_folder;
  const pngDir = uploadDir();
  console.log(`FROM ${pngDir}`);

  const files = readdirSync(pngDir)
    .filter((f) => f.endsWith('.png'))
    .sort();
  let ok = 0;
  for (const f of files) {
    const buf = readFileSync(join(pngDir, f));
    const { error } = await supabase.storage.from('reports').upload(`${folder}/${f}`, buf, {
      contentType: 'image/png',
      cacheControl: '31536000',
      upsert: true,
    });
    if (error) console.log(`ERR  ${f}\t${error.message}`);
    else ok += 1;
  }
  console.log(`UPLOADED ${ok}/${files.length} → reports/${folder}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
