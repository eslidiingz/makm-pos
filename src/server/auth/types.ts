export type AuthUser = {
  appMetadata: Record<string, unknown>
  id: string
  phone: string | null
}

export type AuthSession = {
  accessToken: string
  expiresIn: number
  refreshToken: string
}

export type AuthResult = {
  session: AuthSession
  user: AuthUser
}

export type OwnerDto = {
  id: string
  mustChangePassword: boolean
  phone: string
  role: 'platform_owner'
}

export interface AuthGateway {
  changePassword(phone: string, currentPassword: string, newPassword: string): Promise<AuthResult | null>
  getUser(accessToken: string): Promise<AuthUser | null>
  refresh(refreshToken: string): Promise<AuthResult | null>
  revoke(accessToken: string, refreshToken: string): Promise<void>
  signIn(phone: string, password: string): Promise<AuthResult | null>
}

export function isPlatformOwner(user: AuthUser): boolean {
  return user.appMetadata.role === 'platform_owner'
}

export function toOwnerDto(user: AuthUser): OwnerDto {
  return {
    id: user.id,
    mustChangePassword: user.appMetadata.must_change_password === true,
    phone: user.phone ?? '',
    role: 'platform_owner',
  }
}
