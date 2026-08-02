import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class UploadsService {
  private supabase;

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('SUPABASE_URL');
    const key = config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.supabase = createClient(url, key);
  }

  async uploadBuffer(buffer: Buffer, folder: string, filename?: string): Promise<string> {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const uniqueFilename = filename ? `${filename}-${timestamp}-${randomSuffix}` : `file-${timestamp}-${randomSuffix}`;
    const path = `${folder}/${uniqueFilename}`;

    const { data, error } = await this.supabase.storage
      .from('driver-documents')
      .upload(path, buffer, { upsert: false });

    if (error) throw new Error(`Upload failed: ${error.message}`);

    const { data: publicUrl } = this.supabase.storage
      .from('driver-documents')
      .getPublicUrl(path);

    return publicUrl.publicUrl;
  }
}
