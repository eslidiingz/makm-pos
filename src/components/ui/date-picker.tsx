'use client'

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const weekdays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

const monthTitle = new Intl.DateTimeFormat('th-TH', {
  month: 'long',
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
})

const triggerLabel = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
})

function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return { day, month: month - 1, year }
}

export type DatePickerProps = {
  className?: string
  label?: string
  max?: string
  onChange: (value: string) => void
  placeholder?: string
  today?: string
  value: string
}

export function DatePicker({
  className,
  label = 'เลือกวันเอง',
  max,
  onChange,
  placeholder = 'เลือกวันเอง',
  today,
  value,
}: DatePickerProps) {
  const selected = useMemo(() => (value ? parseIsoDate(value) : null), [value])
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => {
    const base = selected ?? (max ? parseIsoDate(max) : null)
    const now = new Date()
    return base
      ? { month: base.month, year: base.year }
      : { month: now.getMonth(), year: now.getFullYear() }
  })

  const days = useMemo(() => {
    const firstWeekday = new Date(view.year, view.month, 1).getDay()
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
    return [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
    ]
  }, [view])

  function shiftMonth(step: number) {
    setView((current) => {
      const next = new Date(current.year, current.month + step, 1)
      return { month: next.getMonth(), year: next.getFullYear() }
    })
  }

  function selectDay(day: number) {
    onChange(toIsoDate(view.year, view.month, day))
    setOpen(false)
  }

  const viewDate = new Date(view.year, view.month, 1)

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          className={cn('ui-date-picker-trigger', !value && 'is-empty', className)}
          type="button"
        >
          <CalendarDays aria-hidden="true" size={16} />
          <span>{value ? triggerLabel.format(new Date(`${value}T12:00:00+07:00`)) : placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={label} className="ui-calendar">
        <div className="ui-calendar-header">
          <Button aria-label="เดือนก่อนหน้า" onClick={() => shiftMonth(-1)} size="icon" type="button" variant="ghost">
            <ChevronLeft size={16} />
          </Button>
          <strong>{monthTitle.format(viewDate)}</strong>
          <Button aria-label="เดือนถัดไป" onClick={() => shiftMonth(1)} size="icon" type="button" variant="ghost">
            <ChevronRight size={16} />
          </Button>
        </div>
        <div className="ui-calendar-weekdays">
          {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="ui-calendar-grid">
          {days.map((day, index) => {
            if (!day) return <span key={`empty-${index}`} />
            const iso = toIsoDate(view.year, view.month, day)
            return (
              <button
                aria-current={iso === today ? 'date' : undefined}
                aria-pressed={iso === value}
                className={cn('ui-calendar-day', iso === today && 'is-today', iso === value && 'is-selected')}
                disabled={max ? iso > max : false}
                key={iso}
                onClick={() => selectDay(day)}
                type="button"
              >
                {day}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
