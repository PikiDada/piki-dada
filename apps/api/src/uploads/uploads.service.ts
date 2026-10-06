import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';

// Where uploaded files (driver documents, delivery photos) are stored:
// - MinIO when MINIO_ENDPOINT is set (the self-hosted server);
// - otherwise Supabase Storage, which the hosted deployment used before the move and still
//   uses until cutover.
// Missing storage settings must never stop the API from starting: that took every deploy
// down while the hosted environment had no MinIO. An upload attempted with no storage
// configured fails on its own instead.

interface StorageBackend {
  put(key: string, body: Buffer, contentType: string): Promise<string>;
}

class MinioBackend implements StorageBackend {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService, endpoint: string) {
    this.bucket = config.getOrThrow<string>('MINIO_BUCKET');
    // Browsers hit MinIO at a different URL than the API does when the API talks to it
    // over a private/Docker network address; falls back to the API's own endpoint for
    // single-host setups where both are the same.
    this.publicBaseUrl = (
      config.get<string>('MINIO_PUBLIC_URL') ?? endpoint
    ).replace(/\/+$/, '');
    this.s3 = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return `${this.publicBaseUrl}/${this.bucket}/${key}`;
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
    const minioEndpoint = config.get<string>('MINIO_ENDPOINT');
    const supabaseUrl = config.get<string>('SUPABASE_URL')?.replace(/\/+$/, '');
    const supabaseKey = config.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (minioEndpoint) {
      this.backend = new MinioBackend(config, minioEndpoint);
    } else if (supabaseUrl && supabaseKey) {
      this.backend = new SupabaseBackend(supabaseUrl, supabaseKey);
    } else {
      this.backend = null;
      this.logger.warn(
        'No file storage configured (MINIO_* or SUPABASE_*); uploads will fail until it is',
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
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const uniqueFilename = filename
      ? `${filename}-${timestamp}-${randomSuffix}`
      : `file-${timestamp}-${randomSuffix}`;
    const key = `${folder}/${uniqueFilename}`;
    return this.backend.put(
      key,
      buffer,
      mimeType || 'application/octet-stream',
    );
  }
}
