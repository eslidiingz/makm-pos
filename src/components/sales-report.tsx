'use client'

import { ChevronLeft, ChevronRight, ReceiptText } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { MonthlyProfit } from '@/components/monthly-profit'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'
import { requestJson } from '@/lib/api-client'
import {
  bangkokToday,
  formatCount,
  formatMoney,
  formatSignedMoney,
} from '@/lib/costing-format'
import { salesPeriodLabel, salesPeriodOptions } from '@/lib/sales-periods'
import type { ProfitReport } from '@/server/costing/types'
import type { SalesPeriod, SalesReport } from '@/server/orders/types'

const thaiDate = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'long',
  timeZone: 'Asia/Bangkok',
})

const thaiShortDate = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Bangkok',
})

const thaiTime = new Intl.DateTimeFormat('th-TH', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Bangkok',
})

function formatThaiDate(date: string) {
  return thaiDate.format(new Date(`${date}T12:00:00+07:00`))
}

function formatReportRange(startAt: string, endAt: string) {
  const startLabel = thaiDate.format(new Date(startAt))
  const endLabel = thaiDate.format(new Date(new Date(endAt).getTime() - 1))
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`
}

function formatReportLabel(report: SalesReport | null) {
  if (!report) return 'กำลังเตรียมรายงาน'
  if (report.date) return formatThaiDate(report.date)
  if (!report.period) return formatReportRange(report.range.startAt, report.range.endAt)

  const endLabel = thaiDate.format(new Date(new Date(report.range.endAt).getTime() - 1))
  const startLabel = thaiShortDate.format(new Date(report.range.startAt))

  if (report.period === 'today') return endLabel

  return `${salesPeriodLabel[report.period]} · ${startLabel} - ${endLabel}`
}

export function SalesReport() {
  const [date, setDate] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [period, setPeriod] = useState<SalesPeriod | null>('today')
  const [profit, setProfit] = useState<ProfitReport | null>(null)
  const [profitError, setProfitError] = useState('')
  const [profitLoading, setProfitLoading] = useState(true)
  const [report, setReport] = useState<SalesReport | null>(null)
  const [today, setToday] = useState('')
  const profitVersion = useRef(0)
  const requestVersion = useRef(0)

  const loadReport = useCallback(async ({
    selectedDate,
    selectedPage,
    selectedPeriod,
    signal,
  }: {
    selectedDate: string | null
    selectedPage: number
    selectedPeriod: SalesPeriod | null
    signal?: AbortSignal
  }) => {
    const version = ++requestVersion.current
    setLoading(true)
    setError('')
    try {
      const filter = selectedDate
        ? `date=${encodeURIComponent(selectedDate)}`
        : `period=${selectedPeriod ?? 'today'}`
      const next = await requestJson<SalesReport>(
        `/api/admin/sales/daily?${filter}&page=${selectedPage}&pageSize=50`,
        { signal },
      )
      if (version === requestVersion.current) setReport(next)
    } catch (requestError) {
      if (
        version === requestVersion.current
        && (requestError as Error).name !== 'AbortError'
      ) {
        setError(requestError instanceof Error ? requestError.message : 'โหลดรายงานไม่สำเร็จ')
      }
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [])

  /**
   * The profit summary is its own request, keyed on the filter only. `page` is
   * deliberately not a dependency: paging the order history must not refetch
   * it, and a costing failure must not be able to blank the sales cards.
   */
  const loadProfit = useCallback(async ({
    selectedDate,
    selectedPeriod,
    signal,
  }: {
    selectedDate: string | null
    selectedPeriod: SalesPeriod | null
    signal?: AbortSignal
  }) => {
    const version = ++profitVersion.current
    setProfitLoading(true)
    setProfitError('')
    try {
      const filter = selectedDate
        ? `date=${encodeURIComponent(selectedDate)}`
        : `period=${selectedPeriod ?? 'today'}`
      const next = await requestJson<ProfitReport>(
        `/api/admin/reports/profit?${filter}`,
        { signal },
      )
      if (version === profitVersion.current) setProfit(next)
    } catch (requestError) {
      if (
        version === profitVersion.current
        && (requestError as Error).name !== 'AbortError'
      ) {
        setProfit(null)
        setProfitError(
          requestError instanceof Error ? requestError.message : 'โหลดสรุปกำไรไม่สำเร็จ',
        )
      }
    } finally {
      if (version === profitVersion.current) setProfitLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const currentDate = bangkokToday()
      setDate(currentDate)
      setToday(currentDate)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!today) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void loadReport({
        selectedDate: period ? null : date,
        selectedPage: page,
        selectedPeriod: period,
        signal: controller.signal,
      })
    }, 0)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [date, loadReport, page, period, today])

  useEffect(() => {
    if (!today) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void loadProfit({
        selectedDate: period ? null : date,
        selectedPeriod: period,
        signal: controller.signal,
      })
    }, 0)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [date, loadProfit, period, today])

  function changeDate(nextDate: string) {
    if (!nextDate) return
    setDate(nextDate)
    setPeriod(null)
    setPage(1)
  }

  function changePeriod(nextPeriod: SalesPeriod) {
    setPeriod(nextPeriod)
    setDate(today)
    setPage(1)
  }

  function changePage(nextPage: number) {
    setPage(nextPage)
  }

  const periodLabel = formatReportLabel(report)
  const emptyTitle = report?.date ? 'ยังไม่มียอดขายในวันที่เลือก' : 'ยังไม่มียอดขายในช่วงนี้'
  // Every figure is derived here rather than inside JSX, so no rounded value is
  // ever multiplied on screen.
  // One flag drives all three cards. Without it a failed request leaves
  // profit null and profitLoading false, and the uncosted card would read "0"
  // with "คิดต้นทุนได้ครบ" - a reassurance nobody checked.
  const profitUnknown = !profit
  const grossTone = (profit?.grossProfit ?? 0) < 0 ? 'month-profit-negative' : ''
  const cashTone = (profit?.cashProfit ?? 0) < 0 ? 'month-profit-negative' : ''
  const grossLabel = profitUnknown ? '—' : formatSignedMoney(profit.grossProfit)
  const cashLabel = profitUnknown ? '—' : formatSignedMoney(profit.cashProfit)
  const grossNote = profitUnknown
    ? 'ยังไม่ได้ข้อมูลกำไรของช่วงนี้'
    : `หักต้นทุนวัตถุดิบ ${formatMoney(profit.cogs)} · ${periodLabel}`
  const cashNote = profitUnknown
    ? 'ยังไม่ได้ข้อมูลค่าซื้อวัตถุดิบของช่วงนี้'
    : `เงินเข้า ลบ ค่าซื้อวัตถุดิบ ${formatMoney(profit.purchaseCost)} (ไม่ใช่กำไร)`
  const uncostedItems = profit?.uncostedItemCount ?? 0
  const uncostedLabel = profitUnknown ? '—' : formatCount(uncostedItems)
  const uncostedNote = profitUnknown
    ? 'ยังไม่ได้ข้อมูลต้นทุนของช่วงนี้'
    : uncostedItems > 0
      ? `มูลค่า ${formatMoney(profit.uncostedRevenue)} · กำไรขั้นต้นจริงต่ำกว่าที่แสดง`
      : 'ทุกไม้ที่ขายในช่วงนี้คิดต้นทุนได้ครบ'

  return (
    <main className="reports-page">
      <header className="reports-header">
        <div>
          <Link className="back-link" href="/"><ChevronLeft size={16} /> กลับแดชบอร์ด</Link>
          <p className="eyebrow">SALES REPORT</p>
          <h1>รายงานยอดขาย</h1>
          <p>สรุปยอดและตรวจสอบประวัติออเดอร์ตามช่วงเวลาที่เลือก</p>
        </div>
        <div className="report-filter-controls" aria-label="ตัวกรองรายงานยอดขาย">
          <div className="report-periods" role="group" aria-label="ช่วงเวลารายงาน">
            {salesPeriodOptions.map((item) => <Button aria-pressed={period === item.value} className={period === item.value ? 'active' : ''} key={item.value} onClick={() => changePeriod(item.value)} size="small" type="button" variant="ghost">{item.label}</Button>)}
          </div>
          <DatePicker max={today || undefined} onChange={changeDate} today={today || undefined} value={period ? '' : date} />
        </div>
      </header>

      {error ? <div className="catalog-alert" role="alert"><span>{error}</span><Button onClick={() => void loadReport({ selectedDate: period ? null : date, selectedPage: page, selectedPeriod: period })} size="small" variant="ghost">ลองใหม่</Button></div> : null}

      <section aria-label="สรุปยอดขาย" className="report-summary-grid">
        <Card className="report-summary-card featured"><span>ยอดขายรวม</span><strong>{formatMoney(report?.summary.totalSales ?? 0)}</strong><small>{periodLabel}</small></Card>
        <Card className="report-summary-card"><span>จำนวนออเดอร์</span><strong>{formatCount(report?.summary.orderCount ?? 0)}</strong><small>ออเดอร์ที่ขายสำเร็จ</small></Card>
        <Card className="report-summary-card"><span>จำนวนไม้</span><strong>{formatCount(report?.summary.itemCount ?? 0)}</strong><small>สินค้าที่ขายทั้งหมด</small></Card>
      </section>

      {profitError ? <div className="catalog-alert month-profit-alert" role="alert"><span>{profitError}</span><Button onClick={() => void loadProfit({ selectedDate: period ? null : date, selectedPeriod: period })} size="small" variant="ghost">ลองใหม่</Button></div> : null}

      <section aria-label="สรุปกำไรของช่วงที่เลือก" className="report-summary-grid month-profit-cards">
        <Card className="report-summary-card featured"><span>กำไรขั้นต้น</span><strong className={grossTone}>{grossLabel}</strong><small>{grossNote}</small></Card>
        <Card className="report-summary-card"><span>กระแสเงินสด</span><strong className={cashTone}>{cashLabel}</strong><small>{cashNote}</small></Card>
        <Card className={!profitUnknown && uncostedItems > 0 ? 'report-summary-card month-profit-warning' : 'report-summary-card'}><span>ไม้ที่ยังไม่ได้ตั้งสูตร</span><strong>{uncostedLabel}</strong><small>{uncostedNote}</small></Card>
      </section>

      <section className="report-history">
        <div className="report-history-heading"><div><p className="eyebrow">ORDER HISTORY</p><h2>ประวัติการขาย</h2></div><span>{report?.pagination.totalItems ?? 0} ออเดอร์</span></div>
        {loading ? <div className="report-state"><div className="auth-loader" /><p>กำลังโหลดรายงาน...</p></div> : report?.orders.length ? (
          <div className="report-orders">
            {report.orders.map((order) => (
              <details className="report-order" key={order.id}>
                <summary>
                  <span className="report-order-icon"><ReceiptText size={18} /></span>
                  <span><strong>ออเดอร์ #{order.orderNumber}</strong><small>{thaiTime.format(new Date(order.soldAt))} น. · {order.itemCount} ไม้</small></span>
                  <strong>{formatMoney(order.total)}</strong>
                  <span className="report-expand">ดูรายการ</span>
                </summary>
                <div className="report-order-items">
                  {order.items.map((item) => <div key={item.id}><span><strong>{item.productName}</strong><small>{item.quantity} ไม้ × {formatMoney(item.unitPrice)}</small></span><strong>{formatMoney(item.quantity * item.unitPrice)}</strong></div>)}
                </div>
              </details>
            ))}
          </div>
        ) : <div className="report-state"><ReceiptText size={34} /><h3>{emptyTitle}</h3><p>ออเดอร์ที่ยืนยันการขายจาก POS จะแสดงที่นี่</p><Link className="ui-button ui-button-primary ui-button-small" href="/pos">ไปหน้ารับออเดอร์</Link></div>}

        {report && report.pagination.totalPages > 1 ? <nav aria-label="หน้ารายงาน" className="report-pagination"><Button disabled={page <= 1 || loading} onClick={() => changePage(page - 1)} size="small" variant="secondary"><ChevronLeft size={14} /> ก่อนหน้า</Button><span>หน้า {page.toLocaleString('th-TH')} / {report.pagination.totalPages.toLocaleString('th-TH')}</span><Button disabled={page >= report.pagination.totalPages || loading} onClick={() => changePage(page + 1)} size="small" variant="secondary">ถัดไป <ChevronRight size={14} /></Button></nav> : null}
      </section>

      <MonthlyProfit />
    </main>
  )
}
