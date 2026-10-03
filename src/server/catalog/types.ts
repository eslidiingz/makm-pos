export type Category = {
  archivedAt: string | null
  id: string
  isActive: boolean
  name: string
  sortOrder: number
}

export type Product = {
  archivedAt: string | null
  categoryId: string
  categoryName: string
  id: string
  imageKey: string | null
  imageUrl: string | null
  isAvailable: boolean
  name: string
  price: number
  sortOrder: number
}

export type Catalog = {
  categories: Category[]
  products: Product[]
}

export type CategoryInput = {
  isActive: boolean
  name: string
}

export type ProductInput = {
  categoryId: string
  id: string
  imageKey: string | null
  isAvailable: boolean
  name: string
  price: number
}

export interface CatalogRepository {
  archiveCategory(id: string): Promise<void>
  archiveProduct(id: string): Promise<void>
  createCategory(input: CategoryInput): Promise<Category>
  createProduct(input: ProductInput): Promise<Product>
  deleteCategory(id: string): Promise<void>
  deleteProduct(id: string): Promise<void>
  getProduct(id: string): Promise<Product | null>
  listAdminCatalog(): Promise<Catalog>
  listPosCatalog(): Promise<Catalog>
  reorderCategories(ids: string[]): Promise<void>
  reorderProducts(categoryId: string, ids: string[]): Promise<void>
  restoreCategory(id: string): Promise<void>
  restoreProduct(id: string): Promise<void>
  updateCategory(id: string, input: CategoryInput): Promise<Category>
  updateProduct(id: string, input: Omit<ProductInput, 'id'>): Promise<Product>
}

export type PresignedUpload = {
  expiresAt: string
  pendingKey: string
  uploadUrl: string
}

export interface ObjectStorageGateway {
  readonly configured: boolean
  delete(key: string): Promise<void>
  finalize(pendingKey: string, productId: string): Promise<string>
  presignWebpUpload(): Promise<PresignedUpload>
  publicUrl(key: string | null): string | null
}
