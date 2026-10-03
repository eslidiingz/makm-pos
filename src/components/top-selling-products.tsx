'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { requestJson } from '@/lib/api-client'
import { salesPeriodOptions } from '@/lib/sales-periods'
import type {
  SalesPeriod,
  TopSellingProductsReport,
} from '@/server/orders/types'

const money = new Intl.NumberFormat('th-TH', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

export function TopSellingProducts() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<SalesPeriod>('this_month')
  const [reloadToken, setReloadToken] = useState(0)
  const [report, setReport] = useState<TopSellingProductsReport | null>(null)
  const requestVersion = useRef(0)

  const load = useCallback(async (selectedPeriod: SalesPeriod, signal: AbortSignal) => {
    const version = ++requestVersion.current
    setLoading(true)
    setError('')
    try {
      const next = await requestJson<TopSellingProductsReport>(
        `/api/admin/sales/top-products?period=${selectedPeriod}`,
        { signal },
      )
      if (version === requestVersion.current) setReport(next)
    } catch (requestError) {
      if (
        version === requestVersion.current
        && (requestError as Error).name !== 'AbortError'
      ) {
        setError(requestError instanceof Error ? requestError.message : 'โหลดอันดับเมนูไม่สำเร็จ')
      }
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => void load(period, controller.signal), 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [load, period, reloadToken])

  const topQuantity = report?.items[0]?.quantity ?? 1

  return (
    <section aria-labelledby="top-products-title" className="top-products-panel">
      <header className="top-products-header">
        <div>
          <p className="eyebrow">BEST SELLERS</p>
          <h2 id="top-products-title">เมนูขายดี 10 อันดับ</h2>
          <p>เรียงตามจำนวนไม้ที่ขาย พร้อมยอดขายรวม</p>
        </div>
        <div aria-label="ช่วงเวลาอันดับเมนูขายดี" className="top-products-periods" role="group">
          {salesPeriodOptions.map((option) => (
            <Button
              aria-pressed={period === option.value}
              className={period === option.value ? 'active' : ''}
              key={option.value}
              onClick={() => setPeriod(option.value)}
              size="small"
              type="button"
              variant="ghost"
            >
              {option.label}
            </Button>
          ))}
        </div>
      </header>

      {loading ? (
        <div aria-label="กำลังโหลดอันดับเมนู" className="top-products-loading">
          {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
        </div>
      ) : error ? (
        <div className="top-products-state" role="alert">
          <h3>โหลดอันดับเมนูไม่สำเร็จ</h3>
          <p>{error}</p>
          <Button onClick={() => setReloadToken((value) => value + 1)} size="small" variant="secondary">
            ลองใหม่
          </Button>
        </div>
      ) : report?.items.length ? (
        <ol className="top-products-list">
          {report.items.map((item) => (
            <li className="top-product-row" key={item.productId ?? `legacy-${item.productName}`}>
              <span className="top-product-rank">{item.rank.toLocaleString('th-TH')}</span>
              <div className="top-product-copy">
                <div>
                  <strong>{item.productName}</strong>
                  {item.isArchived ? <span className="top-product-archived">เก็บแล้ว</span> : null}
                </div>
                <small>{item.categoryName ?? 'ไม่ระบุประเภท'}</small>
                <span aria-hidden="true" className="top-product-bar">
                  <span style={{ width: `${Math.max(4, (item.quantity / topQuantity) * 100)}%` }} />
                </span>
              </div>
              <div className="top-product-values">
                <strong>{item.quantity.toLocaleString('th-TH')} ไม้</strong>
                <span>฿{money.format(item.totalSales)}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="top-products-state">
          <h3>ยังไม่มียอดขายในช่วงนี้</h3>
          <p>เมื่อยืนยันการขายจาก POS อันดับเมนูจะแสดงที่นี่</p>
          <Link className="ui-button ui-button-primary ui-button-small" href="/pos">
            ไปหน้ารับออเดอร์
          </Link>
        </div>
      )}

      <footer className="top-products-footer">
        <span>อัปเดตจากออเดอร์ที่ชำระแล้ว</span>
        <Link href="/reports">ดูรายงานยอดขายทั้งหมด →</Link>
      </footer>
    </section>
  )
}
