'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ApiRequestError, requestJson } from '@/lib/api-client'
import type { Catalog, Product } from '@/server/catalog/types'
import type { PaidOrder } from '@/server/orders/types'

type CartItem = Product & { quantity: number }

const PRODUCTS_PER_PAGE = 12

function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    const value = character === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

export function PosScreen() {
  const categoryAllButtonRef = useRef<HTMLButtonElement | null>(null)
  const firstProductButtonRef = useRef<HTMLButtonElement | null>(null)
  const shouldFocusCatalogAfterCancelRef = useRef(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartAnnouncement, setCartAnnouncement] = useState('')
  const [cancelOrderOpen, setCancelOrderOpen] = useState(false)
  const [catalog, setCatalog] = useState<Catalog>({ categories: [], products: [] })
  const [categoryId, setCategoryId] = useState('all')
  const [productPage, setProductPage] = useState(1)
  const [checkoutError, setCheckoutError] = useState('')
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutPending, setCheckoutPending] = useState(false)
  const [checkoutRequestId, setCheckoutRequestId] = useState('')
  const [completedOrder, setCompletedOrder] = useState<PaidOrder | null>(null)
  const [error, setError] = useState('')
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const visibleProducts = categoryId === 'all'
    ? catalog.products
    : catalog.products.filter((product) => product.categoryId === categoryId)
  const totalProductPages = Math.max(1, Math.ceil(visibleProducts.length / PRODUCTS_PER_PAGE))
  const currentProductPage = Math.min(productPage, totalProductPages)
  const productPageStart = (currentProductPage - 1) * PRODUCTS_PER_PAGE
  const paginatedProducts = visibleProducts.slice(productPageStart, productPageStart + PRODUCTS_PER_PAGE)
  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart])
  const itemCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart])

  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    const next = await requestJson<Catalog>('/api/catalog', { signal })
    setCatalog(next)
    return next
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        await loadCatalog(controller.signal)
      } catch (requestError) {
        if ((requestError as Error).name !== 'AbortError') setError('เชื่อมต่อข้อมูลเมนูไม่ได้')
      } finally {
        setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [loadCatalog])

  useEffect(() => {
    if (cancelOrderOpen || !shouldFocusCatalogAfterCancelRef.current) return
    const nextFocusTarget = firstProductButtonRef.current ?? categoryAllButtonRef.current
    nextFocusTarget?.focus()
    shouldFocusCatalogAfterCancelRef.current = false
  }, [cancelOrderOpen, paginatedProducts.length])

  function add(product: Product) {
    setCartAnnouncement('')
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id)
      return existing
        ? current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { ...product, quantity: 1 }]
    })
  }

  function changeQuantity(id: string, delta: number) {
    setCartAnnouncement('')
    setCart((current) => current
      .map((item) => item.id === id ? { ...item, quantity: item.quantity + delta } : item)
      .filter((item) => item.quantity > 0))
  }

  function cancelOrder() {
    if (!cart.length) return
    const canceledItemCount = itemCount
    setCart([])
    setCartAnnouncement(`ยกเลิกรายการทั้งหมด ${canceledItemCount.toLocaleString('th-TH')} รายการแล้ว`)
    setCancelOrderOpen(false)
    shouldFocusCatalogAfterCancelRef.current = true
  }

  function selectCategory(id: string) {
    setCategoryId(id)
    setProductPage(1)
  }

  function openCheckout() {
    setCheckoutError('')
    setCheckoutRequestId(createRequestId())
    setCheckoutOpen(true)
  }

  async function confirmCheckout() {
    if (!cart.length || !checkoutRequestId) return
    setCheckoutPending(true)
    setCheckoutError('')
    try {
      const response = await requestJson<{ order: PaidOrder }>('/api/orders', {
        body: JSON.stringify({
          items: cart.map((item) => ({
            expectedUnitPrice: item.price,
            productId: item.id,
            quantity: item.quantity,
          })),
          requestId: checkoutRequestId,
        }),
        method: 'POST',
      })
      setCart([])
      setCheckoutOpen(false)
      setCompletedOrder(response.order)
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.code === 'ORDER_CATALOG_CHANGED') {
        try {
          const latest = await loadCatalog()
          const latestProducts = new Map(latest.products.map((product) => [product.id, product]))
          setCart((current) => current.map((item) => {
            const product = latestProducts.get(item.id)
            return product ? { ...item, ...product, quantity: item.quantity } : item
          }))
        } catch {
          // Keep the original cart if the refresh also fails.
        }
      }
      setCheckoutError(requestError instanceof Error ? requestError.message : 'บันทึกการขายไม่สำเร็จ')
    } finally {
      setCheckoutPending(false)
    }
  }

  return (
    <main className="pos-shell">
      <section className="catalog">
        <header className="app-header">
          <div className="brand"><span className="brand-mark">M</span><div><p className="eyebrow">MAKM POS</p><h1>รับออเดอร์</h1></div></div>
          <div className="store-status"><span className="status-dot" />เปิดร้าน <Link className="avatar" href="/" aria-label="กลับแดชบอร์ด">MK</Link></div>
        </header>
        <div className="catalog-intro"><div><h2>เลือกเมนู</h2><p>แตะรายการเพื่อเพิ่มในออเดอร์</p></div><span className="date-label">วันนี้</span></div>
        <nav aria-label="หมวดหมู่สินค้า" className="categories">
          <Button className={categoryId === 'all' ? 'active' : ''} onClick={() => selectCategory('all')} ref={categoryAllButtonRef} size="small" type="button" variant="ghost">ทั้งหมด</Button>
          {catalog.categories.map((category) => <Button className={categoryId === category.id ? 'active' : ''} key={category.id} onClick={() => selectCategory(category.id)} size="small" type="button" variant="ghost">{category.name}</Button>)}
        </nav>
        {loading ? <div className="pos-catalog-state"><div className="auth-loader" /><p>กำลังโหลดเมนู...</p></div> : error ? <div className="pos-catalog-state"><h3>โหลดเมนูไม่สำเร็จ</h3><p>{error}</p><Button onClick={() => window.location.reload()} size="small">ลองใหม่</Button></div> : visibleProducts.length ? <>
          <div className="products">
            {paginatedProducts.map((product, index) => <button className={`product${product.imageUrl && !failedImageIds.has(product.id) ? ' has-image' : ''}`} key={product.id} onClick={() => add(product)} ref={index === 0 ? firstProductButtonRef : undefined} type="button">
              {product.imageUrl && !failedImageIds.has(product.id) ? (
                // Images are pre-sized WebP assets served by the R2 custom domain.
                // A failed fetch drops back to the plain card instead of leaving
                // the browser's broken-image icon on the sales screen.
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={product.name} height="480" loading="lazy" onError={() => setFailedImageIds((current) => new Set(current).add(product.id))} src={product.imageUrl} width="480" />
              ) : null}
              <span className="product-category">{product.categoryName}</span><span className="product-name">{product.name}</span><strong>฿{product.price.toLocaleString('th-TH')}</strong>
            </button>)}
          </div>
          {totalProductPages > 1 ? (
            <nav aria-label="เปลี่ยนหน้ารายการเมนู" className="pos-pagination">
              <Button disabled={currentProductPage === 1} onClick={() => setProductPage(currentProductPage - 1)} size="small" type="button" variant="secondary">← ก่อนหน้า</Button>
              <span aria-live="polite">
                <strong>หน้า {currentProductPage.toLocaleString('th-TH')} / {totalProductPages.toLocaleString('th-TH')}</strong>
                <small>รายการ {(productPageStart + 1).toLocaleString('th-TH')}–{Math.min(productPageStart + PRODUCTS_PER_PAGE, visibleProducts.length).toLocaleString('th-TH')} จาก {visibleProducts.length.toLocaleString('th-TH')} เมนู</small>
              </span>
              <Button disabled={currentProductPage === totalProductPages} onClick={() => setProductPage(currentProductPage + 1)} size="small" type="button" variant="secondary">ถัดไป →</Button>
            </nav>
          ) : null}
        </> : <div className="pos-catalog-state"><h3>{catalog.products.length ? 'ไม่มีเมนูในประเภทนี้' : 'ยังไม่มีเมนูพร้อมขาย'}</h3><p>{catalog.products.length ? 'ลองเลือกประเภทอื่น' : 'เพิ่มประเภทและเมนูก่อนเริ่มรับออเดอร์'}</p>{catalog.products.length ? null : <Link className="ui-button ui-button-primary ui-button-small" href="/products">ไปจัดการเมนู</Link>}</div>}
      </section>
      <aside className="cart">
        <header className="cart-header"><p className="eyebrow">โต๊ะ / รับกลับบ้าน</p><Button className="cancel-order" disabled={!cart.length} onClick={() => setCancelOrderOpen(true)} size="small" type="button" variant="ghost">ยกเลิกออเดอร์</Button><h2>ออเดอร์ใหม่</h2><span className="item-count">{itemCount} รายการ</span></header>
        <p aria-live="polite" className="visually-hidden">{cartAnnouncement}</p>
        <div className="cart-items">{cart.length === 0 ? <p className="empty">เลือกสินค้าเพื่อเริ่มออเดอร์</p> : cart.map((item) => <div className="cart-item" key={item.id}><div><strong>{item.name}</strong><small>฿{item.price.toLocaleString('th-TH')} / ไม้</small></div><div className="quantity"><Button onClick={() => changeQuantity(item.id, -1)} aria-label={`ลด ${item.name}`} size="icon" type="button" variant="secondary">−</Button><span>{item.quantity}</span><Button onClick={() => changeQuantity(item.id, 1)} aria-label={`เพิ่ม ${item.name}`} size="icon" type="button" variant="secondary">+</Button></div></div>)}</div>
        <footer><div className="total"><span>รวมทั้งหมด <small>ยังไม่รวมส่วนลด</small></span><strong>฿{total.toLocaleString('th-TH')}</strong></div><Button className="checkout" disabled={!cart.length} onClick={openCheckout}>สรุปออเดอร์ <span>→</span></Button></footer>
      </aside>

      <ConfirmDialog
        confirmLabel="ล้างรายการทั้งหมด"
        description={`รายการทั้งหมด ${itemCount.toLocaleString('th-TH')} รายการจะถูกล้างออกจากออเดอร์นี้ และจะไม่มีการบันทึกยอดขาย`}
        onConfirm={cancelOrder}
        onOpenChange={setCancelOrderOpen}
        open={cancelOrderOpen}
        title="ยกเลิกออเดอร์ใหม่?"
      />

      <Dialog onOpenChange={(open) => { if (!checkoutPending) setCheckoutOpen(open) }} open={checkoutOpen}>
        <DialogContent className="checkout-dialog">
          <DialogHeader>
            <DialogTitle>สรุปออเดอร์</DialogTitle>
            <DialogDescription>ตรวจสอบรายการและยอดรวมก่อนบันทึกออเดอร์นี้เป็นยอดขาย</DialogDescription>
          </DialogHeader>
          <div className="checkout-summary">
            {cart.map((item) => (
              <div className="checkout-line" key={item.id}>
                <div><strong>{item.name}</strong><span>{item.quantity} ไม้ × ฿{item.price.toLocaleString('th-TH')}</span></div>
                <strong>฿{(item.quantity * item.price).toLocaleString('th-TH')}</strong>
              </div>
            ))}
          </div>
          <div className="checkout-grand-total"><span>ยอดรวมออเดอร์</span><strong>฿{total.toLocaleString('th-TH')}</strong></div>
          {checkoutError ? <p className="form-error" role="alert">{checkoutError}</p> : null}
          <DialogFooter>
            <Button disabled={checkoutPending} onClick={() => setCheckoutOpen(false)} type="button" variant="secondary">กลับไปแก้ไข</Button>
            <Button disabled={checkoutPending} onClick={() => void confirmCheckout()} type="button">{checkoutPending ? 'กำลังบันทึก...' : 'บันทึกการขาย'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => { if (!open) setCompletedOrder(null) }} open={Boolean(completedOrder)}>
        <DialogContent className="sale-success-dialog">
          <div className="sale-success-mark">✓</div>
          <DialogHeader>
            <DialogTitle>บันทึกการขายสำเร็จ</DialogTitle>
            <DialogDescription>ออเดอร์ #{completedOrder?.orderNumber} ถูกบันทึกในรายงานยอดขายแล้ว</DialogDescription>
          </DialogHeader>
          <div className="sale-success-total">฿{completedOrder?.total.toLocaleString('th-TH')}</div>
          <DialogFooter>
            <Button onClick={() => setCompletedOrder(null)} type="button">เริ่มออเดอร์ใหม่</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
