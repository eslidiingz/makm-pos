'use client'

import Cropper, { type Area } from 'react-easy-crop'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MAX_WEBP_IMAGE_BYTES } from '@/server/catalog/validation'

const MAX_DIMENSION = 1200

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปได้'))
    image.src = source
  })
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('ไม่สามารถแปลงรูปเป็น WebP ได้'))
    }, 'image/webp', quality)
  })
}

async function cropToWebp(source: string, crop: Area) {
  const image = await loadImage(source)
  let outputSize = Math.min(MAX_DIMENSION, crop.width, crop.height)
  let quality = 0.82
  let smallest: Blob | null = null

  while (outputSize >= 64) {
    const canvas = document.createElement('canvas')
    canvas.width = outputSize
    canvas.height = outputSize
    const context = canvas.getContext('2d')
    if (!context) throw new Error('เบราว์เซอร์ไม่รองรับการปรับรูป')
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      outputSize,
      outputSize,
    )

    while (quality >= 0.3) {
      const blob = await canvasToWebp(canvas, quality)
      if (!smallest || blob.size < smallest.size) smallest = blob
      if (blob.size <= MAX_WEBP_IMAGE_BYTES) return blob
      quality -= 0.08
    }

    outputSize = Math.floor(outputSize * 0.8)
    quality = 0.82
  }

  // Every attempt exceeded the target size — ship the smallest WebP produced
  // instead of blocking the user, since it is still far lighter than the source.
  return smallest as Blob
}

export function ImageCropper({
  file,
  onClose,
  onCropped,
}: {
  file: File | null
  onClose: () => void
  onCropped: (blob: Blob) => void
}) {
  const source = useMemo(() => file ? URL.createObjectURL(file) : '', [file])
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [cropPixels, setCropPixels] = useState<Area | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [zoom, setZoom] = useState(1)

  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source)
  }, [source])

  async function confirm() {
    if (!cropPixels) return
    setPending(true)
    setError('')
    try {
      onCropped(await cropToWebp(source, cropPixels))
      onClose()
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : 'ปรับรูปไม่สำเร็จ')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose() }} open={Boolean(file)}>
      <DialogContent className="crop-dialog">
        <DialogHeader>
          <DialogTitle>จัดตำแหน่งรูปเมนู</DialogTitle>
          <DialogDescription>ลากรูปและซูมให้เมนูอยู่กลางกรอบสี่เหลี่ยม</DialogDescription>
        </DialogHeader>
        <div className="crop-stage">
          {source ? (
            <Cropper
              aspect={1}
              crop={crop}
              image={source}
              onCropChange={setCrop}
              onCropComplete={(_, pixels) => setCropPixels(pixels)}
              onZoomChange={setZoom}
              showGrid={false}
              zoom={zoom}
            />
          ) : null}
        </div>
        <label className="crop-zoom">
          <span>ซูม</span>
          <input
            aria-label="ซูมรูป"
            max="3"
            min="1"
            onChange={(event) => setZoom(Number(event.target.value))}
            step="0.05"
            type="range"
            value={zoom}
          />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="secondary">ยกเลิก</Button>
          <Button disabled={pending || !cropPixels} onClick={confirm} type="button">
            {pending ? 'กำลังปรับรูป...' : 'ใช้รูปนี้'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
