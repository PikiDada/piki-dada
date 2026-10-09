import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import axios from 'axios';

// Where uploaded files (driver documents, delivery photos) are stored:
// - the server's disk when UPLOAD_DIR is set (the shared Hetzner server: a Docker volume that
//   Piki Dada's own Caddy serves as files.pikidada.com, backed up nightly with the rest);
// - otherwise Supabase Storage, which the hosted deployment uses until the move.
// Missing storage settings must never stop the API from starting: that took every deploy
// down once. An upload attempted with no storage configured fails on its own instead.

interface StorageBackend {
  put(key: string, body: Buffer, contentType: string): Promise<string>;
}

// The extension decides the Content-Type the file is later served with, so it comes from the
// type the upload was accepted as, never from the uploader's file name: a file that claimed to
// be an image is then always served as one, and nothing uploaded can be served as a web page.
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
};

// "folder/<cleaned name>-<time>-<random>.<ext>". The uploader's file name only contributes
// letters, digits, - and _, so it can't reach outside the folder ("../") or break a URL.
export function storageKey(
  folder: string,
  originalName: string | undefined,
  mimeType: string,
): string {
  const base =
    (originalName ?? '')
      .replace(/\.[^.]*$/, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'file';
  const random = randomBytes(6).toString('hex');
  return `${folder}/${base}-${Date.now()}-${random}${EXTENSIONS[mimeType] ?? '.bin'}`;
}

class DiskBackend implements StorageBackend {
  private readonly root: string;

  constructor(
    root: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = resolve(root);
  }

  async put(key: string, body: Buffer) {
    const path = resolve(this.root, key);
    // storageKey already prevents this; a second check costs nothing.
    if (!path.startsWith(this.root + sep)) {
      throw new Error(`Refusing to write outside the upload folder: ${key}`);
    }
    await mkdir(dirname(path), { recursive: true });
    // "wx": never overwrite an existing file.
    await writeFile(path, body, { flag: 'wx' });
    return `${this.publicBaseUrl}/${key}`;
  }
}

// Supabase Storage's REST API, called directly (the same calls supabase-js makes) so the SDK
// isn't a dependency just for this. Same bucket and link format as the original uploads.
class SupabaseBackend implements StorageBackend {
  private static readonly BUCKET = 'driver-documents';

  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string) {
    const path = key.split('/').map(encodeURIComponent).join('/');
    const bucket = SupabaseBackend.BUCKET;
    await axios.post(`${this.url}/storage/v1/object/${bucket}/${path}`, body, {
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        apikey: this.serviceKey,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      maxBodyLength: Infinity,
    });
    return `${this.url}/storage/v1/object/public/${bucket}/${path}`;
  }
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly backend: StorageBackend | null;

  constructor(config: ConfigService) {
    const uploadDir = config.get<string>('UPLOAD_DIR');
    const publicUrl = config
      .get<string>('UPLOADS_PUBLIC_URL')
      ?.replace(/\/+$/, '');
    const supabaseUrl = config.get<string>('SUPABASE_URL')?.replace(/\/+$/, '');
    const supabaseKey = config.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (uploadDir && publicUrl) {
      this.backend = new DiskBackend(uploadDir, publicUrl);
    } else if (supabaseUrl && supabaseKey) {
      this.backend = new SupabaseBackend(supabaseUrl, supabaseKey);
    } else {
      this.backend = null;
      this.logger.warn(
        'No file storage configured (UPLOAD_DIR + UPLOADS_PUBLIC_URL, or SUPABASE_*); uploads will fail until it is',
      );
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    folder: string,
    filename?: string,
    mimeType?: string,
  ): Promise<string> {
    if (!this.backend) {
      throw new ServiceUnavailableException(
        'File uploads are not available right now',
      );
    }
    const contentType = mimeType || 'application/octet-stream';
    return this.backend.put(
      storageKey(folder, filename, contentType),
      buffer,
      contentType,
    );
  }
}
