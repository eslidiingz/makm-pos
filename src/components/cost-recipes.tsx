'use client'

import { ChefHat, ChevronLeft, ChevronRight, Plus, Search, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
  formatCount,
  formatPercent,
  formatQuantity,
  formatUnitMoney,
  ingredientUnitShortLabel,
} from '@/lib/costing-format'
import type { Ingredient, ProductCosting } from '@/server/costing/types'

/**
 * The owner phrases a recipe two ways and both must survive a round trip:
 * "batch" is "ซื้อ 1 กก. ทำได้ 20 ไม้" (quantity 1, yield 20) and "per-unit" is
 * "ใช้ 0.05 กก. ต่อ 1 ไม้" (quantity 0.05, yield 1). Switching the mode keeps
 * the digits the owner typed - rewriting them into a rounded reciprocal would
 * quietly change the recipe.
 */
type RecipeMode = 'batch' | 'per-unit'

type RecipeRow = {
  batchQuantity: string
  batchYield: string
  ingredientId: string
  key: string
  mode: RecipeMode
}

const ALL_CATEGORIES = 'all'
const MAX_RECIPE_ROWS = 40
const PRODUCTS_PER_PAGE = 9

const MODE_OPTIONS: Array<{ label: string; value: RecipeMode }> = [
  { label: 'ทำได้กี่ไม้', value: 'batch' },
  { label: 'ใช้ต่อ 1 ไม้', value: 'per-unit' },
]

let rowSequence = 0

function newRow(): RecipeRow {
  rowSequence += 1
  return { batchQuantity: '', batchYield: '', ingredientId: '', key: `row-${rowSequence}`, mode: 'batch' }
}

function rowYield(row: RecipeRow) {
  return row.mode === 'batch' ? Number(row.batchYield) : 1
}

/**
 * Preview only. The server recomputes every figure in SQL numeric on save.
 *
 * The average is re-derived from the totals rather than read off
 * averageUnitCost, which the RPC already rounds to two decimals. Seasoning at
 * ฿80 per 20,000 g is ฿0.004/g; the rounded value is 0.00, and multiplying it
 * by a 250 g line would preview ฿0.00 against a real ฿1.00.
 */
function rowUnitCost(row: RecipeRow, ingredient: Ingredient | undefined) {
  if (!ingredient || ingredient.averageUnitCost === null) return null
  if (!(ingredient.totalQuantity > 0)) return null
  const average = ingredient.totalCost / ingredient.totalQuantity
  const quantity = Number(row.batchQuantity)
  const yieldValue = rowYield(row)
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  if (!Number.isFinite(yieldValue) || yieldValue < 1) return null
  return average * quantity / yieldValue
}

function costReason(product: ProductCosting) {
  if (product.unitCost !== null) return null
  if (!product.recipe.length) return 'ยังไม่ได้ตั้งสูตร จึงยังคำนวณต้นทุนและกำไรไม่ได้'
  if (product.missingIngredientCount > 0) {
    return `วัตถุดิบ ${formatCount(product.missingIngredientCount)} รายการในสูตรยังไม่มีราคาซื้อ จึงยังคำนวณต้นทุนไม่ได้`
  }
  return 'ยังคำนวณต้นทุนของเมนูนี้ไม่ได้'
}

