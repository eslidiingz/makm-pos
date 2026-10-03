import { describe, expect, it } from 'vitest'

import {
  isIngredientUnit,
  isValidBatchQuantity,
  isValidBatchYield,
  isValidIngredientName,
  isValidPurchaseCost,
  isValidPurchaseNote,
  isValidPurchaseQuantity,
  isValidRecipeItems,
  normalizeIngredientName,
  normalizePurchaseNote,
} from '@/server/costing/validation'
import {
  bangkokDayRange,
  bangkokMonthKey,
  bangkokMonthRange,
  bangkokTrailingMonthsRange,
  isValidReportMonth,
} from '@/server/orders/validation'

const INGREDIENT = '11111111-1111-4111-8111-111111111111'
const OTHER_INGREDIENT = '22222222-2222-4222-8222-222222222222'

function recipeItem(ingredientId: string, batchQuantity = 1, batchYield = 20) {
  return { batchQuantity, batchYield, ingredientId }
}

describe('bangkokMonthRange', () => {
  it('starts and ends on Bangkok midnight, not UTC midnight', () => {
    expect(bangkokMonthRange('2026-09')).toEqual({
      end: '2026-09-30T17:00:00.000Z',
      start: '2026-08-31T17:00:00.000Z',
    })
  })

  it('rolls December into January instead of producing month 13', () => {
    expect(bangkokMonthRange('2026-12')).toEqual({
      end: '2026-12-31T17:00:00.000Z',
      start: '2026-11-30T17:00:00.000Z',
    })
  })

  it('agrees with the daily report about where a day belongs', () => {
    // A sale at 01:00 Bangkok on 1 September must land in September on both the
    // daily report and the monthly profit summary.
    expect(bangkokMonthRange('2026-09').start).toBe(bangkokDayRange('2026-09-01').start)
    expect(bangkokMonthRange('2026-09').end).toBe(bangkokDayRange('2026-09-30').end)
  })

  it('covers a leap February end to end', () => {
    expect(bangkokMonthRange('2028-02').end).toBe(bangkokDayRange('2028-02-29').end)
  })
})

describe('isValidReportMonth', () => {
  it('accepts a real month', () => {
    expect(isValidReportMonth('2026-09')).toBe(true)
    expect(isValidReportMonth('2026-01')).toBe(true)
    expect(isValidReportMonth('2026-12')).toBe(true)
  })

  it('rejects anything bangkokMonthRange could not parse', () => {
    for (const value of ['2026-13', '2026-00', '2026-9', '202609', '2026', '', 'abcd-ef']) {
      expect(isValidReportMonth(value)).toBe(false)
    }
  })
})

describe('bangkokTrailingMonthsRange', () => {
  const september = Date.parse('2026-09-02T05:00:00.000Z')

  it('covers the current Bangkok month and the five before it', () => {
    expect(bangkokTrailingMonthsRange(6, september)).toEqual({
      end: bangkokMonthRange('2026-09').end,
      start: bangkokMonthRange('2026-04').start,
    })
  })

  it('crosses a year boundary without breaking', () => {
    const february = Date.parse('2026-02-10T05:00:00.000Z')
    expect(bangkokTrailingMonthsRange(6, february)).toEqual({
      end: bangkokMonthRange('2026-02').end,
      start: bangkokMonthRange('2025-09').start,
    })
  })

  it('never returns an inverted range for a nonsense count', () => {
    const range = bangkokTrailingMonthsRange(0, september)
    expect(Date.parse(range.start)).toBeLessThan(Date.parse(range.end))
  })
})

describe('bangkokMonthKey', () => {
  it('uses the Bangkok month, not the UTC one', () => {
    // 31 August 18:00 UTC is already 1 September in Bangkok.
    expect(bangkokMonthKey(Date.parse('2026-08-31T18:00:00.000Z'))).toBe('2026-09')
    expect(bangkokMonthKey(Date.parse('2026-08-31T16:00:00.000Z'))).toBe('2026-08')
  })
})

