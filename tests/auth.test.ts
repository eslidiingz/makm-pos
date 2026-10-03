import { beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '@/server/app'
import {
  AUTH_COOKIE_NAMES,
  SESSION_MAX_AGE_SECONDS,
  sessionRemainingSeconds,
  signSessionStart,
  verifySessionStart,
} from '@/server/auth/session'
import type {
  AuthGateway,
  AuthResult,
  AuthSession,
  AuthUser,
} from '@/server/auth/types'
import { resolveOwnerAuthEmail } from '@/server/auth/owner-identity'
import { normalizeThaiPhone, validatePassword } from '@/server/auth/validation'
import type {
  Catalog,
  CatalogRepository,
  CategoryInput,
  ObjectStorageGateway,
  ProductInput,
} from '@/server/catalog/types'
import { isPendingImageKey } from '@/server/catalog/validation'
import {
  OrderCatalogChangedError,
  type CreatePaidOrderInput,
  type SalesReport,
  type OrderRepository,
  type PaidOrder,
  type TopSellingProduct,
} from '@/server/orders/types'
import {
  bangkokDayRange,
  bangkokSalesPeriodRange,
  isSalesPeriod,
  isValidOrderItems,
  isValidReportDate,
} from '@/server/orders/validation'

const ORIGIN = 'http://localhost'
const TEMP_PASSWORD = 'temporary-password'
const NEW_PASSWORD = 'new-secure-password'
const CATEGORY_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const ORDER_ID = '44444444-4444-4444-8444-444444444444'
const REQUEST_ID = '55555555-5555-4555-8555-555555555555'

const session = (suffix = 'one'): AuthSession => ({
  accessToken: `access-${suffix}`,
  expiresIn: 3600,
  refreshToken: `refresh-${suffix}`,
})

const owner = (mustChangePassword = true): AuthUser => ({
  appMetadata: {
    must_change_password: mustChangePassword,
    role: 'platform_owner',
  },
  id: 'owner-id',
  phone: '+66812345678',
})

class FakeAuthGateway implements AuthGateway {
  refreshCalls = 0
  revoked: Array<{ accessToken: string; refreshToken: string }> = []
  shouldAuthenticate = true
  shouldReturnOwner = true
  validAccessToken = 'access-one'
  currentOwner = owner()

  async signIn(_phone: string, password: string): Promise<AuthResult | null> {
    if (!this.shouldAuthenticate || password !== TEMP_PASSWORD) return null
    return {
      session: session(),
      user: this.shouldReturnOwner
        ? this.currentOwner
        : { ...this.currentOwner, appMetadata: { role: 'staff' } },
    }
  }

  async getUser(accessToken: string) {
    return accessToken === this.validAccessToken ? this.currentOwner : null
  }

  async refresh(refreshToken: string): Promise<AuthResult | null> {
    this.refreshCalls += 1
    if (refreshToken !== 'refresh-one') return null
    this.validAccessToken = 'access-refreshed'
    return { session: session('refreshed'), user: this.currentOwner }
  }

  async changePassword(
    _phone: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthResult | null> {
    if (currentPassword !== TEMP_PASSWORD || newPassword !== NEW_PASSWORD) return null
    this.currentOwner = owner(false)
    this.validAccessToken = 'access-changed'
    return { session: session('changed'), user: this.currentOwner }
  }

  async revoke(accessToken: string, refreshToken: string) {
    this.revoked.push({ accessToken, refreshToken })
    this.validAccessToken = ''
  }
}

class FakeCatalogRepository implements CatalogRepository {
  catalog: Catalog = { categories: [], products: [] }

  async listAdminCatalog() { return structuredClone(this.catalog) }
  async listPosCatalog() {
    const categories = this.catalog.categories.filter((item) => item.isActive && !item.archivedAt)
    const categoryIds = new Set(categories.map((item) => item.id))
    return {
      categories,
      products: this.catalog.products.filter(
        (item) => item.isAvailable && !item.archivedAt && categoryIds.has(item.categoryId),
      ),
    }
  }
  async createCategory(input: CategoryInput) {
    const category = { archivedAt: null, id: CATEGORY_ID, sortOrder: this.catalog.categories.length, ...input }
    this.catalog.categories.push(category)
    return category
  }
  async updateCategory(id: string, input: CategoryInput) {
    const category = this.catalog.categories.find((item) => item.id === id)
    if (!category) throw new Error('not found')
    Object.assign(category, input)
    return category
  }
  async archiveCategory(id: string) {
    const category = this.catalog.categories.find((item) => item.id === id)
    if (category) { category.archivedAt = new Date().toISOString(); category.isActive = false }
  }
  async restoreCategory(id: string) {
    const category = this.catalog.categories.find((item) => item.id === id)
    if (category) category.archivedAt = null
  }
  async deleteCategory(id: string) {
    if (this.catalog.products.some((item) => item.categoryId === id)) {
      throw Object.assign(new Error('foreign key violation'), { code: '23503' })
    }
    this.catalog.categories = this.catalog.categories.filter((item) => item.id !== id)
  }
  async reorderCategories(ids: string[]) {
    this.catalog.categories.forEach((item) => { item.sortOrder = ids.indexOf(item.id) })
  }
  async getProduct(id: string) {
    return this.catalog.products.find((item) => item.id === id) ?? null
  }
  async createProduct(input: ProductInput) {
    const category = this.catalog.categories.find((item) => item.id === input.categoryId)!
    const product = {
      archivedAt: null,
      categoryName: category.name,
      imageUrl: input.imageKey ? `https://media.example/${input.imageKey}` : null,
      sortOrder: this.catalog.products.length,
      ...input,
    }
    this.catalog.products.push(product)
    return product
  }
  async updateProduct(id: string, input: Omit<ProductInput, 'id'>) {
    const product = this.catalog.products.find((item) => item.id === id)
    if (!product) throw new Error('not found')
    const category = this.catalog.categories.find((item) => item.id === input.categoryId)!
    Object.assign(product, input, { categoryName: category.name })
    return product
  }
  async archiveProduct(id: string) {
    const product = this.catalog.products.find((item) => item.id === id)
    if (product) { product.archivedAt = new Date().toISOString(); product.isAvailable = false }
  }
  async restoreProduct(id: string) {
    const product = this.catalog.products.find((item) => item.id === id)
    if (product) product.archivedAt = null
  }
  async deleteProduct(id: string) {
    this.catalog.products = this.catalog.products.filter((item) => item.id !== id)
  }
  async reorderProducts(_categoryId: string, ids: string[]) {
    this.catalog.products.forEach((item) => { item.sortOrder = ids.indexOf(item.id) })
  }
}

class FakeObjectStorage implements ObjectStorageGateway {
  readonly configured = true
  finalized: string[] = []
  deleted: string[] = []

  async presignWebpUpload() {
    return {
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      pendingKey: 'catalog/pending/33333333-3333-4333-8333-333333333333.webp',
      uploadUrl: 'https://upload.example/presigned',
    }
  }
  async finalize(pendingKey: string, productId: string) {
    this.finalized.push(pendingKey)
    return `catalog/products/${productId}/44444444-4444-4444-8444-444444444444.webp`
  }
  async delete(key: string) { this.deleted.push(key) }
  publicUrl(key: string | null) { return key ? `https://media.example/${key}` : null }
}

class FakeOrderRepository implements OrderRepository {
  readonly orders = new Map<string, PaidOrder>()
  rejectCatalog = false
  reportRequests: Array<{ endAt: string; page: number; pageSize: number; startAt: string }> = []
  topProductRequests: Array<{ endAt: string; limit: number; startAt: string }> = []
  topProducts: TopSellingProduct[] = [{
    categoryName: 'เนื้อสัตว์',
    isArchived: false,
    productId: PRODUCT_ID,
    productName: 'สามชั้น',
    quantity: 12,
    rank: 1,
    totalSales: 120,
  }]

  async createPaidOrder(input: CreatePaidOrderInput) {
    if (this.rejectCatalog) throw new OrderCatalogChangedError()
    const existing = this.orders.get(input.requestId)
    if (existing) return existing

    const total = input.items.reduce(
      (sum, item) => sum + item.expectedUnitPrice * item.quantity,
      0,
    )
    const order: PaidOrder = {
      discount: 0,
      id: ORDER_ID,
      itemCount: input.items.reduce((sum, item) => sum + item.quantity, 0),
      orderNumber: '1',
      paymentMethod: null,
      soldAt: '2026-08-24T10:30:00.000Z',
      status: 'paid',
      subtotal: total,
      total,
    }
    this.orders.set(input.requestId, order)
    return order
  }

  async listSales(startAt: string, endAt: string, page: number, pageSize: number): Promise<SalesReport> {
    this.reportRequests.push({ endAt, page, pageSize, startAt })
    return {
      date: null,
      orders: [],
      pagination: { page, pageSize, totalItems: 0, totalPages: 1 },
      range: { endAt, startAt },
      summary: { itemCount: 0, orderCount: 0, totalSales: 0 },
      period: null,
      timezone: 'Asia/Bangkok',
    }
  }

  async listTopSellingProducts(startAt: string, endAt: string, limit: number) {
    this.topProductRequests.push({ endAt, limit, startAt })
    return this.topProducts
  }
}

function getSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  return headers.getSetCookie?.() ?? []
}

function cookieHeader(response: Response) {
  return getSetCookies(response)
    .map((value) => value.split(';', 1)[0])
    .join('; ')
}

function request(
  app: ReturnType<typeof createApp>,
  path: string,
  options: { body?: unknown; cookie?: string; method?: string } = {},
) {
  const headers = new Headers()
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.cookie) headers.set('Cookie', options.cookie)
  if (options.method && options.method !== 'GET') headers.set('Origin', ORIGIN)

  return app.fetch(new Request(`${ORIGIN}${path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method ?? 'GET',
  }))
}

async function login(app: ReturnType<typeof createApp>, password = TEMP_PASSWORD) {
  return request(app, '/api/auth/login', {
    body: { password, phone: '0812345678' },
    method: 'POST',
  })
}

beforeEach(() => {
  process.env.AUTH_COOKIE_SECRET = 'test-secret-with-at-least-32-characters'
  delete process.env.APP_ORIGIN
  delete process.env.DEV_ALLOWED_ORIGINS
})

describe('auth validation', () => {
  it('normalizes supported Thai mobile formats', () => {
    expect(normalizeThaiPhone('0812345678')).toBe('+66812345678')
    expect(normalizeThaiPhone('+66812345678')).toBe('+66812345678')
    expect(normalizeThaiPhone('081-234-5678')).toBe('+66812345678')
    expect(normalizeThaiPhone('021112949')).toBeNull()
  })

  it('enforces an 8-128 character password', () => {
    expect(validatePassword('1234567')).toBe(false)
    expect(validatePassword('12345678')).toBe(true)
    expect(validatePassword('x'.repeat(129))).toBe(false)
  })

  it('maps only the configured owner phone to the server-only auth email', () => {
    const configuration = {
      authEmail: 'Owner.Auth@example.invalid',
      phone: '0812345678',
    }

    expect(resolveOwnerAuthEmail('0812345678', configuration)).toBe(
      'owner.auth@example.invalid',
    )
    expect(resolveOwnerAuthEmail('+66812345678', configuration)).toBe(
      'owner.auth@example.invalid',
    )
    expect(resolveOwnerAuthEmail('66812345678', configuration)).toBe(
      'owner.auth@example.invalid',
    )
    expect(resolveOwnerAuthEmail('0899999999', configuration)).toBeNull()
  })

  it('signs the start time and enforces an absolute 24-hour expiry', () => {
    const startedAt = Date.now()
    const signed = signSessionStart(startedAt)
    expect(verifySessionStart(signed)).toBe(startedAt)
    expect(verifySessionStart(`${signed}tampered`)).toBeNull()
    expect(sessionRemainingSeconds(startedAt, startedAt)).toBe(SESSION_MAX_AGE_SECONDS)
    expect(sessionRemainingSeconds(startedAt, startedAt + 24 * 60 * 60 * 1000)).toBe(0)
  })

  it('validates report dates and unique order items', () => {
    expect(isValidReportDate('2026-08-24')).toBe(true)
    expect(isValidReportDate('2026-02-30')).toBe(false)
    expect(isValidReportDate('24/08/2026')).toBe(false)
    expect(bangkokDayRange('2026-08-24')).toEqual({
      end: '2026-08-24T17:00:00.000Z',
      start: '2026-08-23T17:00:00.000Z',
    })
    expect(isValidOrderItems([{
      expectedUnitPrice: 10,
      productId: PRODUCT_ID,
      quantity: 2,
    }])).toBe(true)
    expect(isValidOrderItems([
      { expectedUnitPrice: 10, productId: PRODUCT_ID, quantity: 1 },
      { expectedUnitPrice: 10, productId: PRODUCT_ID, quantity: 1 },
    ])).toBe(false)
  })

  it('builds inclusive Bangkok sales periods', () => {
    const now = Date.parse('2026-08-25T15:30:00+07:00')
    expect(isSalesPeriod('today')).toBe(true)
    expect(isSalesPeriod('this_week')).toBe(true)
    expect(isSalesPeriod('this_month')).toBe(true)
    expect(isSalesPeriod('all')).toBe(false)
    expect(bangkokSalesPeriodRange('today', now)).toEqual({
      end: '2026-08-25T17:00:00.000Z',
      start: '2026-08-24T17:00:00.000Z',
    })
    expect(bangkokSalesPeriodRange('this_week', now)).toEqual({
      end: '2026-08-25T17:00:00.000Z',
      start: '2026-08-23T17:00:00.000Z',
    })
    expect(bangkokSalesPeriodRange('this_month', now)).toEqual({
      end: '2026-08-25T17:00:00.000Z',
      start: '2026-07-31T17:00:00.000Z',
    })
  })
})

describe('Platform Owner API', () => {
  it('returns one generic 401 and creates no cookies for invalid login', async () => {
    const gateway = new FakeAuthGateway()
    const app = createApp({ auth: gateway })
    const response = await login(app, 'wrong-password')

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'เบอร์มือถือหรือรหัสผ่านไม่ถูกต้อง',
    })
    expect(getSetCookies(response)).toHaveLength(0)
  })

  it('rejects a non-owner account, revokes its session, and clears cookies', async () => {
    const gateway = new FakeAuthGateway()
    gateway.shouldReturnOwner = false
    const app = createApp({ auth: gateway })
    const response = await login(app)

    expect(response.status).toBe(401)
    expect(gateway.revoked).toEqual([
      { accessToken: 'access-one', refreshToken: 'refresh-one' },
    ])
    expect(getSetCookies(response).join('\n')).toContain(`${AUTH_COOKIE_NAMES.access}=`)
    expect(getSetCookies(response).join('\n')).toContain('Max-Age=0')
  })

  it('sets HttpOnly strict cookies and forces password change before POS APIs', async () => {
    const gateway = new FakeAuthGateway()
    const app = createApp({ auth: gateway })
    const response = await login(app)
    const setCookies = getSetCookies(response)

    expect(response.status).toBe(200)
    expect(await response.clone().json()).not.toHaveProperty('accessToken')
    expect(setCookies).toHaveLength(3)
    for (const value of setCookies) {
      expect(value).toContain('HttpOnly')
      expect(value).toContain('SameSite=Strict')
      expect(value).toContain('Path=/')
    }

    const products = await request(app, '/api/products', {
      cookie: cookieHeader(response),
    })
    expect(products.status).toBe(403)
    expect(await products.json()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' })
  })

  it('allows dashboard/POS APIs after changing the temporary password', async () => {
    const gateway = new FakeAuthGateway()
    const app = createApp({ auth: gateway, catalog: new FakeCatalogRepository() })
    const loginResponse = await login(app)
    const changed = await request(app, '/api/auth/change-password', {
      body: {
        currentPassword: TEMP_PASSWORD,
        newPassword: NEW_PASSWORD,
      },
      cookie: cookieHeader(loginResponse),
      method: 'POST',
    })

    expect(changed.status).toBe(200)
    expect(await changed.clone().json()).toMatchObject({
      user: { mustChangePassword: false, role: 'platform_owner' },
    })

    const products = await request(app, '/api/products', {
      cookie: cookieHeader(changed),
    })
    expect(products.status).toBe(200)
  })

  it('refreshes an expired access token without extending the 24-hour session', async () => {
    const gateway = new FakeAuthGateway()
    const startedAt = 1_800_000_000_000
    let now = startedAt
    const app = createApp({ auth: gateway, now: () => now })
    const loginResponse = await login(app)
    gateway.validAccessToken = ''
    now += 23 * 60 * 60 * 1000

    const me = await request(app, '/api/auth/me', {
      cookie: cookieHeader(loginResponse),
    })
    expect(me.status).toBe(200)
    expect(gateway.refreshCalls).toBe(1)
    expect(getSetCookies(me).join('\n')).toContain('Max-Age=3600')

    now = startedAt + 24 * 60 * 60 * 1000 + 1
    const expired = await request(app, '/api/auth/me', {
      cookie: cookieHeader(me),
    })
    expect(expired.status).toBe(401)
    expect(gateway.refreshCalls).toBe(1)
  })

  it('refreshes an expired access token before an authenticated catalog mutation', async () => {
    const gateway = new FakeAuthGateway()
    gateway.currentOwner = owner(false)
    const app = createApp({ auth: gateway, catalog: new FakeCatalogRepository() })
    const loginResponse = await login(app)
    gateway.validAccessToken = ''

    const created = await request(app, '/api/admin/categories', {
      body: { isActive: true, name: 'เนื้อสัตว์' },
      cookie: cookieHeader(loginResponse),
      method: 'POST',
    })

    expect(created.status).toBe(200)
    expect(gateway.refreshCalls).toBe(1)
  })

  it('shares one rotated session across concurrent session checks', async () => {
    const gateway = new FakeAuthGateway()
    gateway.currentOwner = owner(false)
    const app = createApp({ auth: gateway })
    const loginResponse = await login(app)
    const cookie = cookieHeader(loginResponse)
    gateway.validAccessToken = ''

    const [first, second] = await Promise.all([
      request(app, '/api/auth/me', { cookie }),
      request(app, '/api/auth/me', { cookie }),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(gateway.refreshCalls).toBe(1)
    expect(cookieHeader(first)).toBe(cookieHeader(second))
  })

  it('revokes the session and removes every cookie on logout', async () => {
    const gateway = new FakeAuthGateway()
    gateway.currentOwner = owner(false)
    const app = createApp({ auth: gateway })
    const loginResponse = await login(app)
    const response = await request(app, '/api/auth/logout', {
      cookie: cookieHeader(loginResponse),
      method: 'POST',
    })

    expect(response.status).toBe(200)
    expect(gateway.revoked).toHaveLength(1)
    const setCookies = getSetCookies(response)
    expect(setCookies).toHaveLength(3)
    expect(setCookies.every((value) => value.includes('Max-Age=0'))).toBe(true)

    const me = await request(app, '/api/auth/me', {
      cookie: cookieHeader(response),
    })
    expect(me.status).toBe(401)
  })

  it('rejects mutation requests from another origin', async () => {
    const gateway = new FakeAuthGateway()
    const app = createApp({ auth: gateway })
    const response = await app.fetch(new Request(`${ORIGIN}/api/auth/login`, {
      body: JSON.stringify({ password: TEMP_PASSWORD, phone: '0812345678' }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
      },
      method: 'POST',
    }))

    expect(response.status).toBe(403)
    expect(gateway.revoked).toHaveLength(0)
  })

  it('allows an explicitly configured development origin for local device testing', async () => {
    process.env.DEV_ALLOWED_ORIGINS = 'http://192.168.1.41:3100'
    const gateway = new FakeAuthGateway()
    const app = createApp({ auth: gateway })
    const response = await app.fetch(new Request(`${ORIGIN}/api/auth/login`, {
      body: JSON.stringify({ password: TEMP_PASSWORD, phone: '0812345678' }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://192.168.1.41:3100',
      },
      method: 'POST',
    }))

    expect(response.status).toBe(200)
  })

  it('allows development requests from the same LAN origin even when APP_ORIGIN stays on localhost', async () => {
    process.env.APP_ORIGIN = 'http://localhost:3100'
    const gateway = new FakeAuthGateway()
    const app = createApp({ auth: gateway })
    const response = await app.fetch(new Request('http://192.168.1.41:3100/api/auth/login', {
      body: JSON.stringify({ password: TEMP_PASSWORD, phone: '0812345678' }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://192.168.1.41:3100',
      },
      method: 'POST',
    }))

    expect(response.status).toBe(200)
  })
})

describe('Owner catalog API', () => {
  async function readyApp() {
    const auth = new FakeAuthGateway()
    auth.currentOwner = owner(false)
    const catalog = new FakeCatalogRepository()
    const storage = new FakeObjectStorage()
    const app = createApp({ auth, catalog, storage })
    const loginResponse = await login(app)
    return { app, catalog, cookie: cookieHeader(loginResponse), storage }
  }

  it('creates categories and products and serves only the active POS catalog', async () => {
    const { app, catalog, cookie } = await readyApp()
    const category = await request(app, '/api/admin/categories', {
      body: { isActive: true, name: ' เนื้อสัตว์  ' },
      cookie,
      method: 'POST',
    })
    expect(category.status).toBe(200)
    expect(await category.json()).toMatchObject({ name: 'เนื้อสัตว์' })

    const product = await request(app, '/api/admin/products', {
      body: { categoryId: CATEGORY_ID, isAvailable: true, name: 'สามชั้น', price: 15 },
      cookie,
      method: 'POST',
    })
    expect(product.status).toBe(200)
    expect(catalog.catalog.products).toHaveLength(1)

    const pos = await request(app, '/api/catalog', { cookie })
    expect(pos.status).toBe(200)
    expect(await pos.json()).toMatchObject({
      categories: [{ name: 'เนื้อสัตว์' }],
      products: [{ name: 'สามชั้น', price: 15 }],
    })
  })

  it('rejects invalid catalog input and cross-origin admin mutations', async () => {
    const { app, cookie } = await readyApp()
    const invalid = await request(app, '/api/admin/categories', {
      body: { isActive: true, name: '   ' },
      cookie,
      method: 'POST',
    })
    expect(invalid.status).toBe(400)

    const crossOrigin = await app.fetch(new Request(`${ORIGIN}/api/admin/categories`, {
      body: JSON.stringify({ isActive: true, name: 'ผัก' }),
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://attacker.example' },
      method: 'POST',
    }))
    expect(crossOrigin.status).toBe(403)
  })

  it('issues a short-lived WebP upload and finalizes only a validated pending key', async () => {
    const { app, cookie, storage } = await readyApp()
    await request(app, '/api/admin/categories', {
      body: { isActive: true, name: 'ผัก' }, cookie, method: 'POST',
    })
    const presign = await request(app, '/api/admin/product-images/presign', {
      body: { contentType: 'image/webp', size: 1024 }, cookie, method: 'POST',
    })
    expect(presign.status).toBe(200)
    const upload = await presign.json() as { pendingKey: string }
    expect(isPendingImageKey(upload.pendingKey)).toBe(true)

    const product = await request(app, '/api/admin/products', {
      body: {
        categoryId: CATEGORY_ID,
        isAvailable: true,
        name: 'กระเจี๊ยบ',
        pendingImageKey: upload.pendingKey,
        price: 10,
      },
      cookie,
      method: 'POST',
    })
    expect(product.status).toBe(200)
    expect(storage.finalized).toEqual([upload.pendingKey])

    const badKey = await request(app, '/api/admin/products', {
      body: {
        categoryId: CATEGORY_ID,
        isAvailable: true,
        name: 'เห็ด',
        pendingImageKey: '../../secret.webp',
        price: 10,
      },
      cookie,
      method: 'POST',
    })
    expect(badKey.status).toBe(400)
  })

  it('hides archived products from POS while keeping them in admin catalog', async () => {
    const { app, catalog, cookie } = await readyApp()
    await request(app, '/api/admin/categories', {
      body: { isActive: true, name: 'ของทานเล่น' }, cookie, method: 'POST',
    })
    await catalog.createProduct({
      categoryId: CATEGORY_ID,
      id: PRODUCT_ID,
      imageKey: null,
      isAvailable: true,
      name: 'เต้าหู้ปลา',
      price: 12,
    })
    await request(app, `/api/admin/products/${PRODUCT_ID}/archive`, { cookie, method: 'POST' })

    const pos = await request(app, '/api/catalog', { cookie })
    expect((await pos.json() as Catalog).products).toHaveLength(0)
    const admin = await request(app, '/api/admin/catalog', { cookie })
    expect((await admin.json() as Catalog).products[0].archivedAt).not.toBeNull()
  })
})

describe('Owner sales API', () => {
  async function readySalesApp() {
    const auth = new FakeAuthGateway()
    auth.currentOwner = owner(false)
    const orders = new FakeOrderRepository()
    const app = createApp({
      auth,
      now: () => Date.parse('2026-08-25T15:30:00+07:00'),
      orders,
    })
    const loginResponse = await login(app)
    return { app, cookie: cookieHeader(loginResponse), orders }
  }

  it('creates a paid order with a 201 response and is idempotent', async () => {
    const { app, cookie, orders } = await readySalesApp()
    const body = {
      items: [{ expectedUnitPrice: 10, productId: PRODUCT_ID, quantity: 3 }],
      requestId: REQUEST_ID,
    }

    const first = await request(app, '/api/orders', { body, cookie, method: 'POST' })
    const second = await request(app, '/api/orders', { body, cookie, method: 'POST' })

    expect(first.status).toBe(201)
    expect(first.headers.get('location')).toBe(`/api/orders/${ORDER_ID}`)
    expect(await first.json()).toMatchObject({
      order: { itemCount: 3, orderNumber: '1', paymentMethod: null, total: 30 },
    })
    expect(second.status).toBe(201)
    expect(orders.orders).toHaveLength(1)
  })

  it('rejects duplicate product IDs and catalog changes without creating an order', async () => {
    const { app, cookie, orders } = await readySalesApp()
    const duplicate = await request(app, '/api/orders', {
      body: {
        items: [
          { expectedUnitPrice: 10, productId: PRODUCT_ID, quantity: 1 },
          { expectedUnitPrice: 10, productId: PRODUCT_ID, quantity: 2 },
        ],
        requestId: REQUEST_ID,
      },
      cookie,
      method: 'POST',
    })
    expect(duplicate.status).toBe(400)

    orders.rejectCatalog = true
    const changed = await request(app, '/api/orders', {
      body: {
        items: [{ expectedUnitPrice: 10, productId: PRODUCT_ID, quantity: 1 }],
        requestId: REQUEST_ID,
      },
      cookie,
      method: 'POST',
    })
    expect(changed.status).toBe(409)
    expect(await changed.json()).toMatchObject({ code: 'ORDER_CATALOG_CHANGED' })
    expect(orders.orders).toHaveLength(0)
  })

  it('returns a paginated Bangkok report and validates both period and date filters', async () => {
    const { app, cookie, orders } = await readySalesApp()
    const report = await request(
      app,
      '/api/admin/sales/daily?period=this_week&page=2&pageSize=25',
      { cookie },
    )
    expect(report.status).toBe(200)
    expect(await report.json()).toMatchObject({
      date: null,
      pagination: { page: 2, pageSize: 25 },
      period: 'this_week',
      range: {
        endAt: '2026-08-25T17:00:00.000Z',
        startAt: '2026-08-23T17:00:00.000Z',
      },
      timezone: 'Asia/Bangkok',
    })
    expect(orders.reportRequests).toEqual([{
      endAt: '2026-08-25T17:00:00.000Z',
      page: 2,
      pageSize: 25,
      startAt: '2026-08-23T17:00:00.000Z',
    }])

    const customDate = await request(
      app,
      '/api/admin/sales/daily?date=2026-08-24',
      { cookie },
    )
    expect(customDate.status).toBe(200)
    expect(await customDate.json()).toMatchObject({ date: '2026-08-24', period: null })
    expect(orders.reportRequests.at(-1)).toMatchObject({
      endAt: '2026-08-24T17:00:00.000Z',
      startAt: '2026-08-23T17:00:00.000Z',
    })

    const invalid = await request(
      app,
      '/api/admin/sales/daily?date=2026-02-30',
      { cookie },
    )
    expect(invalid.status).toBe(400)
  })

  it('returns Top 10 products for a validated Bangkok period', async () => {
    const { app, cookie, orders } = await readySalesApp()
    const response = await request(
      app,
      '/api/admin/sales/top-products?period=this_week',
      { cookie },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      items: [{ productName: 'สามชั้น', quantity: 12, rank: 1, totalSales: 120 }],
      period: 'this_week',
      range: {
        endAt: '2026-08-25T17:00:00.000Z',
        startAt: '2026-08-23T17:00:00.000Z',
      },
      timezone: 'Asia/Bangkok',
    })
    expect(orders.topProductRequests).toEqual([{
      endAt: '2026-08-25T17:00:00.000Z',
      limit: 10,
      startAt: '2026-08-23T17:00:00.000Z',
    }])

    const invalid = await request(
      app,
      '/api/admin/sales/top-products?period=all',
      { cookie },
    )
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_SALES_PERIOD' })
  })
})
