import { Injectable } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, statSync } from "node:fs";
import { mkdirSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

export interface PersistedFile {
  storageKey: string;
  size: number;
}

export interface StorageService {
  persist(localPath: string, originalName: string): Promise<PersistedFile>;
  open(storageKey: string): Promise<Readable>;
  exists(storageKey: string): Promise<boolean>;
  remove(storageKey: string): Promise<void>;
}

@Injectable()
export class LocalStorageService implements StorageService {
  constructor(private readonly uploadDir: string) {}

  async persist(localPath: string, originalName: string): Promise<PersistedFile> {
    mkdirSync(this.uploadDir, { recursive: true });
    const safeName = originalName.replace(/[^\w.-]/g, "_");
    const filename = `${Date.now()}_${randomUUID()}_${safeName}`;
    renameSync(localPath, join(this.uploadDir, filename));
    return {
      storageKey: `/uploads/${filename}`,
      size: statSync(join(this.uploadDir, filename)).size,
    };
  }

  async open(storageKey: string): Promise<Readable> {
    return createReadStream(join(this.uploadDir, basename(storageKey)));
  }

  async exists(storageKey: string): Promise<boolean> {
    return existsSync(join(this.uploadDir, basename(storageKey)));
  }

  async remove(storageKey: string): Promise<void> {
    const target = join(this.uploadDir, basename(storageKey));
    if (existsSync(target)) {
      unlinkSync(target);
    }
  }
}

@Injectable()
export class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: {
    bucket: string;
    region: string;
    endpoint?: string;
    forcePathStyle?: boolean;
  }) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? false,
    });
  }

  async persist(localPath: string, originalName: string): Promise<PersistedFile> {
    const safeName = originalName.replace(/[^\w.-]/g, "_");
    const key = `files/${Date.now()}_${randomUUID()}_${safeName}`;
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(localPath),
      },
    });
    await upload.done();
    const size = statSync(localPath).size;
    unlinkSync(localPath);
    return { storageKey: key, size };
  }

  async open(storageKey: string): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
    );
    return result.Body as Readable;
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async remove(storageKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }),
    );
  }
}
