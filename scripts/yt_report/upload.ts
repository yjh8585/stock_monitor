/**
 * RUN_DIR/png/*.png → Supabase Storage `reports` 버킷의 batch.json.storage_folder 로 업로드.
 * env: .env.local(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * 버킷 허용 MIME는 image/png·application/pdf 뿐 → png만.
 * usage: npx tsx scripts/yt_report/upload.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
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

async function main() {
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const batch = JSON.parse(readFileSync(join(RUN_DIR, 'batch.json'), 'utf8'));
  const folder: string = batch.storage_folder;
  const pngDir = join(RUN_DIR, 'png');

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
