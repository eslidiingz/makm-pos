'use client'

import { Archive, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
  formatBangkokDate,
  formatCount,
  formatIngredientQuantity,
  formatMoney,
  formatUnitRate,
  ingredientUnitLabel,
  ingredientUnitOptions,
} from '@/lib/costing-format'
import { useFormValidation } from '@/lib/form-validation'
import type { Ingredient, IngredientUnit } from '@/server/costing/types'

type IngredientDialogState = Ingredient | 'new' | null

const INGREDIENT_SCHEMA = {
  name: (value: string) => {
    if (!value.trim()) return 'กรุณากรอกชื่อวัตถุดิบ'
    return value.trim().length <= 80 ? null : 'ชื่อวัตถุดิบต้องไม่เกิน 80 ตัวอักษร'
  },
  unit: (value: string) => value ? null : 'กรุณาเลือกหน่วยที่ซื้อ',
}

function IngredientForm({
  ingredient,
  onOpenChange,
  onSaved,
}: {
  ingredient: IngredientDialogState
  onOpenChange: (open: boolean) => void
  onSaved: (message: string) => Promise<void>
}) {
  const editing = ingredient !== 'new' && ingredient !== null ? ingredient : null
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [unit, setUnit] = useState<IngredientUnit>(editing?.unit ?? 'kg')
  const { clearField, fieldErrors, fieldProps, validate } = useFormValidation(INGREDIENT_SCHEMA)
  const unitLocked = Boolean(editing?.unitLocked)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '')
    if (!validate({ name, unit })) return

    setPending(true)
    try {
      const saved = await requestJson<Ingredient>(
        editing ? `/api/admin/costs/ingredients/${editing.id}` : '/api/admin/costs/ingredients',
        {
          body: JSON.stringify({ name: name.trim(), unit }),
          method: editing ? 'PATCH' : 'POST',
        },
      )
      await onSaved(editing ? `บันทึกวัตถุดิบ “${saved.name}” แล้ว` : `เพิ่มวัตถุดิบ “${saved.name}” แล้ว`)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'บันทึกวัตถุดิบไม่สำเร็จ')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(ingredient)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ'}</DialogTitle>
          <DialogDescription>ตั้งชื่อตามที่เรียกหน้าร้าน และเลือกหน่วยที่ซื้อจริง</DialogDescription>
        </DialogHeader>
        <form className="catalog-form" noValidate onSubmit={submit}>
          <div className="catalog-field">
            <Label htmlFor="ingredient-name" required>ชื่อวัตถุดิบ</Label>
            <Input
              autoFocus
              defaultValue={editing?.name}
              id="ingredient-name"
              maxLength={80}
              name="name"
              placeholder="เช่น หมูสามชั้น"
              required
              {...fieldProps('name')}
            />
            <FieldError id="name-error" message={fieldErrors.name} />
          </div>
          <div className="catalog-field">
            <Label htmlFor="ingredient-unit" required>หน่วยที่ซื้อ</Label>
            <Select
              disabled={unitLocked}
              onValueChange={(value) => { setUnit(value as IngredientUnit); clearField('unit') }}
              value={unit}
            >
              <SelectTrigger
                aria-describedby={unitLocked ? 'ingredient-unit-locked' : fieldErrors.unit ? 'unit-error' : undefined}
                aria-invalid={fieldErrors.unit ? true : undefined}
                id="ingredient-unit"
                required
              ><SelectValue /></SelectTrigger>
              <SelectContent>
                {ingredientUnitOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id="unit-error" message={fieldErrors.unit} />
            {unitLocked ? (
              <p className="cost-note" id="ingredient-unit-locked">
                หน่วยถูกล็อกไว้ที่ “{ingredientUnitLabel[unit]}” เพราะมีการบันทึกการซื้อแล้ว
                การสลับหน่วยจะทำให้ต้นทุนเฉลี่ยของทุกล็อตผิดพลาด
                หากต้องการหน่วยอื่นให้สร้างวัตถุดิบใหม่แทน
              </p>
            ) : (
              <p className="field-hint">เลือกหน่วยที่ซื้อจริง หน่วยนี้จะถูกล็อกทันทีที่บันทึกการซื้อครั้งแรก</p>
            )}
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">ยกเลิก</Button>
            <Button disabled={pending} type="submit">{pending ? 'กำลังบันทึก...' : 'บันทึกวัตถุดิบ'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CostIngredients({
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
    label: string
    run: () => Promise<void>
    title: string
  }>(null)
  const [dialog, setDialog] = useState<IngredientDialogState>(null)
  const [confirmError, setConfirmError] = useState('')
  const [pendingConfirm, setPendingConfirm] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const active = ingredients.filter((item) => !item.archivedAt)
  const archived = ingredients.filter((item) => item.archivedAt)
  const withoutPrice = active.filter((item) => item.averageUnitCost === null)

  async function mutate(url: string, method: string, message: string) {
    await requestJson(url, { method })
    await reload()
    onSuccess(message)
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
    <section aria-labelledby="cost-ingredients-title" className="cost-panel">
      <div className="cost-panel-heading">
        <div>
          <p className="eyebrow">INGREDIENTS</p>
          <h2 id="cost-ingredients-title">วัตถุดิบ</h2>
          <p>ต้นทุนต่อหน่วยคือค่าเฉลี่ยถ่วงน้ำหนักจากทุกล็อตที่ซื้อ</p>
        </div>
        <Button onClick={() => setDialog('new')} size="small" type="button"><Plus size={15} /> เพิ่มวัตถุดิบ</Button>
      </div>

      {active.length ? (
        <div className="cost-summary-grid">
          <Card className="cost-summary-card"><span>วัตถุดิบที่ใช้งาน</span><strong>{formatCount(active.length)}</strong><small>รายการ</small></Card>
          <Card className="cost-summary-card"><span>ยังไม่มีราคา</span><strong className={withoutPrice.length ? 'is-warning' : ''}>{formatCount(withoutPrice.length)}</strong><small>รายการที่ยังคำนวณต้นทุนไม่ได้</small></Card>
        </div>
      ) : null}

      {active.length ? (
        <div className="cost-list">
          {active.map((item) => (
            <Card className="cost-row" key={item.id}>
              <div className="cost-row-head">
                <div className="cost-row-title">
                  <strong>{item.name}</strong>
                  <span className="cost-chip">{ingredientUnitLabel[item.unit]}</span>
                  {item.averageUnitCost === null ? <span className="cost-chip is-warning">ยังไม่มีราคา</span> : null}
                </div>
                <p className="cost-row-price">{formatUnitRate(item.averageUnitCost, item.unit)}</p>
              </div>
              <dl className="cost-metrics">
                <div><dt>ล็อตที่ซื้อ</dt><dd>{formatCount(item.purchaseCount)} ครั้ง</dd></div>
                <div><dt>ซื้อล่าสุด</dt><dd>{item.lastPurchasedOn ? formatBangkokDate(item.lastPurchasedOn) : '—'}</dd></div>
                <div><dt>ปริมาณรวม</dt><dd>{item.purchaseCount ? formatIngredientQuantity(item.totalQuantity, item.unit) : '—'}</dd></div>
                <div><dt>ใช้จ่ายรวม</dt><dd>{item.purchaseCount ? formatMoney(item.totalCost) : '—'}</dd></div>
                <div><dt>ใช้ในเมนู</dt><dd>{formatCount(item.recipeProductCount)} เมนู</dd></div>
              </dl>
              {item.averageUnitCost === null ? (
                <p className="cost-note">ยังไม่มีการบันทึกการซื้อ เมนูที่ใช้วัตถุดิบนี้จึงแสดงต้นทุนเป็น “—” จนกว่าจะบันทึกล็อตแรก</p>
              ) : null}
              <div className="cost-row-actions">
                <Button onClick={() => setDialog(item)} size="small" type="button" variant="secondary"><Pencil size={14} /> แก้ไข</Button>
                <Button
                  onClick={() => setConfirmAction({
                    description: `วัตถุดิบ “${item.name}” จะไม่แสดงในตัวเลือกการซื้อและสูตรใหม่ แต่ต้นทุนของสูตรเดิมยังคำนวณต่อไปและกู้คืนได้`,
                    label: 'เก็บวัตถุดิบ',
                    run: () => mutate(`/api/admin/costs/ingredients/${item.id}/archive`, 'POST', `เก็บวัตถุดิบ “${item.name}” แล้ว`),
                    title: 'เก็บวัตถุดิบนี้หรือไม่?',
                  })}
                  size="small"
                  type="button"
                  variant="ghost"
                ><Archive size={14} /> เก็บ</Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="cost-state">
          <h3>ยังไม่มีวัตถุดิบ</h3>
          <p>เริ่มจากเพิ่มวัตถุดิบที่ซื้อประจำ เช่น หมูสามชั้น แล้วบันทึกการซื้อเพื่อให้ระบบคำนวณต้นทุนเฉลี่ยต่อหน่วย</p>
          <Button onClick={() => setDialog('new')} size="small" type="button"><Plus size={15} /> เพิ่มวัตถุดิบแรก</Button>
        </div>
      )}

      {archived.length ? (
        <>
          <button className="archive-toggle" onClick={() => setShowArchived((value) => !value)} type="button">
            <Archive size={15} /> วัตถุดิบที่เก็บไว้ ({formatCount(archived.length)}) {showArchived ? '−' : '+'}
          </button>
          {showArchived ? (
            <div className="archived-list">
              {archived.map((item) => (
                <div key={item.id}>
                  <span>{item.name} · {formatUnitRate(item.averageUnitCost, item.unit)}</span>
                  <div className="archived-item-actions">
                    <Button
                      onClick={() => void mutate(`/api/admin/costs/ingredients/${item.id}/restore`, 'POST', `กู้คืนวัตถุดิบ “${item.name}” แล้ว`).catch((restoreError: unknown) => onError(restoreError instanceof Error ? restoreError.message : 'กู้คืนไม่สำเร็จ'))}
                      size="small"
                      type="button"
                      variant="ghost"
                    ><RotateCcw size={13} /> กู้คืน</Button>
                    <Button
                      aria-label={`ลบวัตถุดิบ ${item.name} ถาวร`}
                      onClick={() => setConfirmAction({
                        description: `วัตถุดิบ “${item.name}” จะถูกลบถาวรและกู้คืนไม่ได้ ลบได้เฉพาะเมื่อไม่มีประวัติการซื้อและไม่มีสูตรใดใช้อยู่`,
                        label: 'ลบถาวร',
                        run: () => mutate(`/api/admin/costs/ingredients/${item.id}`, 'DELETE', `ลบวัตถุดิบ “${item.name}” ถาวรแล้ว`),
                        title: 'ลบวัตถุดิบนี้ถาวรใช่หรือไม่?',
                      })}
                      size="icon"
                      type="button"
                      variant="ghost"
                    ><Trash2 size={13} /></Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      <IngredientForm
        ingredient={dialog}
        key={`ingredient-${dialog === 'new' ? 'new' : dialog?.id ?? 'closed'}`}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        onSaved={async (message) => { await reload(); onSuccess(message) }}
      />
      <ConfirmDialog
        confirmLabel={confirmAction?.label ?? 'ยืนยัน'}
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
