declare module '#auth-utils' {
  interface User {
    id: string
    email?: string
    role: 'admin' | 'user'
    isAnonymous?: boolean
    requiresMfaSetup?: boolean
  }

  interface UserSession {
    expiresAt?: number
    authenticatedAt: number
  }
}

declare module 'h3' {
  interface SessionConfig {
    unique?: boolean
  }
}

export {}
