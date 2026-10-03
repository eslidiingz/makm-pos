export const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_WEBP_IMAGE_BYTES = 2 * 1024 * 1024
export const WEBP_CONTENT_TYPE = 'image/webp'

export function normalizeCatalogName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function isValidCatalogName(value: string) {
  const normalized = normalizeCatalogName(value)
  return normalized.length >= 1 && normalized.length <= 80
}

export function isValidPrice(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 999_999.99
}

export function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function isPendingImageKey(value: string) {
  return /^catalog\/pending\/[0-9a-f-]{36}\.webp$/i.test(value)
    && isValidUuid(value.slice('catalog/pending/'.length, -'.webp'.length))
}

export function isAbsoluteHttpUrl(value: string) {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
