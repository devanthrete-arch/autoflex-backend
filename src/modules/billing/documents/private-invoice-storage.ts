import { randomUUID } from 'crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, writeFile, link, unlink } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
@Injectable()
export class PrivateInvoiceStorage {
  private client?: S3Client;
  constructor(private readonly config: ConfigService) {}
  get ready() {
    return this.config.get('INVOICE_STORAGE_DRIVER') === 's3'
      ? !!(
          this.config.get('INVOICE_S3_BUCKET') && this.config.get('AWS_REGION')
        )
      : this.config.get('INVOICE_STORAGE_DRIVER') === 'filesystem' &&
          process.env.NODE_ENV !== 'production';
  }
  private check(key: string) {
    if (!this.ready)
      throw new ServiceUnavailableException({
        code: 'INVOICE_STORAGE_NOT_CONFIGURED',
        message: 'Private invoice storage is not configured.',
      });
    if (!/^invoices\/[a-f0-9-]{36}\/[a-f0-9]{64}\.pdf$/.test(key))
      throw new Error('Invalid internal storage key');
  }
  private path(key: string) {
    const root = resolve(
      this.config.get<string>('INVOICE_LOCAL_DIRECTORY') ?? '.private-invoices',
    );
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error('Invalid private path');
    return path;
  }
  private s3() {
    return (this.client ??= new S3Client({
      region: this.config.get<string>('AWS_REGION'),
    }));
  }
  async put(key: string, bytes: Buffer) {
    this.check(key);
    if (this.config.get('INVOICE_STORAGE_DRIVER') === 's3') {
      await this.s3().send(
        new PutObjectCommand({
          Bucket: this.config.get<string>('INVOICE_S3_BUCKET'),
          Key: key,
          Body: bytes,
          ContentType: 'application/pdf',
          ServerSideEncryption: 'AES256',
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
    } else {
      const file = this.path(key);
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
        try {
          await link(temporary, file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const existing = await readFile(file);
          if (!existing.equals(bytes))
            throw new Error('Private object integrity conflict');
        }
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    }
  }
  async get(key: string): Promise<Buffer> {
    this.check(key);
    if (this.config.get('INVOICE_STORAGE_DRIVER') !== 's3')
      return readFile(this.path(key));
    const result = await this.s3().send(
      new GetObjectCommand({
        Bucket: this.config.get<string>('INVOICE_S3_BUCKET'),
        Key: key,
      }),
      { abortSignal: AbortSignal.timeout(15000) },
    );
    if (!result.Body) throw new Error('Private invoice missing');
    return Buffer.from(await result.Body.transformToByteArray());
  }
}
