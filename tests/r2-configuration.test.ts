import { afterEach, describe, expect, it } from 'vitest'

import { createObjectStorageGateway } from '@/server/catalog/r2-storage'
import { isAbsoluteHttpUrl } from '@/server/catalog/validation'

const R2_KEYS = [
  'R2_ACCESS_KEY_ID',
  'R2_ACCOUNT_ID',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL',
  'R2_SECRET_ACCESS_KEY',
] as const

const originalEnv = Object.fromEntries(R2_KEYS.map((key) => [key, process.env[key]]))

function setR2Env(publicBaseUrl: string | undefined) {
  process.env.R2_ACCESS_KEY_ID = 'access-key'
  process.env.R2_ACCOUNT_ID = 'account'
  process.env.R2_BUCKET_NAME = 'makm'
  process.env.R2_SECRET_ACCESS_KEY = 'secret-key'
  if (publicBaseUrl === undefined) delete process.env.R2_PUBLIC_BASE_URL
  else process.env.R2_PUBLIC_BASE_URL = publicBaseUrl
}

afterEach(() => {
  for (const key of R2_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('isAbsoluteHttpUrl', () => {
  it('accepts absolute http and https URLs', () => {
    expect(isAbsoluteHttpUrl('https://cdn.example.com')).toBe(true)
    expect(isAbsoluteHttpUrl('http://localhost:3100')).toBe(true)
    expect(isAbsoluteHttpUrl('https://cdn.example.com/makm/')).toBe(true)
  })

  it('rejects values without a usable scheme', () => {
    expect(isAbsoluteHttpUrl('cdn.example.com')).toBe(false)
    expect(isAbsoluteHttpUrl('//cdn.example.com')).toBe(false)
    expect(isAbsoluteHttpUrl('cdn.example.com:443')).toBe(false)
    expect(isAbsoluteHttpUrl('')).toBe(false)
  })
})

describe('createObjectStorageGateway', () => {
  it('fails fast when the public base URL is missing its scheme', () => {
    setR2Env('cdn.example.com')
    expect(() => createObjectStorageGateway()).toThrowError(/R2_PUBLIC_BASE_URL must include the scheme/)
  })

  it('configures storage when every value is valid', () => {
    setR2Env('https://cdn.example.com')
    expect(createObjectStorageGateway().configured).toBe(true)
  })

  it('stays unconfigured, without throwing, when a value is missing', () => {
    setR2Env(undefined)
    expect(createObjectStorageGateway().configured).toBe(false)
  })
})
