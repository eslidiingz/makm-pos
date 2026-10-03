'use client'

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  GripVertical,
  ImagePlus,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { ImageCropper } from '@/components/image-cropper'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FieldError } from '@/components/ui/field-error'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ProductImage } from '@/components/ui/product-image'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { requestJson } from '@/lib/api-client'
import { applyReorder } from '@/lib/catalog-order'
import { requiredField, useFormValidation } from '@/lib/form-validation'
import { cn } from '@/lib/utils'
import type { Catalog, Category, Product } from '@/server/catalog/types'
import { MAX_SOURCE_IMAGE_BYTES, WEBP_CONTENT_TYPE } from '@/server/catalog/validation'

type DialogState<T> = T | 'new' | null

const PRODUCTS_PER_PAGE = 9

function SortableCategory({
  active,
  category,
  count,
  onArchive,
  onEdit,
  onMove,
  onSelect,
  onToggle,
}: {
  active: boolean
  category: Category
  count: number
  onArchive: () => void
  onEdit: () => void
  onMove: (delta: number) => void
  onSelect: () => void
  onToggle: (active: boolean) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: category.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div className={`category-row${active ? ' selected' : ''}`} ref={setNodeRef} style={style}>
      <button
        aria-label={`ลากจัดลำดับ ${category.name}`}
        className="drag-handle"
        type="button"
        {...attributes}
        {...listeners}
      ><GripVertical size={17} /></button>
      <button className="category-main" onClick={onSelect} type="button">
        <strong>{category.name}</strong><span>{count} เมนู</span>
      </button>
      <Switch aria-label={`เปิดใช้งาน ${category.name}`} checked={category.isActive} onCheckedChange={onToggle} />
      <div className="row-actions">
        <div className="row-actions-group">
          <Button aria-label="เลื่อนขึ้น" onClick={() => onMove(-1)} size="icon" type="button" variant="ghost"><ArrowUp size={15} /></Button>
          <Button aria-label="เลื่อนลง" onClick={() => onMove(1)} size="icon" type="button" variant="ghost"><ArrowDown size={15} /></Button>
        </div>
        <div className="row-actions-group">
          <Button aria-label="แก้ไขประเภท" onClick={onEdit} size="icon" type="button" variant="ghost"><Pencil size={15} /></Button>
          <Button aria-label="เก็บประเภท" onClick={onArchive} size="icon" type="button" variant="ghost"><Archive size={15} /></Button>
        </div>
      </div>
    </div>
  )
}

function SortableProduct({
  onArchive,
  onEdit,
  onMove,
  onToggle,
  product,
}: {
  onArchive: () => void
  onEdit: () => void
  onMove: (delta: number) => void
  onToggle: (available: boolean) => void
  product: Product
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: product.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <Card className="catalog-product-card" ref={setNodeRef} style={style}>
      <div className="product-image-wrap">
        <ProductImage
          alt={product.name}
          fallback={<div className="product-image-placeholder"><ImagePlus aria-hidden="true" size={28} /><span>ยังไม่มีรูป</span></div>}
          src={product.imageUrl}
        />
        <button
          aria-label={`ลากจัดลำดับ ${product.name}`}
          className="product-drag"
          type="button"
          {...attributes}
          {...listeners}
        ><GripVertical size={17} /></button>
      </div>
      <div className="catalog-product-copy">
        <div className="catalog-product-title"><strong>{product.name}</strong><span>฿{product.price.toLocaleString('th-TH')} / ไม้</span></div>
        <Switch aria-label={`เปิดขาย ${product.name}`} checked={product.isAvailable} onCheckedChange={onToggle} />
      </div>
      <div className="catalog-product-actions">
        <div className="catalog-product-actions-group">
          <Button aria-label={`เลื่อนขึ้น ${product.name}`} onClick={() => onMove(-1)} size="icon" type="button" variant="ghost"><ArrowUp size={15} /></Button>
          <Button aria-label={`เลื่อนลง ${product.name}`} onClick={() => onMove(1)} size="icon" type="button" variant="ghost"><ArrowDown size={15} /></Button>
        </div>
        <div className="catalog-product-actions-group">
          <Button aria-label={`เก็บ ${product.name}`} onClick={onArchive} size="icon" type="button" variant="ghost"><Archive size={15} /></Button>
          <Button aria-label={`แก้ไข ${product.name}`} onClick={onEdit} size="icon" type="button" variant="secondary"><Pencil size={15} /></Button>
        </div>
      </div>
    </Card>
  )
}

