import {
  IngredientUnitLockedError,
  InvalidRecipeError,
  PurchaseNotFoundError,
  type CostingOverview,
  type CostingRepository,
  type Ingredient,
  type IngredientInput,
  type IngredientPurchase,
  type IngredientPurchaseInput,
  type IngredientPurchaseReport,
  type IngredientUnit,
  type MonthlyProfit,
  type ProductCosting,
  type ProfitSummary,
  type RecipeItem,
  type RecipeItemInput,
} from '@/server/costing/types'
import { bangkokDayRange } from '@/server/orders/validation'
import { getSupabaseServerClient } from '@/server/supabase'

/** PostgREST returns numeric as a string, and a jsonb null as null. */
type Numeric = number | string | null | undefined

type IngredientCostRow = {
  archived_at: string | null
  average_unit_cost: Numeric
  id: string
  last_purchased_on: string | null
  name: string
  purchase_count: Numeric
  recipe_product_count: Numeric
  total_cost: Numeric
  total_quantity: Numeric
  unit: IngredientUnit
  unit_locked: boolean
}

type RecipeItemJson = {
  batchQuantity: Numeric
  batchYield: Numeric
  ingredientArchivedAt: string | null
  ingredientId: string
  ingredientName: string
  ingredientUnit: IngredientUnit
  unitCost: Numeric
}

type ProductCostingRow = {
  category_name: string | null
  id: string
  margin_ratio: Numeric
  missing_ingredient_count: Numeric
  name: string
  price: Numeric
  profit_per_unit: Numeric
  recipe: RecipeItemJson[] | null
  unit_cost: Numeric
}

type IngredientPurchaseRow = {
  id: string
  ingredient_id: string
  ingredient_name: string
  note: string | null
  purchased_on: string
  quantity: Numeric
  total_cost: Numeric
  total_items: Numeric
  total_lot_cost: Numeric
  unit: IngredientUnit
  unit_cost: Numeric
}

type ProfitSummaryRow = {
  cash_profit: Numeric
  cogs: Numeric
  costed_item_count: Numeric
  costed_revenue: Numeric
  gross_profit: Numeric
  item_count: Numeric
  order_count: Numeric
  purchase_cost: Numeric
  revenue: Numeric
  uncosted_item_count: Numeric
  uncosted_revenue: Numeric
}

type MonthlyProfitRow = ProfitSummaryRow & {
  month: string
}

/**
 * Null stays null all the way to the screen: an unknown cost formats as '—',
 * never as 0 (which would read as free) and never as NaN if a column ever
 * drifts to a value Number() cannot parse.
 */
