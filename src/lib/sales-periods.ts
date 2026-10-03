import type { SalesPeriod } from '@/server/orders/types'

export const salesPeriodOptions: Array<{ label: string; value: SalesPeriod }> = [
  { label: 'วันนี้', value: 'today' },
  { label: 'สัปดาห์นี้', value: 'this_week' },
  { label: 'เดือนนี้', value: 'this_month' },
]

export const salesPeriodLabel: Record<SalesPeriod, string> = {
  this_month: 'เดือนนี้',
  this_week: 'สัปดาห์นี้',
  today: 'วันนี้',
}
