import { createClient } from '@supabase/supabase-js'

const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name} in .env.local.`)
  return value
}

const normalizeThaiPhone = (input) => {
  const compact = input.trim().replace(/[\s()-]/g, '')
  const local = compact.match(/^0([689]\d{8})$/)
  if (local) return `+66${local[1]}`
  const e164 = compact.match(/^\+66([689]\d{8})$/)
  if (e164) return `+66${e164[1]}`
  throw new Error('PLATFORM_OWNER_PHONE must be a valid Thai mobile number.')
}

const url = required('NEXT_PUBLIC_SUPABASE_URL')
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY')
const phone = normalizeThaiPhone(required('PLATFORM_OWNER_PHONE'))
const authEmail = required('PLATFORM_OWNER_AUTH_EMAIL').trim().toLowerCase()
const password = required('PLATFORM_OWNER_TEMP_PASSWORD')

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) {
  throw new Error('PLATFORM_OWNER_AUTH_EMAIL must be a valid internal email address.')
}

if (password.length < 16 || password.length > 128) {
  throw new Error('PLATFORM_OWNER_TEMP_PASSWORD must contain 16-128 characters.')
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let page = 1
let ownerExists = false
while (true) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) throw error
  ownerExists = data.users.some((user) => user.phone?.replace(/^\+/, '') === phone.replace(/^\+/, ''))
  if (ownerExists || data.users.length < 1000) break
  page += 1
}

if (ownerExists) {
  console.log('Platform Owner already exists. No password or metadata was changed.')
  process.exit(0)
}

const { data, error } = await supabase.auth.admin.createUser({
  app_metadata: { must_change_password: true, role: 'platform_owner' },
  email: authEmail,
  email_confirm: true,
  password,
  phone,
  phone_confirm: true,
})

if (error) throw error
console.log(`Platform Owner created: ${data.user.phone}`)
console.log('Delete PLATFORM_OWNER_TEMP_PASSWORD from .env.local now.')