describe('ingredient input', () => {
  it('collapses whitespace the way the catalog does', () => {
    expect(normalizeIngredientName('  หมู   สามชั้น ')).toBe('หมู สามชั้น')
  })

  it('rejects a blank name and bounds the length at 80', () => {
    expect(isValidIngredientName('   ')).toBe(false)
    expect(isValidIngredientName('ก'.repeat(80))).toBe(true)
    expect(isValidIngredientName('ก'.repeat(81))).toBe(false)
  })

  it('only accepts the units the database check allows', () => {
    for (const unit of ['kg', 'g', 'l', 'ml', 'pack', 'piece']) {
      expect(isIngredientUnit(unit)).toBe(true)
    }
    for (const unit of ['KG', 'กก.', 'ton', '']) {
      expect(isIngredientUnit(unit)).toBe(false)
    }
  })
})

describe('purchase input', () => {
  it('rejects a zero quantity, which would make the weighted average undefined', () => {
    expect(isValidPurchaseQuantity(0)).toBe(false)
    expect(isValidPurchaseQuantity(-1)).toBe(false)
    expect(isValidPurchaseQuantity(1)).toBe(true)
    expect(isValidPurchaseQuantity(0.25)).toBe(true)
  })

  it('rejects a quantity finer than the stored precision', () => {
    // 0.00005 kg would round to 0.0000 in numeric(14,4) and price the recipe
    // from nothing.
    expect(isValidPurchaseQuantity(0.00005)).toBe(false)
    expect(isValidPurchaseQuantity(0.0001)).toBe(true)
  })

  it('accepts a free lot but not a negative one', () => {
    expect(isValidPurchaseCost(0)).toBe(true)
    expect(isValidPurchaseCost(180.5)).toBe(true)
    expect(isValidPurchaseCost(180.555)).toBe(false)
    expect(isValidPurchaseCost(-1)).toBe(false)
  })

  it('rejects non-finite input rather than storing NaN', () => {
    expect(isValidPurchaseQuantity(Number.NaN)).toBe(false)
    expect(isValidPurchaseCost(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('turns a blank note into null and bounds a real one', () => {
    expect(normalizePurchaseNote('   ')).toBeNull()
    expect(normalizePurchaseNote(null)).toBeNull()
    expect(normalizePurchaseNote(' ตลาดเช้า ')).toBe('ตลาดเช้า')
    expect(isValidPurchaseNote(null)).toBe(true)
    expect(isValidPurchaseNote('ก'.repeat(160))).toBe(true)
    expect(isValidPurchaseNote('ก'.repeat(161))).toBe(false)
  })
})

describe('recipe input', () => {
  it('accepts both phrasings the owner can type', () => {
    // "1 kg makes 20 skewers" and "0.05 kg per skewer" are both exact.
    expect(isValidRecipeItems([recipeItem(INGREDIENT, 1, 20)])).toBe(true)
    expect(isValidRecipeItems([recipeItem(INGREDIENT, 0.05, 1)])).toBe(true)
  })

  it('keeps a yield of three exact instead of forcing a rounded reciprocal', () => {
    expect(isValidBatchQuantity(1)).toBe(true)
    expect(isValidBatchYield(3)).toBe(true)
    // The pre-divided form is exactly what the schema refuses to store.
    expect(isValidBatchYield(0.3333)).toBe(false)
  })

  it('rejects a zero or fractional yield', () => {
    expect(isValidRecipeItems([recipeItem(INGREDIENT, 1, 0)])).toBe(false)
    expect(isValidRecipeItems([recipeItem(INGREDIENT, 1, 1.5)])).toBe(false)
    expect(isValidRecipeItems([recipeItem(INGREDIENT, 1, 100_001)])).toBe(false)
  })

  it('rejects a zero batch quantity', () => {
    expect(isValidRecipeItems([recipeItem(INGREDIENT, 0, 20)])).toBe(false)
  })

  it('rejects the same ingredient twice, which would double-count its cost', () => {
    expect(isValidRecipeItems([
      recipeItem(INGREDIENT),
      recipeItem(INGREDIENT, 2, 10),
    ])).toBe(false)
    expect(isValidRecipeItems([
      recipeItem(INGREDIENT),
      recipeItem(OTHER_INGREDIENT),
    ])).toBe(true)
  })

  it('rejects a malformed ingredient id', () => {
    expect(isValidRecipeItems([recipeItem('not-a-uuid')])).toBe(false)
  })

  it('rejects an empty list so clearing a recipe stays an explicit route case', () => {
    expect(isValidRecipeItems([])).toBe(false)
  })

  it('rejects more lines than the schema allows', () => {
    const items = Array.from({ length: 41 }, (_, index) => recipeItem(
      `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
    ))
    expect(isValidRecipeItems(items)).toBe(false)
  })
})