function toNullableNumber(value: Numeric): number | null {
  if (value === null || value === undefined) return null

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toNumber(value: Numeric): number {
  return toNullableNumber(value) ?? 0
}

function mapIngredient(row: IngredientCostRow): Ingredient {
  return {
    archivedAt: row.archived_at,
    averageUnitCost: toNullableNumber(row.average_unit_cost),
    id: row.id,
    lastPurchasedOn: row.last_purchased_on,
    name: row.name,
    purchaseCount: toNumber(row.purchase_count),
    recipeProductCount: toNumber(row.recipe_product_count),
    totalCost: toNumber(row.total_cost),
    totalQuantity: toNumber(row.total_quantity),
    unit: row.unit,
    unitLocked: row.unit_locked === true,
  }
}

function mapRecipeItem(item: RecipeItemJson): RecipeItem {
  return {
    batchQuantity: toNumber(item.batchQuantity),
    batchYield: toNumber(item.batchYield),
    ingredientArchivedAt: item.ingredientArchivedAt,
    ingredientId: item.ingredientId,
    ingredientName: item.ingredientName,
    ingredientUnit: item.ingredientUnit,
    unitCost: toNullableNumber(item.unitCost),
  }
}

function mapProductCosting(row: ProductCostingRow): ProductCosting {
  return {
    categoryName: row.category_name,
    id: row.id,
    marginRatio: toNullableNumber(row.margin_ratio),
    missingIngredientCount: toNumber(row.missing_ingredient_count),
    name: row.name,
    price: toNumber(row.price),
    profitPerUnit: toNullableNumber(row.profit_per_unit),
    recipe: (row.recipe ?? []).map(mapRecipeItem),
    unitCost: toNullableNumber(row.unit_cost),
  }
}

function mapPurchase(row: IngredientPurchaseRow): IngredientPurchase {
  return {
    id: row.id,
    ingredientId: row.ingredient_id,
    ingredientName: row.ingredient_name,
    note: row.note,
    purchasedOn: row.purchased_on,
    quantity: toNumber(row.quantity),
    totalCost: toNumber(row.total_cost),
    unit: row.unit,
    unitCost: toNumber(row.unit_cost),
  }
}

function mapProfitSummary(row: ProfitSummaryRow): ProfitSummary {
  return {
    cashProfit: toNumber(row.cash_profit),
    cogs: toNumber(row.cogs),
    costedItemCount: toNumber(row.costed_item_count),
    costedRevenue: toNumber(row.costed_revenue),
    grossProfit: toNumber(row.gross_profit),
    itemCount: toNumber(row.item_count),
    orderCount: toNumber(row.order_count),
    purchaseCost: toNumber(row.purchase_cost),
    revenue: toNumber(row.revenue),
    uncostedItemCount: toNumber(row.uncosted_item_count),
    uncostedRevenue: toNumber(row.uncosted_revenue),
  }
}

const EMPTY_PROFIT_SUMMARY: ProfitSummaryRow = {
  cash_profit: 0,
  cogs: 0,
  costed_item_count: 0,
  costed_revenue: 0,
  gross_profit: 0,
  item_count: 0,
  order_count: 0,
  purchase_cost: 0,
  revenue: 0,
  uncosted_item_count: 0,
  uncosted_revenue: 0,
}

/** One ingredient cannot plausibly be bought this many times in a single day. */
const PURCHASE_LOOKUP_LIMIT = 500

export class SupabaseCostingRepository implements CostingRepository {
  async listOverview(): Promise<CostingOverview> {
    const supabase = getSupabaseServerClient()
    const [ingredientsResult, productsResult] = await Promise.all([
      supabase.rpc('get_ingredient_costs'),
      supabase.rpc('get_product_costing'),
    ])

    if (ingredientsResult.error) throw ingredientsResult.error
    if (productsResult.error) throw productsResult.error

    return {
      ingredients: ((ingredientsResult.data ?? []) as IngredientCostRow[]).map(mapIngredient),
      products: ((productsResult.data ?? []) as ProductCostingRow[]).map(mapProductCosting),
    }
  }

  async getIngredient(id: string): Promise<Ingredient | null> {
    const { data, error } = await getSupabaseServerClient().rpc('get_ingredient_costs')
    if (error) throw error

    const row = ((data ?? []) as IngredientCostRow[]).find((item) => item.id === id)
    return row ? mapIngredient(row) : null
  }

  async createIngredient(input: IngredientInput): Promise<Ingredient> {
    const { data, error } = await getSupabaseServerClient()
      .from('ingredients')
      .insert({ name: input.name, unit: input.unit })
      .select('id')
      .single()
    if (error) throw error

    const created = await this.getIngredient((data as { id: string }).id)
    if (!created) throw new Error('Created ingredient could not be loaded.')
    return created
  }

  async updateIngredient(id: string, input: IngredientInput): Promise<Ingredient> {
    const { error } = await getSupabaseServerClient()
      .from('ingredients')
      .update({ name: input.name, unit: input.unit })
      .eq('id', id)
      .select('id')
      .maybeSingle()

    // The unit is frozen by a database trigger once a lot exists; mixing a 1 kg
    // lot with a 1000 g lot would silently make the average wrong by 1000x.
    if (error) {
      if (error.message.includes('INGREDIENT_UNIT_LOCKED')) throw new IngredientUnitLockedError()
      throw error
    }

    const updated = await this.getIngredient(id)
    if (!updated) throw new Error('Updated ingredient could not be loaded.')
    return updated
  }

  async archiveIngredient(id: string): Promise<void> {
    const { error } = await getSupabaseServerClient()
      .from('ingredients')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
      .is('archived_at', null)
    if (error) throw error
  }

  async restoreIngredient(id: string): Promise<void> {
    const { error } = await getSupabaseServerClient()
      .from('ingredients')
      .update({ archived_at: null })
      .eq('id', id)
      .not('archived_at', 'is', null)
    if (error) throw error
  }

  async deleteIngredient(id: string): Promise<void> {
    const { error } = await getSupabaseServerClient()
      .from('ingredients')
      .delete()
      .eq('id', id)
      .not('archived_at', 'is', null)
    if (error) throw error
  }

  async listPurchases(
    startAt: string,
    endAt: string,
    ingredientId: string | null,
    page: number,
    pageSize: number,
  ): Promise<IngredientPurchaseReport> {
    const { data, error } = await getSupabaseServerClient().rpc('get_ingredient_purchases', {
      filter_ingredient: ingredientId,
      report_end: endAt,
      report_start: startAt,
      result_limit: pageSize,
      result_offset: (page - 1) * pageSize,
    })
    if (error) throw error

    const rows = (data ?? []) as IngredientPurchaseRow[]
    // The window aggregates cover the whole filtered set, so they are identical
    // on every row; an empty page carries none and reports zeroes.
    const totalItems = rows.length ? toNumber(rows[0].total_items) : 0
    const totalCost = rows.length ? toNumber(rows[0].total_lot_cost) : 0

    return {
      items: rows.map(mapPurchase),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      },
      range: { endAt, startAt },
      summary: { lotCount: totalItems, totalCost },
      timezone: 'Asia/Bangkok',
    }
  }

  /**
   * Reads the lot back through get_ingredient_purchases instead of dividing
   * total_cost by quantity here, so the unit cost on a freshly written lot is
   * the same SQL numeric the list shows.
   */
  private async loadPurchase(
    id: string,
    ingredientId: string,
    purchasedOn: string,
  ): Promise<IngredientPurchase> {
    const range = bangkokDayRange(purchasedOn)
    const { data, error } = await getSupabaseServerClient().rpc('get_ingredient_purchases', {
      filter_ingredient: ingredientId,
      report_end: range.end,
      report_start: range.start,
      result_limit: PURCHASE_LOOKUP_LIMIT,
      result_offset: 0,
    })
    if (error) throw error

    const row = ((data ?? []) as IngredientPurchaseRow[]).find((item) => item.id === id)
    if (!row) throw new Error('Saved purchase could not be loaded.')
    return mapPurchase(row)
  }

  async createPurchase(input: IngredientPurchaseInput): Promise<IngredientPurchase> {
    const { data, error } = await getSupabaseServerClient()
      .from('ingredient_purchases')
      .insert({
        // unit is stamped from the ingredient by a database trigger.
        ingredient_id: input.ingredientId,
        note: input.note,
        purchased_on: input.purchasedOn,
        quantity: input.quantity,
        total_cost: input.totalCost,
      })
      .select('id')
      .single()
    if (error) throw error

    return this.loadPurchase(
      (data as { id: string }).id,
      input.ingredientId,
      input.purchasedOn,
    )
  }

  async updatePurchase(id: string, input: IngredientPurchaseInput): Promise<IngredientPurchase> {
    const { data, error } = await getSupabaseServerClient()
      .from('ingredient_purchases')
      .update({
        ingredient_id: input.ingredientId,
        note: input.note,
        purchased_on: input.purchasedOn,
        quantity: input.quantity,
        total_cost: input.totalCost,
      })
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    // An update that matches nothing is not an error to PostgREST, so without
    // this the owner would be told a deleted lot had been saved.
    if (!data) throw new PurchaseNotFoundError()

    return this.loadPurchase(id, input.ingredientId, input.purchasedOn)
  }

  async deletePurchase(id: string): Promise<void> {
    const { data, error } = await getSupabaseServerClient()
      .from('ingredient_purchases')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new PurchaseNotFoundError()
  }

  async setProductRecipe(productId: string, items: RecipeItemInput[]): Promise<ProductCosting> {
    const { data, error } = await getSupabaseServerClient().rpc('set_product_recipe', {
      recipe_items: items.map((item) => ({
        batchQuantity: item.batchQuantity,
        batchYield: item.batchYield,
        ingredientId: item.ingredientId,
      })),
      target_product: productId,
    })

    if (error) {
      if (error.message.includes('INVALID_RECIPE')) throw new InvalidRecipeError()
      throw error
    }

    return mapProductCosting(data as ProductCostingRow)
  }

  async profitSummary(startAt: string, endAt: string): Promise<ProfitSummary> {
    const { data, error } = await getSupabaseServerClient().rpc('get_profit_summary', {
      report_end: endAt,
      report_start: startAt,
    })
    if (error) throw error

    const row = ((data ?? []) as ProfitSummaryRow[])[0] ?? EMPTY_PROFIT_SUMMARY
    return mapProfitSummary(row)
  }

  async listMonthlyProfit(startAt: string, endAt: string): Promise<MonthlyProfit[]> {
    const { data, error } = await getSupabaseServerClient().rpc('get_monthly_profit', {
      report_end: endAt,
      report_start: startAt,
    })
    if (error) throw error

    return ((data ?? []) as MonthlyProfitRow[]).map((row) => ({
      ...mapProfitSummary(row),
      month: row.month,
    }))
  }
}
