import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { storageKey, UploadsService } from './uploads.service';

describe('storageKey', () => {
  it("keeps only safe characters of the uploader's file name", () => {
    const key = storageKey(
      'driver-documents',
      '../../etc/My ID (front).JPG',
      'image/jpeg',
    );
    expect(key).toMatch(
      /^driver-documents\/etc-My-ID-front-\d+-[0-9a-f]{12}\.jpg$/,
    );
  });

  it('takes the extension from the accepted type, never from the name', () => {
    expect(storageKey('x', 'page.html', 'image/png')).toMatch(/\.png$/);
    expect(storageKey('x', 'scan.pdf', 'application/pdf')).toMatch(/\.pdf$/);
    expect(storageKey('x', 'tool.exe', 'application/x-msdownload')).toMatch(
      /\.bin$/,
    );
  });

  it('names a file with no usable name "file"', () => {
    expect(storageKey('x', '...', 'image/png')).toMatch(/^x\/file-/);
    expect(storageKey('x', undefined, 'image/png')).toMatch(/^x\/file-/);
  });
});

describe('UploadsService on disk', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uploads-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const service = () =>
    new UploadsService({
      get: (key: string) =>
        ({
          UPLOAD_DIR: dir,
          UPLOADS_PUBLIC_URL: 'https://files.pikidada.com/',
        })[key],
    } as never);

  it('writes the file inside its folder and returns its public link', async () => {
    const url = await service().uploadBuffer(
      Buffer.from('fake image'),
      'driver-documents',
      '../../../escape.jpg',
      'image/jpeg',
    );

    expect(url).toMatch(
      /^https:\/\/files\.pikidada\.com\/driver-documents\/escape-\d+-[0-9a-f]{12}\.jpg$/,
    );
    const [name] = await readdir(join(dir, 'driver-documents'));
    expect(url.endsWith(name)).toBe(true);
    expect(await readFile(join(dir, 'driver-documents', name), 'utf8')).toBe(
      'fake image',
    );
  });
});
