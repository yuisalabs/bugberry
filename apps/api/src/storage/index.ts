import type { Config } from "../config"
import { LocalStorageDriver } from "./local"
import { S3StorageDriver } from "./s3"
import type { StorageDriver } from "./types"

export function createStorage(config: Config): StorageDriver {
  const ttl = {
    uploadTtlSeconds: config.uploadUrlTtlSeconds,
    readTtlSeconds: config.readUrlTtlSeconds,
  }
  const storage = config.storage
  if (storage.driver === "local") {
    return new LocalStorageDriver({
      dir: storage.dir,
      publicBaseUrl: config.appUrl,
      secret: `${config.authSecret}:storage`,
      ...ttl,
    })
  }
  return new S3StorageDriver({
    endpoint: storage.endpoint,
    region: storage.region,
    bucket: storage.bucket,
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
    virtualHostedStyle: storage.virtualHostedStyle,
    ...ttl,
  })
}
