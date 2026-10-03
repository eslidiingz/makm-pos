import type {
  Catalog,
  CatalogRepository,
  Category,
  CategoryInput,
  ObjectStorageGateway,
  Product,
  ProductInput,
} from '@/server/catalog/types'
import { getSupabaseServerClient } from '@/server/supabase'

type CategoryRow = {
  archived_at: string | null
  id: string
  is_active: boolean
  name: string
  sort_order: number
}

type ProductRow = {
  archived_at: string | null
  category_id: string
  id: string
  image_key: string | null
  is_available: boolean
  name: string
  price: number | string
  sort_order: number
}

type SupabaseQueryResult<T> = {
  data: T | null
  error: { code?: string } | null
}

function isJwtIssuedInFuture(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'PGRST303'
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Supabase can briefly reject a just-issued gateway JWT while its database
 * gateway catches up. The request has not executed in that case, so retrying
 * reads is safe and prevents a transient response from clearing the catalog.
 */
async function retryTransientRead<T>(
  request: () => PromiseLike<SupabaseQueryResult<T>>,
): Promise<SupabaseQueryResult<T>> {
  const delays = [0, 250, 750]
  let result: SupabaseQueryResult<T> | null = null

  for (const delay of delays) {
    if (delay) await wait(delay)
    result = await request()
    if (!isJwtIssuedInFuture(result.error)) return result
  }

  return result!
}

function mapCategory(row: CategoryRow): Category {
  return {
    archivedAt: row.archived_at,
    id: row.id,
    isActive: row.is_active,
    name: row.name,
    sortOrder: row.sort_order,
  }
}

function mapProduct(
  row: ProductRow,
  categoryNames: Map<string, string>,
  storage: ObjectStorageGateway,
): Product {
  return {
    archivedAt: row.archived_at,
    categoryId: row.category_id,
    categoryName: categoryNames.get(row.category_id) ?? '',
    id: row.id,
    imageKey: row.image_key,
    imageUrl: storage.publicUrl(row.image_key),
    isAvailable: row.is_available,
    name: row.name,
    price: Number(row.price),
    sortOrder: row.sort_order,
  }
}

export class SupabaseCatalogRepository implements CatalogRepository {
  constructor(private readonly storage: ObjectStorageGateway) {}

  async listAdminCatalog(): Promise<Catalog> {
    const supabase = getSupabaseServerClient()
    const [categoriesResult, productsResult] = await Promise.all([
      retryTransientRead(() => supabase
        .from('categories')
        .select('id, name, sort_order, is_active, archived_at')
        .order('sort_order')
        .order('name')),
      retryTransientRead(() => supabase
        .from('products')
        .select('id, category_id, name, price, image_key, sort_order, is_available, archived_at')
        .order('sort_order')
        .order('name')),
    ])

    if (categoriesResult.error) throw categoriesResult.error
    if (productsResult.error) throw productsResult.error

    const categories = (categoriesResult.data as CategoryRow[]).map(mapCategory)
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]))
    const products = (productsResult.data as ProductRow[])
      .map((row) => mapProduct(row, categoryNames, this.storage))

    return { categories, products }
  }

  async listPosCatalog(): Promise<Catalog> {
    const catalog = await this.listAdminCatalog()
    const categories = catalog.categories.filter(
      (category) => category.isActive && !category.archivedAt,
    )
    const categoryIds = new Set(categories.map((category) => category.id))
    const products = catalog.products.filter(
      (product) => product.isAvailable && !product.archivedAt && categoryIds.has(product.categoryId),
    )
    return { categories, products }
  }

  async createCategory(input: CategoryInput) {
    const supabase = getSupabaseServerClient()
    const { data: last } = await supabase
      .from('categories')
      .select('sort_order')
      .is('archived_at', null)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { data, error } = await supabase
      .from('categories')
      .insert({
        is_active: input.isActive,
        name: input.name,
        sort_order: Number(last?.sort_order ?? -1) + 1,
      })
      .select('id, name, sort_order, is_active, archived_at')
      .single()
    if (error) throw error
    return mapCategory(data as CategoryRow)
  }

  async updateCategory(id: string, input: CategoryInput) {
    const supabase = getSupabaseServerClient()
    const { data, error } = await supabase
      .from('categories')
      .update({ is_active: input.isActive, name: input.name })
      .eq('id', id)
      .is('archived_at', null)
      .select('id, name, sort_order, is_active, archived_at')
      .single()
    if (error) throw error
    return mapCategory(data as CategoryRow)
  }

  async archiveCategory(id: string) {
    const { error } = await getSupabaseServerClient()
      .from('categories')
      .update({ archived_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .is('archived_at', null)
    if (error) throw error
  }

  async restoreCategory(id: string) {
    const { error } = await getSupabaseServerClient()
      .from('categories')
      .update({ archived_at: null })
      .eq('id', id)
      .not('archived_at', 'is', null)
    if (error) throw error
  }

  async deleteCategory(id: string) {
    const { error } = await getSupabaseServerClient()
      .from('categories')
      .delete()
      .eq('id', id)
      .not('archived_at', 'is', null)
    if (error) throw error
  }

  async reorderCategories(ids: string[]) {
    const { error } = await getSupabaseServerClient().rpc('reorder_categories', {
      ordered_ids: ids,
    })
    if (error) throw error
  }

  async getProduct(id: string) {
    const catalog = await this.listAdminCatalog()
    return catalog.products.find((product) => product.id === id) ?? null
  }

  async createProduct(input: ProductInput) {
    const supabase = getSupabaseServerClient()
    const { data: last } = await supabase
      .from('products')
      .select('sort_order')
      .eq('category_id', input.categoryId)
      .is('archived_at', null)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { error } = await supabase.from('products').insert({
      category_id: input.categoryId,
      id: input.id,
      image_key: input.imageKey,
      is_available: input.isAvailable,
      name: input.name,
      price: input.price,
      sort_order: Number(last?.sort_order ?? -1) + 1,
    })
    if (error) throw error
    const created = await this.getProduct(input.id)
    if (!created) throw new Error('Created product could not be loaded.')
    return created
  }

  async updateProduct(id: string, input: Omit<ProductInput, 'id'>) {
    const { error } = await getSupabaseServerClient()
      .from('products')
      .update({
        category_id: input.categoryId,
        image_key: input.imageKey,
        is_available: input.isAvailable,
        name: input.name,
        price: input.price,
      })
      .eq('id', id)
      .is('archived_at', null)
    if (error) throw error
    const updated = await this.getProduct(id)
    if (!updated) throw new Error('Updated product could not be loaded.')
    return updated
  }

  async archiveProduct(id: string) {
    const { error } = await getSupabaseServerClient()
      .from('products')
      .update({ archived_at: new Date().toISOString(), is_available: false })
      .eq('id', id)
      .is('archived_at', null)
    if (error) throw error
  }

  async restoreProduct(id: string) {
    const { error } = await getSupabaseServerClient()
      .from('products')
      .update({ archived_at: null })
      .eq('id', id)
      .not('archived_at', 'is', null)
    if (error) throw error
  }

  async deleteProduct(id: string) {
    const { error } = await getSupabaseServerClient()
      .from('products')
      .delete()
      .eq('id', id)
      .not('archived_at', 'is', null)
    if (error) throw error
  }

  async reorderProducts(categoryId: string, ids: string[]) {
    const { error } = await getSupabaseServerClient().rpc('reorder_products', {
      category: categoryId,
      ordered_ids: ids,
    })
    if (error) throw error
  }
}
