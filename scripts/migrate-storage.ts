// One-off migration: copies every object out of the Supabase `driver-documents` bucket
// into the new self-hosted MinIO bucket, then rewrites the database's file links from
// Supabase to MinIO so Supabase can be deleted. Run during cutover, AFTER the final
// pg_dump restore into the new Postgres (a later restore would bring the Supabase links
// back). Safe to re-run. Not part of the app's runtime dependencies — install
// @supabase/supabase-js, @aws-sdk/client-s3 and pg temporarily (or run with `pnpm dlx tsx`)
// to execute this, then it can be deleted.
//
// Usage:
//   SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   MINIO_ENDPOINT=... MINIO_BUCKET=driver-documents MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
//   MINIO_PUBLIC_URL=https://files.pikidada.com \
//   DATABASE_URL=<the NEW self-hosted Postgres, not Supabase> \
//   npx tsx scripts/migrate-storage.ts

import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Client } from 'pg';

const SOURCE_BUCKET = 'driver-documents';

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

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  );
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const bucket = process.env.MINIO_BUCKET ?? 'driver-documents';
  const s3 = new S3Client({
    endpoint: process.env.MINIO_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? '',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? '',
    },
  });

  const paths = await listAllPaths(supabase);
  console.log(`Found ${paths.length} object(s) in Supabase bucket "${SOURCE_BUCKET}".`);

  let copied = 0;
  for (const path of paths) {
    const { data, error } = await supabase.storage.from(SOURCE_BUCKET).download(path);
    if (error) {
      console.error(`Failed to download "${path}": ${error.message}`);
      continue;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: path,
        Body: buffer,
        ContentType: data.type || 'application/octet-stream',
      }),
    );
    copied += 1;
    console.log(`Copied ${copied}/${paths.length}: ${path}`);
  }

  console.log(`Done. Copied ${copied}/${paths.length} object(s).`);
  if (copied !== paths.length) {
    console.warn('Some objects failed to copy — check the log above before decommissioning Supabase.');
    console.warn('Database links left pointing at Supabase until every file is copied.');
    process.exitCode = 1;
    return;
  }

  await rewriteLinks(bucket);
}

// Objects keep the same key in MinIO, so each link only needs its Supabase prefix swapped:
//   https://<project>.supabase.co/storage/v1/object/public/driver-documents/<key>
//   -> https://files.pikidada.com/driver-documents/<key>  (uploads.service's format)
async function rewriteLinks(bucket: string) {
  const databaseUrl = process.env.DATABASE_URL;
  const publicUrl = process.env.MINIO_PUBLIC_URL;
  if (!databaseUrl || !publicUrl) {
    console.warn('DATABASE_URL or MINIO_PUBLIC_URL not set: database links NOT rewritten.');
    process.exitCode = 1;
    return;
  }
  if (databaseUrl.includes('supabase')) {
    throw new Error('DATABASE_URL points at Supabase; rewrite the NEW database instead');
  }

  const oldPrefix = `${process.env.SUPABASE_URL!.replace(/\/+$/, '')}/storage/v1/object/public/${SOURCE_BUCKET}/`;
  const newPrefix = `${publicUrl.replace(/\/+$/, '')}/${bucket}/`;
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
      const res = await db.query(
        `UPDATE "${table}" SET "${column}" = $2 || substr("${column}", length($1) + 1)
         WHERE starts_with("${column}", $1)`,
        [oldPrefix, newPrefix],
      );
      console.log(`Rewrote ${res.rowCount} ${table}.${column} link(s) to MinIO.`);
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
