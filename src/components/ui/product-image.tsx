'use client'

import { useState, type ReactNode } from 'react'

/**
 * Renders a product image and falls back to the caller's placeholder when the
 * asset cannot be fetched, so a missing R2 object reads as an empty state
 * instead of the browser's broken-image icon. Tracking the failed URL rather
 * than a boolean lets a replacement image retry on its own.
 */
export function ProductImage({
  alt,
  fallback,
  src,
}: {
  alt: string
  fallback: ReactNode
  src: string | null
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (!src || failedSrc === src) return fallback

  return (
    // R2 already serves immutable, cropped WebP assets at their display size.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      height="480"
      loading="lazy"
      onError={() => setFailedSrc(src)}
      src={src}
      width="480"
    />
  )
}
