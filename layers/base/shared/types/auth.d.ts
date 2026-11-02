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

declare module 'nuxt/server' {
  interface SessionConfig {
    unique?: boolean // a new sign-in revokes the other sessions
  }
}

export {}
