import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type { ObjectStorageGateway } from '@/server/catalog/types'
import {
  isAbsoluteHttpUrl,
  isPendingImageKey,
  MAX_WEBP_IMAGE_BYTES,
  WEBP_CONTENT_TYPE,
} from '@/server/catalog/validation'

const PRESIGN_SECONDS = 5 * 60

function requiredR2Configuration() {
  const configuration = {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    accountId: process.env.R2_ACCOUNT_ID,
    bucket: process.env.R2_BUCKET_NAME,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  }

  // Leaving every value unset keeps image upload disabled on purpose, but a
  // filled-in config with a malformed public URL would silently render broken
  // image links, so it fails the boot instead.
  if (!Object.values(configuration).every(Boolean)) return null

  const complete = configuration as Record<keyof typeof configuration, string>
  if (!isAbsoluteHttpUrl(complete.publicBaseUrl)) {
    throw new Error(
      `R2_PUBLIC_BASE_URL must include the scheme, for example https://cdn.example.com (received "${complete.publicBaseUrl}").`,
    )
  }

  return complete
}

function encodeObjectKey(key: string) {
  return key.split('/').map(encodeURIComponent).join('/')
}

export class R2ObjectStorageGateway implements ObjectStorageGateway {
  readonly configured = true
  private readonly client: S3Client

  constructor(private readonly configuration: NonNullable<ReturnType<typeof requiredR2Configuration>>) {
    this.client = new S3Client({
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      },
      endpoint: `https://${configuration.accountId}.r2.cloudflarestorage.com`,
      region: 'auto',
    })
  }

  async presignWebpUpload() {
    const pendingKey = `catalog/pending/${crypto.randomUUID()}.webp`
    const uploadUrl = await getSignedUrl(this.client, new PutObjectCommand({
      Bucket: this.configuration.bucket,
      ContentType: WEBP_CONTENT_TYPE,
      Key: pendingKey,
    }), { expiresIn: PRESIGN_SECONDS })

    return {
      expiresAt: new Date(Date.now() + PRESIGN_SECONDS * 1000).toISOString(),
      pendingKey,
      uploadUrl,
    }
  }

  async finalize(pendingKey: string, productId: string) {
    if (!isPendingImageKey(pendingKey)) throw new Error('Invalid pending image key.')

    const head = await this.client.send(new HeadObjectCommand({
      Bucket: this.configuration.bucket,
      Key: pendingKey,
    }))
    if (
      head.ContentType !== WEBP_CONTENT_TYPE
      || !head.ContentLength
      || head.ContentLength > MAX_WEBP_IMAGE_BYTES
    ) {
      throw new Error('Uploaded image failed validation.')
    }

    const finalKey = `catalog/products/${productId}/${crypto.randomUUID()}.webp`
    await this.client.send(new CopyObjectCommand({
      Bucket: this.configuration.bucket,
      CacheControl: 'public, max-age=31536000, immutable',
      ContentType: WEBP_CONTENT_TYPE,
      CopySource: `${this.configuration.bucket}/${encodeObjectKey(pendingKey)}`,
      Key: finalKey,
      MetadataDirective: 'REPLACE',
    }))
    // The lifecycle rule is the final safety net if pending cleanup is briefly
    // unavailable; the copied immutable object is already valid at this point.
    await this.delete(pendingKey).catch(() => undefined)
    return finalKey
  }

  async delete(key: string) {
    if (!key.startsWith('catalog/')) throw new Error('Invalid image key.')
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.configuration.bucket,
      Key: key,
    }))
  }

  publicUrl(key: string | null) {
    if (!key) return null
    return `${this.configuration.publicBaseUrl.replace(/\/$/, '')}/${encodeObjectKey(key)}`
  }
}

class UnconfiguredObjectStorageGateway implements ObjectStorageGateway {
  readonly configured = false

  async presignWebpUpload(): Promise<never> {
    throw new Error('R2 object storage is not configured.')
  }

  async finalize(): Promise<never> {
    throw new Error('R2 object storage is not configured.')
  }

  async delete() {}

  publicUrl() {
    return null
  }
}

export function createObjectStorageGateway(): ObjectStorageGateway {
  const configuration = requiredR2Configuration()
  return configuration
    ? new R2ObjectStorageGateway(configuration)
    : new UnconfiguredObjectStorageGateway()
}
