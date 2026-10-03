'use client'

import { TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { requestJson } from '@/lib/api-client'
import {
  formatCount,
  formatMonthLabel,
  formatMoney,
  formatSignedMoney,
} from '@/lib/costing-format'
import type { MonthlyProfit as MonthlyProfitRow, MonthlyProfitReport } from '@/server/costing/types'

const rangeOptions = [
  { label: '6 เดือน', value: 6 },
  { label: '12 เดือน', value: 12 },
] as const

type MonthRange = (typeof rangeOptions)[number]['value']

type ProfitTone = 'flat' | 'negative' | 'positive'

type MonthRow = {
  barTone: ProfitTone
  /** Already clamped to 0-100%, so a loss never renders a negative width. */
  barWidth: string
  cashProfit: string
  cashTone: ProfitTone
  grossProfit: string
  grossTone: ProfitTone
  month: string
  monthLabel: string
  purchaseCost: string
  revenue: string
  uncosted: string | null
}

const toneClass: Record<ProfitTone, string> = {
  flat: 'month-profit-flat',
  negative: 'month-profit-negative',
  positive: 'month-profit-positive',
}

function toneOf(value: number): ProfitTone {
  if (value < 0) return 'negative'
  return value > 0 ? 'positive' : 'flat'
}

/**
 * Every number the panel shows is derived here, once, so the markup only ever
 * prints strings. The bar compares the size of a month's gross profit against
 * the biggest month in the window; a loss is drawn at its magnitude and told
 * apart by colour, never by a negative width.
 */
function buildRows(months: MonthlyProfitRow[]): MonthRow[] {
  const ordered = [...months].sort((left, right) => right.month.localeCompare(left.month))
  const scale = ordered.reduce((widest, item) => Math.max(widest, Math.abs(item.grossProfit)), 0)

  return ordered.map((item) => {
    const ratio = scale > 0 ? Math.abs(item.grossProfit) / scale : 0
    const width = Math.min(100, Math.max(0, ratio * 100))

    return {
      barTone: toneOf(item.grossProfit),
      barWidth: `${width}%`,
      cashProfit: formatSignedMoney(item.cashProfit),
      cashTone: toneOf(item.cashProfit),
      grossProfit: formatSignedMoney(item.grossProfit),
      grossTone: toneOf(item.grossProfit),
      month: item.month,
      monthLabel: formatMonthLabel(item.month),
      purchaseCost: formatMoney(item.purchaseCost),
      revenue: formatMoney(item.revenue),
      uncosted: item.uncostedItemCount > 0
        ? `ยังไม่ได้ตั้งสูตร ${formatCount(item.uncostedItemCount)} ไม้ (${formatMoney(item.uncostedRevenue)})`
        : null,
    }
  })
}

function hasActivity(months: MonthlyProfitRow[]) {
  return months.some((item) => item.revenue !== 0
    || item.purchaseCost !== 0
    || item.itemCount !== 0)
}

export function MonthlyProfit() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [months, setMonths] = useState<MonthRange>(6)
  const [reloadToken, setReloadToken] = useState(0)
  const [report, setReport] = useState<MonthlyProfitReport | null>(null)
  const requestVersion = useRef(0)

  const load = useCallback(async (selectedMonths: MonthRange, signal: AbortSignal) => {
    const version = ++requestVersion.current
    setLoading(true)
    setError('')
    try {
      const next = await requestJson<MonthlyProfitReport>(
        `/api/admin/reports/profit/monthly?months=${selectedMonths}`,
        { signal },
      )
      if (version === requestVersion.current) setReport(next)
    } catch (requestError) {
      if (
        version === requestVersion.current
        && (requestError as Error).name !== 'AbortError'
      ) {
        setError(requestError instanceof Error ? requestError.message : 'โหลดสรุปกำไรรายเดือนไม่สำเร็จ')
      }
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => void load(months, controller.signal), 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [load, months, reloadToken])

  const rows = useMemo(() => buildRows(report?.months ?? []), [report])
  const showEmpty = !report?.months.length || !hasActivity(report.months)

  return (
    <section aria-labelledby="month-profit-title" className="month-profit-panel">
      <header className="top-products-header">
        <div>
          <p className="eyebrow">MONTHLY PROFIT</p>
          <h2 id="month-profit-title">สรุปกำไรรายเดือน</h2>
          <p>กำไรขั้นต้นของแต่ละเดือน เทียบกับยอดขายและเงินที่จ่ายซื้อวัตถุดิบ</p>
        </div>
        <div aria-label="ช่วงเดือนที่สรุป" className="top-products-periods" role="group">
          {rangeOptions.map((option) => (
            <Button
              aria-pressed={months === option.value}
              className={months === option.value ? 'active' : ''}
              key={option.value}
              onClick={() => setMonths(option.value)}
              size="small"
              type="button"
              variant="ghost"
            >
              {option.label}
            </Button>
          ))}
        </div>
      </header>

      <p className="month-profit-note" id="month-profit-cash-note">
        <strong>กำไรขั้นต้น</strong> คือยอดขายลบต้นทุนวัตถุดิบของไม้ที่ขายไปจริง ส่วน
        <strong> กระแสเงินสด</strong> คือเงินเข้า ลบ เงินที่จ่ายซื้อวัตถุดิบเดือนนั้น (ไม่ใช่กำไร)
        เดือนที่ตุนของเข้าร้านเยอะจะเห็นกระแสเงินสดติดลบทั้งที่กำไรยังดี ถือว่าปกติ
        ตัวเลขสองช่องนี้คนละเรื่องกัน ห้ามนำมาบวกกัน
      </p>

      {loading ? (
        <div aria-label="กำลังโหลดสรุปกำไรรายเดือน" className="month-profit-loading">
          {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
        </div>
      ) : error ? (
        <div className="top-products-state month-profit-state" role="alert">
          <h3>โหลดสรุปกำไรรายเดือนไม่สำเร็จ</h3>
          <p>{error}</p>
          <Button onClick={() => setReloadToken((value) => value + 1)} size="small" variant="secondary">
            ลองใหม่
          </Button>
        </div>
      ) : showEmpty ? (
        <div className="top-products-state month-profit-state">
          <h3>ยังไม่มีข้อมูลกำไรในช่วงนี้</h3>
          <p>บันทึกการซื้อวัตถุดิบและตั้งสูตรของแต่ละเมนู แล้วกำไรรายเดือนจะสรุปให้อัตโนมัติ</p>
          <Link className="ui-button ui-button-primary ui-button-small" href="/costs">
            ไปหน้าต้นทุนและสูตร
          </Link>
        </div>
      ) : (
        <ul className="month-profit-list">
          {rows.map((row) => (
            <li className="month-profit-row" key={row.month}>
              <div className="month-profit-when">
                <strong>{row.monthLabel}</strong>
                <small>ยอดขาย {row.revenue}</small>
              </div>

              <div className="month-profit-gross">
                <span>กำไรขั้นต้น</span>
                <strong className={toneClass[row.grossTone]}>{row.grossProfit}</strong>
                <span aria-hidden="true" className={`month-profit-bar ${toneClass[row.barTone]}`}>
                  <span style={{ width: row.barWidth }} />
                </span>
              </div>

              <div aria-describedby="month-profit-cash-note" className="month-profit-cash">
                <span>กระแสเงินสด</span>
                <strong className={toneClass[row.cashTone]}>{row.cashProfit}</strong>
                <small>ซื้อวัตถุดิบเดือนนี้ {row.purchaseCost}</small>
              </div>

              {row.uncosted ? (
                <p className="month-profit-flag">
                  <TriangleAlert aria-hidden="true" size={15} />
                  <span>
                    <strong>{row.uncosted}</strong>
                    <small>กำไรขั้นต้นจริงต่ำกว่าที่แสดง เพราะไม้เหล่านี้ยังคิดต้นทุนไม่ได้</small>
                  </span>
                  <Link href="/costs">ตั้งสูตร →</Link>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <footer className="top-products-footer">
        <span>คิดจากต้นทุนเฉลี่ยล่าสุดของวัตถุดิบ ยอดขายมาจากออเดอร์ที่ชำระแล้ว</span>
        <Link href="/costs">จัดการต้นทุนและสูตร →</Link>
      </footer>
    </section>
  )
}
