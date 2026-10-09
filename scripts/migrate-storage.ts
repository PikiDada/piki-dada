// One-off migration, run during the Hetzner cutover: copies every file out of the Supabase
// `driver-documents` bucket onto the server's disk (Piki Dada's `uploads` volume, served as
// files.pikidada.com), then rewrites the database's file links from Supabase to the new
// address so Supabase can be deleted. Run AFTER the final pg_dump restore into the new
// Postgres (a later restore would bring the Supabase links back). Safe to re-run: files
// already copied are skipped, and links are only rewritten once every file is in place.
//
// Each file keeps its path, plus an extension when it has none (older uploads were named
// without one), so the file server sends the right type, the same rule uploads.service.ts
// uses for new uploads.
//
// Usage (deploy/README.md runs it in a container with the uploads volume at /uploads):
//   SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   UPLOAD_DIR=/uploads UPLOADS_PUBLIC_URL=https://files.pikidada.com \
//   DATABASE_URL=<the NEW self-hosted Postgres, not Supabase> \
//   npx tsx scripts/migrate-storage.ts
// Needs @supabase/supabase-js and pg, installed only for the run.

import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';

const SOURCE_BUCKET = 'driver-documents';

// Must match uploads.service.ts.
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
};

async function listAllPaths(supabase: ReturnType<typeof createClient>, prefix = ''): Promise<string[]> {
  const { data, error } = await supabase.storage.from(SOURCE_BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list(${prefix}) failed: ${error.message}`);

  const paths: string[] = [];
  for (const entry of data ?? []) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      // No id means it's a folder placeholder — recurse into it.
      paths.push(...(await listAllPaths(supabase, fullPath)));
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
  const supabase = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'));
  const root = resolve(required('UPLOAD_DIR'));
  const publicUrl = required('UPLOADS_PUBLIC_URL').replace(/\/+$/, '');
  const databaseUrl = required('DATABASE_URL');
  if (databaseUrl.includes('supabase')) {
    throw new Error('DATABASE_URL points at Supabase; rewrite the NEW database instead');
  }

  const paths = await listAllPaths(supabase);
  console.log(`Found ${paths.length} object(s) in Supabase bucket "${SOURCE_BUCKET}".`);

  // Supabase path -> new key on disk.
  const moved = new Map<string, string>();
  for (const path of paths) {
    const { data, error } = await supabase.storage.from(SOURCE_BUCKET).download(path);
    if (error) {
      console.error(`Failed to download "${path}": ${error.message}`);
      continue;
    }
    const hasExtension = /\.[A-Za-z0-9]{2,5}$/.test(path);
    const key = hasExtension ? path : `${path}${EXTENSIONS[data.type] ?? '.bin'}`;
    const target = resolve(root, key);
    if (!target.startsWith(root + sep)) {
      console.error(`Skipping "${path}": it would land outside the upload folder`);
      continue;
    }
    if (!existsSync(target)) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(await data.arrayBuffer()));
    }
    moved.set(path, key);
    console.log(`Copied ${moved.size}/${paths.length}: ${path} -> ${key}`);
  }

  console.log(`Done. Copied ${moved.size}/${paths.length} object(s).`);
  if (moved.size !== paths.length) {
    console.warn('Some objects failed to copy — check the log above before decommissioning Supabase.');
    console.warn('Database links left pointing at Supabase until every file is copied.');
    process.exitCode = 1;
    return;
  }

  await rewriteLinks(databaseUrl, `${supabaseUrl}/storage/v1/object/public/${SOURCE_BUCKET}/`, publicUrl, moved);
}

// Links look like https://<project>.supabase.co/storage/v1/object/public/driver-documents/<path>,
// with each part of <path> URL-encoded, and become https://files.pikidada.com/<key>.
async function rewriteLinks(databaseUrl: string, oldPrefix: string, publicUrl: string, moved: Map<string, string>) {
  const columns: [table: string, column: string][] = [
    ['Document', 'fileUrl'],
    ['Vehicle', 'photoUrl'],
    ['Delivery', 'itemPhotoUrl'],
  ];

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query('BEGIN');
    for (const [table, column] of columns) {
      const { rows } = await db.query<{ id: string; url: string }>(
        `SELECT id, "${column}" AS url FROM "${table}" WHERE starts_with("${column}", $1)`,
        [oldPrefix],
      );
      let rewritten = 0;
      for (const row of rows) {
        const path = row.url.slice(oldPrefix.length).split('/').map(decodeURIComponent).join('/');
        const key = moved.get(path);
        if (!key) {
          console.warn(`No copied file for ${table}.${column} of ${row.id}: ${row.url} (left as is)`);
          continue;
        }
        const newUrl = `${publicUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
        await db.query(`UPDATE "${table}" SET "${column}" = $2 WHERE id = $1`, [row.id, newUrl]);
        rewritten += 1;
      }
      console.log(`Rewrote ${rewritten}/${rows.length} ${table}.${column} link(s).`);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