const CATEGORY_SCHEMA = {
  name: requiredField('กรุณากรอกชื่อประเภท'),
}

const PRODUCT_SCHEMA = {
  categoryId: requiredField('กรุณาเลือกประเภท'),
  name: requiredField('กรุณากรอกชื่อเมนู'),
  price: (value: string) => {
    if (!value.trim()) return 'กรุณากรอกราคา'
    const price = Number(value)
    if (!Number.isFinite(price) || price < 0) return 'ราคาต้องเป็นตัวเลขไม่ติดลบ'
    return price <= 999999.99 ? null : 'ราคาสูงเกินกำหนด'
  },
}

function CategoryForm({
  category,
  onOpenChange,
  onSaved,
}: {
  category: DialogState<Category>
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}) {
  const editing = category !== 'new' && category !== null ? category : null
  const [active, setActive] = useState(editing?.isActive ?? true)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const { fieldErrors, fieldProps, validate } = useFormValidation(CATEGORY_SCHEMA)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    if (!validate({ name: String(form.get('name') ?? '') })) return

    setPending(true)
    try {
      await requestJson(editing ? `/api/admin/categories/${editing.id}` : '/api/admin/categories', {
        body: JSON.stringify({ isActive: active, name: form.get('name') }),
        method: editing ? 'PATCH' : 'POST',
      })
      await onSaved()
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(category)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'แก้ไขประเภทเมนู' : 'เพิ่มประเภทเมนู'}</DialogTitle>
          <DialogDescription>ใช้ชื่อสั้นและชัดเจนเพื่อให้พนักงานค้นหาได้เร็ว</DialogDescription>
        </DialogHeader>
        <form className="catalog-form" noValidate onSubmit={submit}>
          <Label htmlFor="category-name" required>ชื่อประเภท</Label>
          <Input autoFocus defaultValue={editing?.name} id="category-name" maxLength={80} name="name" placeholder="เช่น เนื้อสัตว์" required {...fieldProps('name')} />
          <FieldError id="name-error" message={fieldErrors.name} />
          <div className="form-switch-row"><div className="form-switch-copy"><strong>เปิดใช้งานประเภท</strong><span>ประเภทที่ปิดจะไม่แสดงใน POS</span></div><Switch checked={active} onCheckedChange={setActive} /></div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">ยกเลิก</Button>
            <Button disabled={pending} type="submit">{pending ? 'กำลังบันทึก...' : 'บันทึกประเภท'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProductForm({
  categories,
  defaultCategoryId,
  onOpenChange,
  onSaved,
  product,
}: {
  categories: Category[]
  defaultCategoryId: string
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
  product: DialogState<Product>
}) {
  const editing = product !== 'new' && product !== null ? product : null
  const [available, setAvailable] = useState(editing?.isAvailable ?? true)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [imageBlob, setImageBlob] = useState<Blob | null>(null)
  const [imageRemoved, setImageRemoved] = useState(false)
  const [pending, setPending] = useState(false)
  const { clearField, fieldErrors, fieldProps, validate } = useFormValidation(PRODUCT_SCHEMA)
  const preview = useMemo(
    () => imageBlob ? URL.createObjectURL(imageBlob) : imageRemoved ? null : editing?.imageUrl ?? null,
    [editing?.imageUrl, imageBlob, imageRemoved],
  )

  useEffect(() => () => {
    if (imageBlob && preview) URL.revokeObjectURL(preview)
  }, [imageBlob, preview])

  function chooseImage(file: File | undefined) {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('รองรับเฉพาะ JPEG, PNG และ WebP')
      return
    }
    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      setError('รูปต้นฉบับต้องมีขนาดไม่เกิน 10 MB')
      return
    }
    setError('')
    setCropFile(file)
  }

  async function uploadImage(blob: Blob) {
    const presigned = await requestJson<{ pendingKey: string; uploadUrl: string }>(
      '/api/admin/product-images/presign',
      {
        body: JSON.stringify({ contentType: WEBP_CONTENT_TYPE, size: blob.size }),
        method: 'POST',
      },
    )
    const upload = await fetch(presigned.uploadUrl, {
      body: blob,
      headers: { 'Content-Type': WEBP_CONTENT_TYPE },
      method: 'PUT',
    })
    if (!upload.ok) throw new Error('อัปโหลดรูปไป Cloudflare R2 ไม่สำเร็จ')
    return presigned.pendingKey
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    if (!validate({
      categoryId: String(form.get('categoryId') ?? ''),
      name: String(form.get('name') ?? ''),
      price: String(form.get('price') ?? ''),
    })) return

    setPending(true)
    try {
      const pendingImageKey = imageBlob
        ? await uploadImage(imageBlob)
        : imageRemoved ? null : undefined
      const body: Record<string, unknown> = {
        categoryId: form.get('categoryId'),
        isAvailable: available,
        name: form.get('name'),
        price: Number(form.get('price')),
      }
      if (pendingImageKey !== undefined) body.pendingImageKey = pendingImageKey

      await requestJson(editing ? `/api/admin/products/${editing.id}` : '/api/admin/products', {
        body: JSON.stringify(body),
        method: editing ? 'PATCH' : 'POST',
      })
      await onSaved()
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'บันทึกเมนูไม่สำเร็จ')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={Boolean(product)}>
        <DialogContent className="product-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? 'แก้ไขเมนู' : 'เพิ่มเมนูใหม่'}</DialogTitle>
            <DialogDescription>กำหนดชื่อ ราคา ประเภท รูป และสถานะพร้อมขาย</DialogDescription>
          </DialogHeader>
          <form className="catalog-form product-form-grid" noValidate onSubmit={submit}>
            <div className="product-image-editor">
              <div className="product-image-frame">
                <label
                  className={cn('product-image-dropzone', dragging && 'is-dragging')}
                  htmlFor="product-image"
                  onDragLeave={() => setDragging(false)}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
                  onDrop={(event) => {
                    event.preventDefault()
                    setDragging(false)
                    chooseImage(event.dataTransfer.files?.[0])
                  }}
                >
                  <ProductImage
                    alt="ตัวอย่างรูปเมนู"
                    fallback={<div className="product-image-placeholder large"><ImagePlus size={34} /><span>คลิกหรือลากรูปมาวางที่นี่</span></div>}
                    src={preview}
                  />
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    className="visually-hidden"
                    id="product-image"
                    onChange={(event) => chooseImage(event.target.files?.[0])}
                    type="file"
                  />
                </label>
                {preview ? (
                  <Button
                    aria-label="ลบรูป"
                    className="product-image-remove"
                    onClick={() => { setImageBlob(null); setImageRemoved(true) }}
                    size="icon"
                    type="button"
                    variant="ghost"
                  ><Trash2 size={15} /></Button>
                ) : null}
              </div>
              <p className="field-hint">{imageRemoved && editing?.imageUrl ? 'รูปเดิมจะถูกลบเมื่อกดบันทึกเมนู' : 'JPEG, PNG หรือ WebP ไม่เกิน 10 MB'}</p>
            </div>
            <div className="product-fields">
              <div className="catalog-field">
                <Label htmlFor="product-name" required>ชื่อเมนู</Label>
                <Input autoFocus defaultValue={editing?.name} id="product-name" maxLength={80} name="name" placeholder="เช่น หมูสามชั้น" required {...fieldProps('name')} />
                <FieldError id="name-error" message={fieldErrors.name} />
              </div>
              <div className="catalog-field">
                <Label htmlFor="product-price" required>ราคาต่อไม้</Label>
                <div className="price-input"><span>฿</span><Input defaultValue={editing?.price} id="product-price" max="999999.99" min="0" name="price" placeholder="0.00" required step="0.01" type="number" {...fieldProps('price')} /></div>
                <FieldError id="price-error" message={fieldErrors.price} />
              </div>
              <div className="catalog-field">
                <Label htmlFor="product-category" required>ประเภท</Label>
                <Select defaultValue={editing?.categoryId ?? defaultCategoryId} name="categoryId" onValueChange={() => clearField('categoryId')}>
                  <SelectTrigger
                    aria-describedby={fieldErrors.categoryId ? 'categoryId-error' : undefined}
                    aria-invalid={fieldErrors.categoryId ? true : undefined}
                    id="product-category"
                    required
                  ><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.filter((category) => !category.archivedAt).map((category) => (
                      <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id="categoryId-error" message={fieldErrors.categoryId} />
              </div>
              <div className="form-switch-row"><div className="form-switch-copy"><strong>เปิดขายใน POS</strong><span>ปิดชั่วคราวเมื่อเมนูหมดได้</span></div><Switch checked={available} onCheckedChange={setAvailable} /></div>
            </div>
            {error ? <p className="form-error product-form-error" role="alert">{error}</p> : null}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">ยกเลิก</Button>
              <Button disabled={pending} type="submit">{pending ? 'กำลังบันทึก...' : 'บันทึกเมนู'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ImageCropper
        file={cropFile}
        onClose={() => setCropFile(null)}
        onCropped={(blob) => { setImageBlob(blob); setImageRemoved(false) }}
      />
    </>
  )
}

export function CatalogManager() {
  const [catalog, setCatalog] = useState<Catalog>({ categories: [], products: [] })
  const [categoryDialog, setCategoryDialog] = useState<DialogState<Category>>(null)
  const [confirmAction, setConfirmAction] = useState<null | { description: string; run: () => Promise<void>; title: string }>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pendingConfirm, setPendingConfirm] = useState(false)
  const [productDialog, setProductDialog] = useState<DialogState<Product>>(null)
  const [productPage, setProductPage] = useState(1)
  const [renderedCategoryId, setRenderedCategoryId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  // Touch needs a press-and-hold so a finger swipe still scrolls the catalog,
  // while a mouse drags as soon as it clears the accidental-click threshold.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const loadCatalog = useCallback(async () => {
    setError('')
    let loadError: unknown
    for (const delay of [0, 350, 900]) {
      if (delay) await new Promise<void>((resolve) => window.setTimeout(resolve, delay))
      try {
        const next = await requestJson<Catalog>('/api/admin/catalog')
        setCatalog(next)
        setSelectedCategoryId((current) => {
          if (next.categories.some((category) => category.id === current && !category.archivedAt)) return current
          return next.categories.find((category) => !category.archivedAt)?.id ?? ''
        })
        setLoading(false)
        return
      } catch (error) {
        loadError = error
      }
    }
    setError(loadError instanceof Error ? loadError.message : 'โหลดข้อมูลเมนูไม่สำเร็จ')
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalog(), 0)
    return () => window.clearTimeout(timer)
  }, [loadCatalog])

  // Resetting during render keeps the first page in sync with the selected
  // category without the extra pass an effect would cost.
  if (renderedCategoryId !== selectedCategoryId) {
    setRenderedCategoryId(selectedCategoryId)
    setProductPage(1)
  }

  const activeCategories = catalog.categories.filter((category) => !category.archivedAt)
  const archivedCategories = catalog.categories.filter((category) => category.archivedAt)
  const selectedCategory = catalog.categories.find((category) => category.id === selectedCategoryId)
  const products = catalog.products.filter(
    (product) => product.categoryId === selectedCategoryId && !product.archivedAt,
  )
  const archivedProducts = catalog.products.filter(
    (product) => product.categoryId === selectedCategoryId && product.archivedAt,
  )
  const totalProductPages = Math.max(1, Math.ceil(products.length / PRODUCTS_PER_PAGE))
  const currentProductPage = Math.min(productPage, totalProductPages)
  const productPageStart = (currentProductPage - 1) * PRODUCTS_PER_PAGE
  const paginatedProducts = products.slice(productPageStart, productPageStart + PRODUCTS_PER_PAGE)

  async function mutate(url: string, body?: unknown, method = 'POST') {
    await requestJson(url, { body: body === undefined ? undefined : JSON.stringify(body), method })
    await loadCatalog()
  }

  async function toggleCategory(category: Category, active: boolean) {
    await mutate(`/api/admin/categories/${category.id}`, { isActive: active, name: category.name }, 'PATCH')
  }

  async function toggleProduct(product: Product, available: boolean) {
    await mutate(`/api/admin/products/${product.id}`, {
      categoryId: product.categoryId,
      isAvailable: available,
      name: product.name,
      price: product.price,
    }, 'PATCH')
  }

  async function reorderCategories(next: Category[]) {
    setCatalog((current) => ({ ...current, categories: applyReorder(current.categories, next) }))
    try {
      await requestJson('/api/admin/categories/reorder', {
        body: JSON.stringify({ ids: next.map((category) => category.id) }),
        method: 'POST',
      })
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : 'จัดลำดับไม่สำเร็จ')
      await loadCatalog()
    }
  }

  async function reorderProducts(next: Product[]) {
    setCatalog((current) => ({ ...current, products: applyReorder(current.products, next) }))
    try {
      await requestJson('/api/admin/products/reorder', {
        body: JSON.stringify({ categoryId: selectedCategoryId, ids: next.map((product) => product.id) }),
        method: 'POST',
      })
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : 'จัดลำดับไม่สำเร็จ')
      await loadCatalog()
    }
  }

  function categoryDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return
    const oldIndex = activeCategories.findIndex((category) => category.id === event.active.id)
    const newIndex = activeCategories.findIndex((category) => category.id === event.over?.id)
    void reorderCategories(arrayMove(activeCategories, oldIndex, newIndex))
  }

  function productDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return
    const oldIndex = products.findIndex((product) => product.id === event.active.id)
    const newIndex = products.findIndex((product) => product.id === event.over?.id)
    void reorderProducts(arrayMove(products, oldIndex, newIndex))
  }

  async function runConfirm() {
    if (!confirmAction) return
    setPendingConfirm(true)
    try {
      await confirmAction.run()
      setConfirmAction(null)
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setPendingConfirm(false)
    }
  }

  return (
    <main className="catalog-page">
      <header className="catalog-page-header">
        <div><Link className="back-link" href="/"><ArrowLeft size={16} /> กลับแดชบอร์ด</Link><p className="eyebrow">MENU MANAGEMENT</p><h1>ประเภทและเมนู</h1><p>เตรียมรายการขายและรูปเมนูก่อนเปิดรับออเดอร์</p></div>
      </header>

      {error ? <div className="catalog-alert" role="alert"><span>{error}</span><Button onClick={loadCatalog} size="small" variant="ghost">ลองใหม่</Button></div> : null}

      <div className="catalog-layout">
        <aside className="category-panel">
          <div className="panel-heading category-panel-heading"><div><p className="eyebrow">CATEGORIES</p><h2>ประเภทเมนู</h2></div><div className="category-panel-actions"><span>{activeCategories.length}</span><Button onClick={() => setCategoryDialog('new')} size="small" type="button" variant="secondary"><Plus size={15} /> เพิ่มประเภท</Button></div></div>
          {loading ? <p className="catalog-muted">กำลังโหลด...</p> : error && !activeCategories.length ? <div className="catalog-empty compact"><h3>โหลดประเภทเมนูไม่สำเร็จ</h3><p>ข้อมูลเดิมจะไม่ถูกลบ กรุณาลองใหม่อีกครั้ง</p></div> : activeCategories.length ? (
            <DndContext collisionDetection={closestCenter} onDragEnd={categoryDragEnd} sensors={sensors}>
              <SortableContext items={activeCategories.map((category) => category.id)} strategy={rectSortingStrategy}>
                <div className="category-list">
                  {activeCategories.map((category, index) => (
                    <SortableCategory
                      active={selectedCategoryId === category.id}
                      category={category}
                      count={catalog.products.filter((product) => product.categoryId === category.id && !product.archivedAt).length}
                      key={category.id}
                      onArchive={() => setConfirmAction({
                        description: `ประเภท “${category.name}” และเมนูภายในจะไม่แสดงใน POS แต่สามารถกู้คืนได้`,
                        run: () => mutate(`/api/admin/categories/${category.id}/archive`),
                        title: 'เก็บประเภทนี้หรือไม่?',
                      })}
                      onEdit={() => setCategoryDialog(category)}
                      onMove={(delta) => {
                        const target = index + delta
                        if (target >= 0 && target < activeCategories.length) void reorderCategories(arrayMove(activeCategories, index, target))
                      }}
                      onSelect={() => setSelectedCategoryId(category.id)}
                      onToggle={(active) => void toggleCategory(category, active).catch((toggleError) => setError(toggleError.message))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : <div className="catalog-empty compact"><h3>ยังไม่มีประเภทเมนู</h3><p>เริ่มจากสร้างประเภท เช่น เนื้อสัตว์ ผัก หรือของทานเล่น</p><Button onClick={() => setCategoryDialog('new')} size="small"><Plus size={15} /> เพิ่มประเภทแรก</Button></div>}

          {(archivedCategories.length || archivedProducts.length) ? (
            <button className="archive-toggle" onClick={() => setShowArchived((value) => !value)} type="button">
              <Archive size={15} /> รายการที่เก็บไว้ {showArchived ? '−' : '+'}
            </button>
          ) : null}
          {showArchived ? <div className="archived-list">
            {archivedCategories.map((category) => (
              <div key={category.id}>
                <span>{category.name}</span>
                <div className="archived-item-actions">
                  <Button onClick={() => void mutate(`/api/admin/categories/${category.id}/restore`)} size="small" variant="ghost"><RotateCcw size={13} /> กู้คืน</Button>
                  <Button
                    aria-label={`ลบประเภท ${category.name} ถาวร`}
                    onClick={() => setConfirmAction({
                      description: `ประเภท “${category.name}” จะถูกลบถาวรและไม่สามารถกู้คืนได้ (ต้องไม่มีเมนูเหลืออยู่ในประเภทนี้)`,
                      run: () => mutate(`/api/admin/categories/${category.id}`, undefined, 'DELETE'),
                      title: 'ลบประเภทนี้ถาวรใช่หรือไม่?',
                    })}
                    size="icon"
                    type="button"
                    variant="ghost"
                  ><Trash2 size={13} /></Button>
                </div>
              </div>
            ))}
          </div> : null}
        </aside>

        <section className="products-panel">
          <div className="panel-heading products-heading"><div><p className="eyebrow">PRODUCTS</p><h2>{selectedCategory?.name ?? 'เมนูทั้งหมด'}</h2><p>{products.length} เมนูพร้อมจัดการ</p></div>{selectedCategory ? <Button onClick={() => setProductDialog('new')} size="small"><Plus size={15} /> เพิ่มเมนู</Button> : null}</div>
          {error && !selectedCategory ? <div className="catalog-empty"><h3>โหลดเมนูไม่สำเร็จ</h3><p>กรุณาลองใหม่อีกครั้งเพื่อเชื่อมต่อข้อมูล</p></div> : !selectedCategory ? <div className="catalog-empty"><h3>สร้างประเภทก่อนเพิ่มเมนู</h3><p>ทุกเมนูต้องอยู่ในประเภทเพื่อให้ค้นหาใน POS ได้เร็ว</p></div> : products.length ? (
            <>
              <DndContext collisionDetection={closestCenter} onDragEnd={productDragEnd} sensors={sensors}>
                <SortableContext items={paginatedProducts.map((product) => product.id)} strategy={rectSortingStrategy}>
                  <div className="catalog-product-grid">
                    {paginatedProducts.map((product, localIndex) => {
                      const index = productPageStart + localIndex
                      return (
                        <SortableProduct
                          key={product.id}
                          onArchive={() => setConfirmAction({
                            description: `เมนู “${product.name}” จะไม่แสดงใน POS แต่ข้อมูลและรูปยังอยู่เพื่อกู้คืน`,
                            run: () => mutate(`/api/admin/products/${product.id}/archive`),
                            title: 'เก็บเมนูนี้หรือไม่?',
                          })}
                          onEdit={() => setProductDialog(product)}
                          onMove={(delta) => {
                            const target = index + delta
                            if (target < 0 || target >= products.length) return
                            setProductPage(Math.floor(target / PRODUCTS_PER_PAGE) + 1)
                            void reorderProducts(arrayMove(products, index, target))
                          }}
                          onToggle={(available) => void toggleProduct(product, available).catch((toggleError) => setError(toggleError.message))}
                          product={product}
                        />
                      )
                    })}
                  </div>
                </SortableContext>
              </DndContext>
              {totalProductPages > 1 ? (
                <nav aria-label="เปลี่ยนหน้ารายการเมนู" className="catalog-pagination">
                  <Button disabled={currentProductPage === 1} onClick={() => setProductPage(currentProductPage - 1)} size="small" type="button" variant="secondary">← ก่อนหน้า</Button>
                  <span aria-live="polite">
                    <strong>หน้า {currentProductPage.toLocaleString('th-TH')} / {totalProductPages.toLocaleString('th-TH')}</strong>
                    <small>รายการ {(productPageStart + 1).toLocaleString('th-TH')}–{Math.min(productPageStart + PRODUCTS_PER_PAGE, products.length).toLocaleString('th-TH')} จาก {products.length.toLocaleString('th-TH')} เมนู</small>
                  </span>
                  <Button disabled={currentProductPage === totalProductPages} onClick={() => setProductPage(currentProductPage + 1)} size="small" type="button" variant="secondary">ถัดไป →</Button>
                </nav>
              ) : null}
            </>
          ) : <div className="catalog-empty"><h3>ยังไม่มีเมนูในประเภทนี้</h3><p>กด “เพิ่มเมนู” ด้านบนเพื่อกำหนดชื่อ ราคา และรูปก่อนเริ่มขายใน POS</p></div>}

          {showArchived && archivedProducts.length ? <div className="archived-products"><h3>เมนูที่เก็บไว้</h3>{archivedProducts.map((product) => (
            <div key={product.id}>
              <span>{product.name}</span>
              <div className="archived-item-actions">
                <Button onClick={() => void mutate(`/api/admin/products/${product.id}/restore`)} size="small" variant="ghost"><RotateCcw size={13} /> กู้คืน</Button>
                <Button
                  aria-label={`ลบเมนู ${product.name} ถาวร`}
                  onClick={() => setConfirmAction({
                    description: `เมนู “${product.name}” และรูปภาพจะถูกลบถาวรและไม่สามารถกู้คืนได้`,
                    run: () => mutate(`/api/admin/products/${product.id}`, undefined, 'DELETE'),
                    title: 'ลบเมนูนี้ถาวรใช่หรือไม่?',
                  })}
                  size="icon"
                  type="button"
                  variant="ghost"
                ><Trash2 size={13} /></Button>
              </div>
            </div>
          ))}</div> : null}
        </section>
      </div>

      <CategoryForm category={categoryDialog} key={`category-${categoryDialog === 'new' ? 'new' : categoryDialog?.id ?? 'closed'}`} onOpenChange={(open) => { if (!open) setCategoryDialog(null) }} onSaved={loadCatalog} />
      <ProductForm categories={activeCategories} defaultCategoryId={selectedCategoryId} key={`product-${productDialog === 'new' ? 'new' : productDialog?.id ?? 'closed'}`} onOpenChange={(open) => { if (!open) setProductDialog(null) }} onSaved={loadCatalog} product={productDialog} />
      <ConfirmDialog description={confirmAction?.description ?? ''} onConfirm={() => void runConfirm()} onOpenChange={(open) => { if (!open) setConfirmAction(null) }} open={Boolean(confirmAction)} pending={pendingConfirm} title={confirmAction?.title ?? ''} />
    </main>
  )
}
