import type { OrderItemInput, SalesPeriod } from '@/server/orders/types'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidReportDate(value: string) {
  const match = ISO_DATE.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export function bangkokDayRange(date: string) {
  const start = new Date(`${date}T00:00:00+07:00`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { end: end.toISOString(), start: start.toISOString() }
}

export function isSalesPeriod(value: string): value is SalesPeriod {
  return value === 'today' || value === 'this_week' || value === 'this_month'
}

function bangkokToday(now: number) {
  const parts = new Intl.DateTimeFormat('en', {
    day: '2-digit', month: '2-digit', timeZone: 'Asia/Bangkok', year: 'numeric',
  }).formatToParts(new Date(now))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)))
}

export function bangkokSalesPeriodRange(period: SalesPeriod, now: number) {
  const today = bangkokToday(now)
  const dayOfWeek = today.getUTCDay()
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const startDate = period === 'today'
    ? today
    : period === 'this_week'
      ? new Date(today.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000)
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const start = bangkokDayRange(startDate.toISOString().slice(0, 10)).start
  const end = bangkokDayRange(today.toISOString().slice(0, 10)).end
  return { end, start }
}

const ISO_MONTH = /^(\d{4})-(\d{2})$/

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

/**
 * A Bangkok month boundary is the Bangkok day boundary of its first day, so
 * every month range is built from bangkokDayRange. The daily and the monthly
 * report can then never disagree about where a day belongs.
 */
function bangkokMonthStart(year: number, monthIndex: number) {
  return bangkokDayRange(isoDate(new Date(Date.UTC(year, monthIndex, 1)))).start
}

export function isValidReportMonth(value: string) {
  const match = ISO_MONTH.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  return year >= 1970 && year <= 9999 && month >= 1 && month <= 12
}

export function bangkokMonthRange(month: string) {
  const match = ISO_MONTH.exec(month)
  if (!match) throw new Error(`Invalid report month: ${month}`)

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  return {
    // Date.UTC rolls month 12 into January of the next year, so December never
    // produces '2026-13' and an Invalid Date.
    end: bangkokMonthStart(year, monthIndex + 1),
    start: bangkokMonthStart(year, monthIndex),
  }
}

export function bangkokTrailingMonthsRange(months: number, now: number) {
  const span = Math.max(1, Math.trunc(months))
  const today = bangkokToday(now)
  const year = today.getUTCFullYear()
  const monthIndex = today.getUTCMonth()
  return {
    end: bangkokMonthStart(year, monthIndex + 1),
    start: bangkokMonthStart(year, monthIndex - (span - 1)),
  }
}

export function bangkokMonthKey(now: number) {
  return bangkokToday(now).toISOString().slice(0, 7)
}

export function isValidOrderItems(items: OrderItemInput[]) {
  if (!items.length || items.length > 100) return false
  const ids = new Set<string>()

  for (const item of items) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.productId)
      || !Number.isInteger(item.quantity)
      || item.quantity < 1
      || item.quantity > 100
      || !Number.isFinite(item.expectedUnitPrice)
      || item.expectedUnitPrice < 0
      || ids.has(item.productId)
    ) return false
    ids.add(item.productId)
  }

  return true
}