function RecipeDialog({
  ingredients,
  onOpenChange,
  onSaved,
  product,
}: {
  ingredients: Ingredient[]
  onOpenChange: (open: boolean) => void
  onSaved: (product: ProductCosting, message: string) => void
  product: ProductCosting | null
}) {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [rows, setRows] = useState<RecipeRow[]>(() => (product?.recipe ?? []).map((item) => {
    rowSequence += 1
    return {
      batchQuantity: String(item.batchQuantity),
      batchYield: String(item.batchYield),
      ingredientId: item.ingredientId,
      key: `row-${rowSequence}`,
      mode: item.batchYield === 1 ? 'per-unit' : 'batch',
    }
  }))

  function patchRow(key: string, patch: Partial<RecipeRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row))
    setRowErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function validateRows() {
    const errors: Record<string, string> = {}
    const seen = new Set<string>()
    for (const row of rows) {
      if (!row.ingredientId) {
        errors[row.key] = 'กรุณาเลือกวัตถุดิบ'
        continue
      }
      if (seen.has(row.ingredientId)) {
        errors[row.key] = 'วัตถุดิบนี้ถูกเพิ่มไว้ในสูตรแล้ว'
        continue
      }
      seen.add(row.ingredientId)
      const quantity = Number(row.batchQuantity)
      if (!row.batchQuantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
        errors[row.key] = 'ปริมาณต้องเป็นตัวเลขมากกว่า 0'
        continue
      }
      if (row.mode === 'batch') {
        const yieldValue = Number(row.batchYield)
        if (
          !row.batchYield.trim()
          || !Number.isInteger(yieldValue)
          || yieldValue < 1
          || yieldValue > 100000
        ) {
          errors[row.key] = 'จำนวนไม้ต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100,000'
        }
      }
    }
    setRowErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!product) return
    if (!validateRows()) return

    setPending(true)
    try {
      const saved = await requestJson<ProductCosting>(
        `/api/admin/costs/products/${product.id}/recipe`,
        {
          body: JSON.stringify({
            items: rows.map((row) => ({
              batchQuantity: Number(row.batchQuantity),
              batchYield: row.mode === 'batch' ? Number(row.batchYield) : 1,
              ingredientId: row.ingredientId,
            })),
          }),
          method: 'PUT',
        },
      )
      onSaved(saved, rows.length ? `บันทึกสูตรของ “${saved.name}” แล้ว` : `ล้างสูตรของ “${saved.name}” แล้ว`)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'บันทึกสูตรไม่สำเร็จ')
    } finally {
      setPending(false)
    }
  }

  const previews = rows.map((row) => rowUnitCost(row, ingredients.find((item) => item.id === row.ingredientId)))
  const totalPreview = rows.length && previews.every((value) => value !== null)
    ? previews.reduce((total: number, value) => total + (value ?? 0), 0)
    : null

  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(product)}>
      <DialogContent className="cost-recipe-dialog">
        <DialogHeader>
          <DialogTitle>สูตรของ {product?.name ?? ''}</DialogTitle>
          <DialogDescription>
            บอกระบบว่าวัตถุดิบที่ซื้อมาแบ่งได้กี่ไม้ หรือหนึ่งไม้ใช้เท่าไหร่ ลบทุกบรรทัดเพื่อล้างสูตร
          </DialogDescription>
        </DialogHeader>
        <form className="catalog-form" noValidate onSubmit={submit}>
          {rows.length ? (
            <div className="cost-recipe-rows">
              {rows.map((row, index) => {
                const ingredient = ingredients.find((item) => item.id === row.ingredientId)
                const unitShort = ingredient ? ingredientUnitShortLabel[ingredient.unit] : 'หน่วย'
                const options = ingredients.filter((item) => !item.archivedAt || item.id === row.ingredientId)
                const quantityValue = Number(row.batchQuantity)
                const yieldValue = Number(row.batchYield)
                const alternate = row.mode === 'batch'
                  && Number.isFinite(quantityValue) && quantityValue > 0
                  && Number.isFinite(yieldValue) && yieldValue >= 1
                  ? `ประมาณ ใช้ ${formatQuantity(quantityValue / yieldValue)} ${unitShort} ต่อ 1 ไม้`
                  : row.mode === 'per-unit' && Number.isFinite(quantityValue) && quantityValue > 0
                    ? `ประมาณ 1 ${unitShort} ทำได้ ${formatQuantity(1 / quantityValue)} ไม้`
                    : ''

                const rowError = rowErrors[row.key]
                // The message already renders below the row; these wire the
                // controls to it so the invalid field is announced too.
                const errorProps = {
                  'aria-describedby': rowError ? `${row.key}-error` : undefined,
                  'aria-invalid': rowError ? true : undefined,
                }

                return (
                  <div className="cost-recipe-row" key={row.key}>
                    <div className="cost-recipe-row-head">
                      <div className="catalog-field">
                        <Label htmlFor={`${row.key}-ingredient`} required>วัตถุดิบบรรทัดที่ {formatCount(index + 1)}</Label>
                        <Select
                          onValueChange={(value) => patchRow(row.key, { ingredientId: value })}
                          value={row.ingredientId}
                        >
                          <SelectTrigger id={`${row.key}-ingredient`} required {...errorProps}><SelectValue placeholder="เลือกวัตถุดิบ" /></SelectTrigger>
                          <SelectContent>
                            {options.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.name} ({ingredientUnitShortLabel[item.unit]})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        aria-label={`ลบวัตถุดิบบรรทัดที่ ${index + 1}`}
                        className="cost-recipe-remove"
                        onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                        size="icon"
                        type="button"
                        variant="ghost"
                      ><Trash2 size={14} /></Button>
                    </div>

                    <div aria-label={`วิธีกรอกของบรรทัดที่ ${index + 1}`} className="report-periods cost-mode-toggle" role="group">
                      {MODE_OPTIONS.map((option) => (
                        <Button
                          aria-pressed={row.mode === option.value}
                          className={row.mode === option.value ? 'active' : ''}
                          key={option.value}
                          onClick={() => patchRow(row.key, { mode: option.value })}
                          size="small"
                          type="button"
                          variant="ghost"
                        >{option.label}</Button>
                      ))}
                    </div>

                    <div className="cost-recipe-inputs">
                      {row.mode === 'batch' ? (
                        <>
                          <div className="catalog-field">
                            <Label htmlFor={`${row.key}-quantity`} required>ซื้อมา ({unitShort})</Label>
                            <Input
                              id={`${row.key}-quantity`}
                              {...errorProps}
                              inputMode="decimal"
                              min="0"
                              onChange={(event) => patchRow(row.key, { batchQuantity: event.target.value })}
                              placeholder="1"
                              required
                              step="0.0001"
                              type="number"
                              value={row.batchQuantity}
                            />
                          </div>
                          <span className="cost-recipe-joiner">ทำได้</span>
                          <div className="catalog-field">
                            <Label htmlFor={`${row.key}-yield`} required>จำนวนไม้</Label>
                            <Input
                              id={`${row.key}-yield`}
                              {...errorProps}
                              inputMode="numeric"
                              min="1"
                              onChange={(event) => patchRow(row.key, { batchYield: event.target.value })}
                              placeholder="20"
                              required
                              step="1"
                              type="number"
                              value={row.batchYield}
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="catalog-field">
                            <Label htmlFor={`${row.key}-quantity`} required>ใช้ ({unitShort})</Label>
                            <Input
                              id={`${row.key}-quantity`}
                              {...errorProps}
                              inputMode="decimal"
                              min="0"
                              onChange={(event) => patchRow(row.key, { batchQuantity: event.target.value })}
                              placeholder="0.05"
                              required
                              step="0.0001"
                              type="number"
                              value={row.batchQuantity}
                            />
                          </div>
                          <span className="cost-recipe-joiner">ต่อ 1 ไม้</span>
                        </>
                      )}
                    </div>

                    <div className="cost-recipe-hint">
                      <span>{alternate}</span>
                      <strong>
                        {ingredient && ingredient.averageUnitCost === null
                          ? 'วัตถุดิบนี้ยังไม่มีราคาซื้อ'
                          : `ต้นทุนบรรทัดนี้ (ประมาณ) ${formatUnitMoney(previews[index])}`}
                      </strong>
                    </div>
                    <FieldError id={`${row.key}-error`} message={rowErrors[row.key]} />
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="cost-note">ยังไม่มีบรรทัดในสูตรนี้ กด “เพิ่มวัตถุดิบ” เพื่อเริ่ม หรือกดบันทึกเพื่อล้างสูตรเดิม</p>
          )}

          <div className="cost-recipe-footer">
            <Button
              disabled={rows.length >= MAX_RECIPE_ROWS}
              onClick={() => setRows((current) => [...current, newRow()])}
              size="small"
              type="button"
              variant="secondary"
            ><Plus size={14} /> เพิ่มวัตถุดิบ</Button>
            <p className="cost-preview">
              <span>ต้นทุนรวมต่อไม้ (ประมาณ)</span>
              <strong>{formatUnitMoney(totalPreview)}</strong>
            </p>
          </div>
          {rows.length >= MAX_RECIPE_ROWS ? <p className="field-hint">หนึ่งสูตรใส่ได้สูงสุด {formatCount(MAX_RECIPE_ROWS)} วัตถุดิบ</p> : null}
          <p className="field-hint">ตัวเลข “ประมาณ” เป็นเพียงการดูคร่าว ๆ ระบบจะคำนวณค่าจริงให้ใหม่ทุกครั้งที่บันทึก</p>

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">ยกเลิก</Button>
            <Button disabled={pending} type="submit">{pending ? 'กำลังบันทึก...' : 'บันทึกสูตร'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CostRecipes({
  ingredients,
  onError,
  onProductSaved,
  onSuccess,
  products,
  reload,
}: {
  ingredients: Ingredient[]
  onError: (message: string) => void
  onProductSaved: (product: ProductCosting) => void
  onSuccess: (message: string) => void
  products: ProductCosting[]
  reload: () => Promise<void>
}) {
  const [category, setCategory] = useState(ALL_CATEGORIES)
  const [dialogProduct, setDialogProduct] = useState<ProductCosting | null>(null)
  const [page, setPage] = useState(1)
  const [renderedFilter, setRenderedFilter] = useState(`${ALL_CATEGORIES}|`)
  const [search, setSearch] = useState('')

  const filterKey = `${category}|${search.trim().toLowerCase()}`
  // Resetting during render keeps page one in sync with the filter without the
  // extra pass an effect would cost.
  if (renderedFilter !== filterKey) {
    setRenderedFilter(filterKey)
    setPage(1)
  }

  const categories = Array.from(new Set(products.map((item) => item.categoryName ?? 'ไม่ระบุประเภท')))
  const term = search.trim().toLowerCase()
  const filtered = products.filter((item) => {
    const itemCategory = item.categoryName ?? 'ไม่ระบุประเภท'
    if (category !== ALL_CATEGORIES && itemCategory !== category) return false
    return term ? item.name.toLowerCase().includes(term) : true
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * PRODUCTS_PER_PAGE
  const paginated = filtered.slice(pageStart, pageStart + PRODUCTS_PER_PAGE)
  const costed = products.filter((item) => item.unitCost !== null).length
  const uncosted = products.length - costed

  return (
    <section aria-labelledby="cost-recipes-title" className="cost-panel">
      <div className="cost-panel-heading">
        <div>
          <p className="eyebrow">RECIPES &amp; PROFIT</p>
          <h2 id="cost-recipes-title">สูตรและกำไรต่อไม้</h2>
          <p>ตั้งสูตรว่าหนึ่งไม้ใช้วัตถุดิบเท่าไหร่ แล้วดูต้นทุนและกำไรจริงต่อไม้</p>
        </div>
      </div>

      <div className="cost-summary-grid">
        <Card className="cost-summary-card"><span>คำนวณต้นทุนได้</span><strong>{formatCount(costed)}</strong><small>จาก {formatCount(products.length)} เมนู</small></Card>
        <Card className="cost-summary-card"><span>ยังคำนวณไม่ได้</span><strong className={uncosted ? 'is-warning' : ''}>{formatCount(uncosted)}</strong><small>เมนูที่ยังไม่มีสูตรหรือวัตถุดิบยังไม่มีราคา</small></Card>
      </div>

      {uncosted ? (
        <p className="cost-note">
          กำไรที่สรุปในหน้ารายงานยังไม่รวมต้นทุนของ {formatCount(uncosted)} เมนูนี้
          ตัวเลขกำไรขั้นต้นจึงสูงกว่าความจริงจนกว่าจะตั้งสูตรและบันทึกราคาซื้อครบ
        </p>
      ) : null}

      <div className="cost-filters">
        <div className="cost-filter">
          <Label htmlFor="recipe-search">ค้นหาเมนู</Label>
          <div className="cost-search">
            <Search aria-hidden="true" size={15} />
            <Input
              id="recipe-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="พิมพ์ชื่อเมนู"
              value={search}
            />
          </div>
        </div>
        <div className="cost-filter">
          <Label htmlFor="recipe-category">ประเภท</Label>
          <Select onValueChange={setCategory} value={category}>
            <SelectTrigger id="recipe-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>ทุกประเภท</SelectItem>
              {categories.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {paginated.length ? (
        <div className="cost-recipe-grid">
          {paginated.map((item) => {
            const reason = costReason(item)
            return (
              <Card className="cost-product-card" key={item.id}>
                <div className="cost-row-title">
                  <strong>{item.name}</strong>
                  <span className="cost-chip">{item.categoryName ?? 'ไม่ระบุประเภท'}</span>
                </div>
                <dl className="cost-product-metrics">
                  <div><dt>ราคาขาย</dt><dd className="is-money">{formatUnitMoney(item.price)}</dd></div>
                  <div><dt>ต้นทุน / ไม้</dt><dd>{formatUnitMoney(item.unitCost)}</dd></div>
                  <div><dt>กำไร / ไม้</dt><dd className={item.profitPerUnit !== null && item.profitPerUnit < 0 ? 'is-negative' : item.profitPerUnit !== null ? 'is-positive' : ''}>{formatUnitMoney(item.profitPerUnit)}</dd></div>
                  <div><dt>อัตรากำไร</dt><dd>{formatPercent(item.marginRatio)}</dd></div>
                </dl>
                {reason ? <p className="cost-note">{reason}</p> : (
                  <p className="cost-recipe-summary">
                    ใช้วัตถุดิบ {formatCount(item.recipe.length)} รายการ · {item.recipe.map((line) => line.ingredientName).join(', ')}
                  </p>
                )}
                <div className="cost-row-actions">
                  <Button disabled={!ingredients.length} onClick={() => setDialogProduct(item)} size="small" type="button" variant="secondary">
                    <ChefHat size={14} /> {item.recipe.length ? 'แก้ไขสูตร' : 'ตั้งสูตร'}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      ) : (
        <div className="cost-state">
          <ChefHat aria-hidden="true" size={32} />
          <h3>{products.length ? 'ไม่พบเมนูตามตัวกรอง' : 'ยังไม่มีเมนูในระบบ'}</h3>
          <p>{products.length ? 'ลองล้างคำค้นหรือเลือกประเภทอื่น' : 'เพิ่มเมนูในหน้า “ประเภทและเมนู” ก่อน แล้วจึงตั้งสูตรต้นทุนได้'}</p>
        </div>
      )}

      {totalPages > 1 ? (
        <nav aria-label="หน้ารายการเมนู" className="report-pagination">
          <Button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} size="small" type="button" variant="secondary"><ChevronLeft size={14} /> ก่อนหน้า</Button>
          <span>หน้า {formatCount(currentPage)} / {formatCount(totalPages)} · {formatCount(filtered.length)} เมนู</span>
          <Button disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} size="small" type="button" variant="secondary">ถัดไป <ChevronRight size={14} /></Button>
        </nav>
      ) : null}

      {!ingredients.length ? <p className="field-hint">ต้องมีวัตถุดิบอย่างน้อยหนึ่งรายการก่อนจึงจะตั้งสูตรได้</p> : null}

      <RecipeDialog
        ingredients={ingredients}
        key={`recipe-${dialogProduct?.id ?? 'closed'}`}
        onOpenChange={(open) => { if (!open) setDialogProduct(null) }}
        onSaved={(saved, message) => {
          onProductSaved(saved)
          onSuccess(message)
          void reload().catch((refreshError: unknown) => {
            onError(refreshError instanceof Error ? refreshError.message : 'รีเฟรชข้อมูลต้นทุนไม่สำเร็จ')
          })
        }}
        product={dialogProduct}
      />
    </section>
  )
}
