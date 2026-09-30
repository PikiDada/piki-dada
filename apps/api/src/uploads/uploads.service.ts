import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class UploadsService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    const endpoint = config.getOrThrow<string>('MINIO_ENDPOINT');
    this.bucket = config.getOrThrow<string>('MINIO_BUCKET');
    // Browsers hit MinIO at a different URL than the API does when the API talks to it
    // over a private/Docker network address; falls back to the API's own endpoint for
    // single-host setups where both are the same.
    this.publicBaseUrl = (config.get<string>('MINIO_PUBLIC_URL') ?? endpoint).replace(/\/+$/, '');

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

  async uploadBuffer(buffer: Buffer, folder: string, filename?: string, mimeType?: string): Promise<string> {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const uniqueFilename = filename ? `${filename}-${timestamp}-${randomSuffix}` : `file-${timestamp}-${randomSuffix}`;
    const key = `${folder}/${uniqueFilename}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType || 'application/octet-stream',
      }),
    );

    return `${this.publicBaseUrl}/${this.bucket}/${key}`;
  }
}
