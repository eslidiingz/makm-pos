'use client'

import { ChevronLeft, ChevronRight, Pencil, Plus, ShoppingBasket, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { requestJson } from '@/lib/api-client'
import {
  bangkokThisMonth,
  bangkokToday,
  formatBangkokDate,
  formatCount,
  formatIngredientQuantity,
  formatMoney,
  formatMonthLabel,
  formatUnitRate,
  ingredientUnitShortLabel,
} from '@/lib/costing-format'
import { useFormValidation } from '@/lib/form-validation'
import type {
  Ingredient,
  IngredientPurchase,
  IngredientPurchaseReport,
} from '@/server/costing/types'

type PurchaseDialogState = IngredientPurchase | 'new' | null

const ALL_INGREDIENTS = 'all'
const MONTH_CHOICES = 12
const PURCHASES_PER_PAGE = 20

const PURCHASE_SCHEMA = {
  ingredientId: (value: string) => value ? null : 'กรุณาเลือกวัตถุดิบ',
  note: (value: string) => value.trim().length <= 160 ? null : 'บันทึกช่วยจำต้องไม่เกิน 160 ตัวอักษร',
  purchasedOn: (value: string) => value ? null : 'กรุณาเลือกวันที่ซื้อ',
  quantity: (value: string) => {
    if (!value.trim()) return 'กรุณากรอกปริมาณที่ซื้อ'
    const quantity = Number(value)
    if (!Number.isFinite(quantity) || quantity <= 0) return 'ปริมาณต้องเป็นตัวเลขมากกว่า 0'
    return quantity <= 99999999.9999 ? null : 'ปริมาณสูงเกินกำหนด'
  },
  totalCost: (value: string) => {
    if (!value.trim()) return 'กรุณากรอกราคาที่จ่ายทั้งหมด'
    const cost = Number(value)
    if (!Number.isFinite(cost) || cost < 0) return 'ราคาต้องเป็นตัวเลขไม่ติดลบ'
    return cost <= 9999999999 ? null : 'ราคาสูงเกินกำหนด'
  },
}

/** The last twelve Bangkok months, newest first, as "YYYY-MM" keys. */
function recentMonths(current: string) {
  const [year, month] = current.split('-').map(Number)
  return Array.from({ length: MONTH_CHOICES }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

function PurchaseForm({
  ingredients,
  onOpenChange,
  onSaved,
  purchase,
  today,
}: {
  ingredients: Ingredient[]
  onOpenChange: (open: boolean) => void
  onSaved: (message: string) => Promise<void>
  purchase: PurchaseDialogState
  today: string
}) {
  const editing = purchase !== 'new' && purchase !== null ? purchase : null
  const [error, setError] = useState('')
  const [ingredientId, setIngredientId] = useState(editing?.ingredientId ?? '')
  const [pending, setPending] = useState(false)
  const [purchasedOn, setPurchasedOn] = useState(editing?.purchasedOn ?? today)
  const [quantity, setQuantity] = useState(editing ? String(editing.quantity) : '')
  const [totalCost, setTotalCost] = useState(editing ? String(editing.totalCost) : '')
  const { clearField, fieldErrors, fieldProps, validate } = useFormValidation(PURCHASE_SCHEMA)

  // Archiving hides an ingredient from new lots, but a lot already attached to
  // one must stay editable, so the current selection is always offered.
  const options = ingredients.filter((item) => !item.archivedAt || item.id === ingredientId)
  const selected = ingredients.find((item) => item.id === ingredientId) ?? null
  const quantityValue = Number(quantity)
  const costValue = Number(totalCost)
  const previewUnitCost = quantity.trim() && totalCost.trim()
    && Number.isFinite(quantityValue) && quantityValue > 0
    && Number.isFinite(costValue) && costValue >= 0
    ? costValue / quantityValue
    : null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const note = String(form.get('note') ?? '')
    if (!validate({ ingredientId, note, purchasedOn, quantity, totalCost })) return

    setPending(true)
    try {
      const saved = await requestJson<IngredientPurchase>(
        editing ? `/api/admin/costs/purchases/${editing.id}` : '/api/admin/costs/purchases',
        {
          body: JSON.stringify({
            ingredientId,
            note: note.trim() ? note.trim() : null,
            purchasedOn,
            quantity: Number(quantity),
            totalCost: Number(totalCost),
          }),
          method: editing ? 'PATCH' : 'POST',
        },
      )
      await onSaved(
        editing
          ? `บันทึกการซื้อ “${saved.ingredientName}” แล้ว`
          : `เพิ่มการซื้อ “${saved.ingredientName}” แล้ว`,
      )
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'บันทึกการซื้อไม่สำเร็จ')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(purchase)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'แก้ไขการซื้อ' : 'บันทึกการซื้อ'}</DialogTitle>
          <DialogDescription>กรอกปริมาณและเงินที่จ่ายจริง ระบบจะคิดต้นทุนเฉลี่ยต่อหน่วยให้เอง</DialogDescription>
        </DialogHeader>
        <form className="catalog-form" noValidate onSubmit={submit}>
          <div className="catalog-field">
            <Label htmlFor="purchase-ingredient" required>วัตถุดิบ</Label>
            <Select
              onValueChange={(value) => { setIngredientId(value); clearField('ingredientId') }}
              value={ingredientId}
            >
              <SelectTrigger
                aria-describedby={fieldErrors.ingredientId ? 'ingredientId-error' : undefined}
                aria-invalid={fieldErrors.ingredientId ? true : undefined}
                id="purchase-ingredient"
                required
              ><SelectValue placeholder="เลือกวัตถุดิบ" /></SelectTrigger>
              <SelectContent>
                {options.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} ({ingredientUnitShortLabel[item.unit]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id="ingredientId-error" message={fieldErrors.ingredientId} />
          </div>

          <div className="cost-field-pair">
            <div className="catalog-field">
              {/* DatePicker exposes no id, so the label stays visual and the
                  trigger carries its own accessible name. */}
              <Label required>วันที่ซื้อ</Label>
              <DatePicker
                className="cost-date-trigger"
                label="เลือกวันที่ซื้อ"
                max={today || undefined}
                onChange={(value) => { setPurchasedOn(value); clearField('purchasedOn') }}
                placeholder="เลือกวันที่ซื้อ"
                today={today || undefined}
                value={purchasedOn}
              />
              <FieldError id="purchasedOn-error" message={fieldErrors.purchasedOn} />
            </div>
            <div className="catalog-field">
              <Label htmlFor="purchase-quantity" required>
                ปริมาณ{selected ? ` (${ingredientUnitShortLabel[selected.unit]})` : ''}
              </Label>
              <Input
                id="purchase-quantity"
                inputMode="decimal"
                min="0"
                placeholder="0"
                required
                step="0.0001"
                type="number"
                value={quantity}
                {...fieldProps('quantity')}
                onChange={(event) => { setQuantity(event.target.value); clearField('quantity') }}
              />
              <FieldError id="quantity-error" message={fieldErrors.quantity} />
            </div>
          </div>

          <div className="catalog-field">
            <Label htmlFor="purchase-cost" required>ราคาที่จ่ายทั้งหมด</Label>
            <div className="price-input">
              <span>฿</span>
              <Input
                id="purchase-cost"
                inputMode="decimal"
                min="0"
                placeholder="0.00"
                required
                step="0.01"
                type="number"
                value={totalCost}
                {...fieldProps('totalCost')}
                onChange={(event) => { setTotalCost(event.target.value); clearField('totalCost') }}
              />
            </div>
            <FieldError id="totalCost-error" message={fieldErrors.totalCost} />
          </div>

          <p className="cost-preview">
            <span>ต้นทุนต่อหน่วยของล็อตนี้ (ประมาณ)</span>
            <strong>{selected ? formatUnitRate(previewUnitCost, selected.unit) : '—'}</strong>
          </p>

          <div className="catalog-field">
            <Label htmlFor="purchase-note">บันทึกช่วยจำ</Label>
            <Input
              defaultValue={editing?.note ?? ''}
              id="purchase-note"
              maxLength={160}
              name="note"
              placeholder="เช่น ตลาดเช้า เจ๊หมวย"
              {...fieldProps('note')}
            />
            <FieldError id="note-error" message={fieldErrors.note} />
          </div>

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">ยกเลิก</Button>
            <Button disabled={pending} type="submit">{pending ? 'กำลังบันทึก...' : 'บันทึกการซื้อ'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CostPurchases({
  ingredients,
  onError,
  onSuccess,
  reload,
}: {
  ingredients: Ingredient[]
  onError: (message: string) => void
  onSuccess: (message: string) => void
  reload: () => Promise<void>
}) {
  const [confirmAction, setConfirmAction] = useState<null | {
    description: string
    run: () => Promise<void>
    title: string
  }>(null)
  const [dialog, setDialog] = useState<PurchaseDialogState>(null)
  const [filterIngredient, setFilterIngredient] = useState(ALL_INGREDIENTS)
  const [loadFailed, setLoadFailed] = useState('')
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState('')
  const [page, setPage] = useState(1)
  const [confirmError, setConfirmError] = useState('')
  const [pendingConfirm, setPendingConfirm] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [report, setReport] = useState<IngredientPurchaseReport | null>(null)
  const [today, setToday] = useState('')
  const requestVersion = useRef(0)

  const load = useCallback(async (
    selectedMonth: string,
    selectedIngredient: string,
    selectedPage: number,
    signal?: AbortSignal,
  ) => {
    const version = ++requestVersion.current
    setLoading(true)
    setLoadFailed('')
    try {
      const ingredientFilter = selectedIngredient === ALL_INGREDIENTS
        ? ''
        : `&ingredientId=${encodeURIComponent(selectedIngredient)}`
      const next = await requestJson<IngredientPurchaseReport>(
        `/api/admin/costs/purchases?month=${encodeURIComponent(selectedMonth)}${ingredientFilter}&page=${selectedPage}&pageSize=${PURCHASES_PER_PAGE}`,
        { signal },
      )
      if (version === requestVersion.current) {
        setReport(next)
        // Deleting the only lot on the last page leaves the request pointing
        // past the end, and the window totals ride on the returned rows - an
        // empty page would report 0 lots and ฿0 for a month that still has
        // both, with the pagination hidden. Step back instead.
        if (!next.items.length && selectedPage > next.pagination.totalPages) {
          setPage(next.pagination.totalPages)
        }
      }
    } catch (requestError) {
      if (
        version === requestVersion.current
        && (requestError as Error).name !== 'AbortError'
      ) {
        setLoadFailed(requestError instanceof Error ? requestError.message : 'โหลดรายการซื้อไม่สำเร็จ')
      }
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMonth(bangkokThisMonth())
      setToday(bangkokToday())
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!month) return
    const controller = new AbortController()
    const timer = window.setTimeout(
      () => void load(month, filterIngredient, page, controller.signal),
      0,
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [filterIngredient, load, month, page, reloadToken])

  // Anchored on the mount-time month, not on the selection. Anchoring on the
  // selection walks the window backwards every time the owner picks an older
  // month, so the owner could never step forward again. Empty until the mount
  // effect resolves the Bangkok date, which is also when `month` is set.
  const monthOptions = today ? recentMonths(today.slice(0, 7)) : []
  const totalPages = report?.pagination.totalPages ?? 1

  async function refreshAll() {
    setReloadToken((value) => value + 1)
    await reload()
  }

  async function runConfirm() {
    if (!confirmAction) return
    setPendingConfirm(true)
    setConfirmError('')
    try {
      await confirmAction.run()
      setConfirmAction(null)
    } catch (confirmError) {
      // The dialog stays open on failure, so the message has to live inside it;
      // a banner on the page behind would not be readable.
      setConfirmError(confirmError instanceof Error ? confirmError.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setPendingConfirm(false)
    }
  }

  return (
    <section aria-labelledby="cost-purchases-title" className="cost-panel">
      <div className="cost-panel-heading">
        <div>
          <p className="eyebrow">PURCHASES</p>
          <h2 id="cost-purchases-title">การซื้อวัตถุดิบ</h2>
          <p>ทุกล็อตที่บันทึกจะถูกนำไปเฉลี่ยเป็นต้นทุนต่อหน่วยทันที</p>
        </div>
        <Button disabled={!ingredients.length} onClick={() => setDialog('new')} size="small" type="button">
          <Plus size={15} /> บันทึกการซื้อ
        </Button>
      </div>

      <div className="cost-filters">
        <div className="cost-filter">
          <Label htmlFor="purchase-month-filter">เดือน</Label>
          <Select onValueChange={(value) => { setMonth(value); setPage(1) }} value={month}>
            <SelectTrigger id="purchase-month-filter"><SelectValue placeholder="เลือกเดือน" /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((key) => (
                <SelectItem key={key} value={key}>{formatMonthLabel(key)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="cost-filter">
          <Label htmlFor="purchase-ingredient-filter">วัตถุดิบ</Label>
          <Select onValueChange={(value) => { setFilterIngredient(value); setPage(1) }} value={filterIngredient}>
            <SelectTrigger id="purchase-ingredient-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_INGREDIENTS}>ทุกวัตถุดิบ</SelectItem>
              {ingredients.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="cost-summary-grid">
        <Card className="cost-summary-card"><span>จำนวนล็อต</span><strong>{formatCount(report?.summary.lotCount ?? 0)}</strong><small>ตามตัวกรองที่เลือก</small></Card>
        <Card className="cost-summary-card"><span>ยอดซื้อรวม</span><strong className="is-money">{formatMoney(report?.summary.totalCost ?? 0)}</strong><small>เงินสดที่จ่ายออกในช่วงนี้</small></Card>
      </div>

      {loading ? (
        <div aria-label="กำลังโหลดรายการซื้อ" className="cost-skeleton">
          {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
        </div>
      ) : loadFailed ? (
        <div className="cost-state">
          <h3>โหลดรายการซื้อไม่สำเร็จ</h3>
          <p>{loadFailed}</p>
          <Button onClick={() => setReloadToken((value) => value + 1)} size="small" type="button" variant="secondary">ลองใหม่</Button>
        </div>
      ) : report?.items.length ? (
        <div className="cost-purchase-list">
          {report.items.map((item) => (
            <div className="cost-purchase-row" key={item.id}>
              <span className="cost-purchase-date">{formatBangkokDate(item.purchasedOn)}</span>
              <div className="cost-purchase-main">
                <strong>{item.ingredientName}</strong>
                <small>{formatIngredientQuantity(item.quantity, item.unit)} · {formatUnitRate(item.unitCost, item.unit)}</small>
                {item.note ? <small className="cost-purchase-note">{item.note}</small> : null}
              </div>
              <strong className="cost-purchase-cost">{formatMoney(item.totalCost)}</strong>
              <div className="cost-purchase-actions">
                <Button aria-label={`แก้ไขการซื้อ ${item.ingredientName}`} onClick={() => setDialog(item)} size="icon" type="button" variant="ghost"><Pencil size={14} /></Button>
                <Button
                  aria-label={`ลบการซื้อ ${item.ingredientName}`}
                  onClick={() => setConfirmAction({
                    description: `ล็อต “${item.ingredientName}” วันที่ ${formatBangkokDate(item.purchasedOn)} จำนวน ${formatIngredientQuantity(item.quantity, item.unit)} (${formatMoney(item.totalCost)}) จะถูกลบถาวร และต้นทุนเฉลี่ยจะถูกคำนวณใหม่ทันที`,
                    run: async () => {
                      await requestJson(`/api/admin/costs/purchases/${item.id}`, { method: 'DELETE' })
                      await refreshAll()
                      onSuccess(`ลบการซื้อ “${item.ingredientName}” แล้ว`)
                    },
                    title: 'ลบการซื้อนี้ใช่หรือไม่?',
                  })}
                  size="icon"
                  type="button"
                  variant="ghost"
                ><Trash2 size={14} /></Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="cost-state">
          <ShoppingBasket aria-hidden="true" size={32} />
          <h3>{ingredients.length ? 'ยังไม่มีการซื้อในช่วงที่เลือก' : 'ยังไม่มีวัตถุดิบให้บันทึกการซื้อ'}</h3>
          <p>{ingredients.length ? 'เลือกเดือนอื่น หรือกด “บันทึกการซื้อ” เพื่อเพิ่มล็อตแรกของเดือนนี้' : 'ไปที่หัวข้อ “วัตถุดิบ” เพื่อเพิ่มวัตถุดิบก่อน แล้วจึงบันทึกการซื้อได้'}</p>
          {ingredients.length ? <Button onClick={() => setDialog('new')} size="small" type="button"><Plus size={15} /> บันทึกการซื้อ</Button> : null}
        </div>
      )}

      {report && totalPages > 1 ? (
        <nav aria-label="หน้ารายการซื้อ" className="report-pagination">
          <Button disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} size="small" type="button" variant="secondary"><ChevronLeft size={14} /> ก่อนหน้า</Button>
          <span>หน้า {formatCount(page)} / {formatCount(totalPages)}</span>
          <Button disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)} size="small" type="button" variant="secondary">ถัดไป <ChevronRight size={14} /></Button>
        </nav>
      ) : null}

      <PurchaseForm
        ingredients={ingredients}
        key={`purchase-${dialog === 'new' ? 'new' : dialog?.id ?? 'closed'}`}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        onSaved={async (message) => { await refreshAll(); onSuccess(message) }}
        purchase={dialog}
        today={today}
      />
      <ConfirmDialog
        confirmLabel="ลบการซื้อ"
        description={confirmAction?.description ?? ''}
        onConfirm={() => void runConfirm()}
        error={confirmError}
        onOpenChange={(open) => { if (!open) { setConfirmAction(null); setConfirmError('') } }}
        open={Boolean(confirmAction)}
        pending={pendingConfirm}
        title={confirmAction?.title ?? ''}
      />
    </section>
  )
}
