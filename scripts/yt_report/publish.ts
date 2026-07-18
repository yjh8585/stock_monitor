/**
 * batch.json + RUN_DIR/reports_final/<key>.md → posts 테이블에 upsert(직접 작성 §2-B).
 * source_url 기준: 없으면 INSERT(status=completed), 있으면 content·thumbnail·meta UPDATE.
 * 게시 후 캐시 무효화는 별도(README 참고: /api/revalidate 또는 revalidate.py).
 *
 * batch.json.reports[] 필드: key, title, source_name, source_url, category, published_at,
 *                            thumb_slug, frames[]. 썸네일=pub_base/thumb_slug.png(없으면 thumb_fallback).
 * usage: npx tsx scripts/yt_report/publish.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const RUN_DIR = process.env.YT_RUN_DIR || join(ROOT, 'scripts', '_yt_report');

interface Report {
  key: string;
  title: string;
  source_name: string;
  source_url: string;
  category: string;
  published_at: string | null;
  thumb_slug?: string;
  thumb_fallback?: string;
}

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
  const batch = JSON.parse(readFileSync(join(RUN_DIR, 'batch.json'), 'utf8')) as {
    pub_base: string;
    reports: Report[];
  };

  const ids: number[] = [];
  for (const r of batch.reports) {
    const content = readFileSync(join(RUN_DIR, 'reports_final', `${r.key}.md`), 'utf8');
    const thumb = r.thumb_slug
      ? `${batch.pub_base}/${r.thumb_slug}.png`
      : (r.thumb_fallback ?? null);

    const { data: existing, error: selErr } = await supabase
      .from('posts')
      .select('id')
      .eq('source_url', r.source_url)
      .maybeSingle();
    if (selErr) throw selErr;

    if (existing) {
      const { error } = await supabase
        .from('posts')
        .update({ title: r.title, content, thumbnail_url: thumb, category: r.category })
        .eq('id', existing.id);
      if (error) throw error;
      ids.push(existing.id as number);
      console.log(`UPDATE id=${existing.id}\t${r.key}\t${r.category}`);
    } else {
      const { data, error } = await supabase
        .from('posts')
        .insert({
          source_type: 'report',
          status: 'completed',
          title: r.title,
          source_name: r.source_name,
          source_url: r.source_url,
          thumbnail_url: thumb,
          content,
          category: r.category,
          source_published_at: r.published_at,
        })
        .select('id')
        .single();
      if (error) throw error;
      ids.push(data.id as number);
      console.log(`INSERT id=${data.id}\t${r.key}\t${r.category}`);
    }
  }
  console.log('POST_IDS=' + ids.join(','));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
