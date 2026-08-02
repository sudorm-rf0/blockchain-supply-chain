import { Module } from "@nestjs/common";
import { join } from "node:path";
import {
  LocalStorageService,
  S3StorageService,
  type StorageService,
} from "./storage.service";

function storageFactory(): StorageService {
  if (process.env.STORAGE_DRIVER === "s3") {
    return new S3StorageService({
      bucket: process.env.S3_BUCKET ?? "supply-chain-files",
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
  }
  return new LocalStorageService(join(process.cwd(), "uploads"));
}

@Module({
  providers: [
    {
      provide: "STORAGE_SERVICE",
      useFactory: storageFactory,
    },
  ],
  exports: ["STORAGE_SERVICE"],
})
export class StorageModule {}
