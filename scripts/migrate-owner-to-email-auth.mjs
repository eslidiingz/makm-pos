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
  const e164 = compact.match(/^\+?66([689]\d{8})$/)
  if (e164) return `+66${e164[1]}`
  throw new Error('PLATFORM_OWNER_PHONE must be a valid Thai mobile number.')
}

const url = required('NEXT_PUBLIC_SUPABASE_URL')
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY')
const phone = normalizeThaiPhone(required('PLATFORM_OWNER_PHONE'))
const authEmail = required('PLATFORM_OWNER_AUTH_EMAIL').trim().toLowerCase()

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) {
  throw new Error('PLATFORM_OWNER_AUTH_EMAIL must be a valid internal email address.')
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const users = []
let page = 1
while (true) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) throw error
  users.push(...data.users)
  if (data.users.length < 1000) break
  page += 1
}

const owners = users.filter((user) => {
  if (!user.phone) return false
  try {
    return normalizeThaiPhone(user.phone) === phone
  } catch {
    return false
  }
})

if (owners.length !== 1) {
  throw new Error(`Expected exactly one Platform Owner account; found ${owners.length}.`)
}

const owner = owners[0]
if (owner.app_metadata?.role !== 'platform_owner') {
  throw new Error('The matching account does not have the platform_owner role.')
}

const emailOwner = users.find(
  (user) => user.email?.toLowerCase() === authEmail && user.id !== owner.id,
)
if (emailOwner) {
  throw new Error('PLATFORM_OWNER_AUTH_EMAIL is already assigned to another account.')
}

if (owner.email?.toLowerCase() === authEmail && owner.email_confirmed_at) {
  console.log('Platform Owner internal email identity is already ready. No changes were made.')
  process.exit(0)
}

const { error } = await supabase.auth.admin.updateUserById(owner.id, {
  email: authEmail,
  email_confirm: true,
})
if (error) throw error

console.log('Platform Owner internal email identity is ready. Password and role were not changed.')
