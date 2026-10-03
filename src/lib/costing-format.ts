import type { IngredientUnit } from '@/server/costing/types'

export const ingredientUnitLabel: Record<IngredientUnit, string> = {
  g: 'กรัม',
  kg: 'กิโลกรัม',
  l: 'ลิตร',
  ml: 'มิลลิลิตร',
  pack: 'แพ็ค',
  piece: 'ชิ้น',
}

export const ingredientUnitShortLabel: Record<IngredientUnit, string> = {
  g: 'ก.',
  kg: 'กก.',
  l: 'ล.',
  ml: 'มล.',
  pack: 'แพ็ค',
  piece: 'ชิ้น',
}

export const ingredientUnitOptions: Array<{ label: string; value: IngredientUnit }> = [
  { label: 'กิโลกรัม (กก.)', value: 'kg' },
  { label: 'กรัม (ก.)', value: 'g' },
  { label: 'ลิตร (ล.)', value: 'l' },
  { label: 'มิลลิลิตร (มล.)', value: 'ml' },
  { label: 'แพ็ค', value: 'pack' },
  { label: 'ชิ้น', value: 'piece' },
]

const money = new Intl.NumberFormat('th-TH', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

const preciseMoney = new Intl.NumberFormat('th-TH', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
})

const quantity = new Intl.NumberFormat('th-TH', {
  maximumFractionDigits: 4,
  minimumFractionDigits: 0,
})

const percent = new Intl.NumberFormat('th-TH', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})

const monthLabelFormat = new Intl.DateTimeFormat('th-TH', {
  month: 'long',
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
})

const shortMonthLabelFormat = new Intl.DateTimeFormat('th-TH', {
  month: 'short',
  timeZone: 'Asia/Bangkok',
  year: '2-digit',
})

const dateLabelFormat = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Bangkok',
})

function isRenderableNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * A value the server could not compute renders as an em dash rather than as a
 * number, so an unknown cost is never mistaken for a free one.
 */
export function formatMoney(value: number | null | undefined) {
  return isRenderableNumber(value) ? `฿${money.format(value)}` : '—'
}

/**
 * Keeps the minus sign in front of the baht symbol. "฿-240" reads as a typo in
 * Thai, so a loss is written "-฿240".
 */
export function formatSignedMoney(value: number | null | undefined) {
  if (!isRenderableNumber(value)) return '—'
  return value < 0 ? `-฿${money.format(Math.abs(value))}` : `฿${money.format(value)}`
}

/** Per-skewer figures keep both decimals so ฿6.67 is not shown as ฿6.7. */
export function formatUnitMoney(value: number | null | undefined) {
  if (!isRenderableNumber(value)) return '—'
  return value < 0
    ? `-฿${preciseMoney.format(Math.abs(value))}`
    : `฿${preciseMoney.format(value)}`
}

export function formatQuantity(value: number | null | undefined) {
  return isRenderableNumber(value) ? quantity.format(value) : '—'
}

export function formatCount(value: number | null | undefined) {
  return isRenderableNumber(value) ? value.toLocaleString('th-TH') : '—'
}

/** Takes a ratio (0.42), renders a percentage (42%). */
export function formatPercent(value: number | null | undefined) {
  return isRenderableNumber(value) ? `${percent.format(value * 100)}%` : '—'
}

export function formatIngredientQuantity(
  value: number | null | undefined,
  unit: IngredientUnit,
) {
  if (!isRenderableNumber(value)) return '—'
  return `${quantity.format(value)} ${ingredientUnitShortLabel[unit]}`
}

const subSatangMoney = new Intl.NumberFormat('th-TH', {
  maximumFractionDigits: 5,
  minimumFractionDigits: 4,
})

/**
 * Prices a lot per its own unit, e.g. "฿180.00 / กก.".
 *
 * A rate can legitimately sit below one satang - seasoning at ฿80 per 20,000 g
 * is ฿0.004/g - and two decimals would print that known cost as "฿0.00", which
 * reads as free. Those rates keep more digits instead.
 */
export function formatUnitRate(value: number | null | undefined, unit: IngredientUnit) {
  if (!isRenderableNumber(value)) return '—'

  const suffix = ` / ${ingredientUnitShortLabel[unit]}`
  if (value !== 0 && Math.abs(value) < 0.01) {
    const digits = subSatangMoney.format(Math.abs(value))
    return `${value < 0 ? '-' : ''}฿${digits}${suffix}`
  }
  return `${formatUnitMoney(value)}${suffix}`
}

/** Midday avoids any chance of a timezone shift moving the label to another day. */
export function formatBangkokDate(date: string) {
  return dateLabelFormat.format(new Date(`${date}T12:00:00+07:00`))
}

/** Takes a "YYYY-MM" key and renders "กันยายน 2569". */
export function formatMonthLabel(month: string) {
  return monthLabelFormat.format(new Date(`${month}-01T12:00:00+07:00`))
}

export function formatShortMonthLabel(month: string) {
  return shortMonthLabelFormat.format(new Date(`${month}-01T12:00:00+07:00`))
}

/** The Bangkok calendar date right now, as "YYYY-MM-DD". */
export function bangkokToday() {
  const parts = new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

/** The Bangkok calendar month right now, as "YYYY-MM". */
export function bangkokThisMonth() {
  return bangkokToday().slice(0, 7)
}
