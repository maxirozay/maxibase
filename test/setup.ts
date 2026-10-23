import { vi } from 'vitest'
import { emailSchema, otpSchema } from '#server-utils/schemas'

// The layer's server code runs on Nitro's auto-imports, which are plain globals
// at runtime. These stubs stand in for them so the units under test can be
// imported directly, without booting a Nuxt server or a database.

type AnyRecord = Record<string, any>

const defaultConfig = () => ({
  public: {
    url: 'https://app.test',
    name: 'Test app',
    files: { url: '/files', chunkSize: 5, maxSize: 10 },
  },
  filesPublicFolder: 'files/public',
  filesPrivateFolder: 'files/private',
  s3: { endpoint: '', accessKeyId: '' },
  rateLimit: { enabled: true, banMultiplier: 5, banSeconds: 3600 },
})

export let config: AnyRecord = defaultConfig()

export function setConfig(overrides: AnyRecord = {}) {
  config = { ...defaultConfig(), ...overrides }
  return config
}

export const storage = new Map<string, any>()

export const session: { user?: AnyRecord } = {}

export const logSpy = vi.fn(async () => {})

export function resetTestState() {
  config = defaultConfig()
  storage.clear()
  delete session.user
  logSpy.mockClear()
}

class HttpError extends Error {
  statusCode: number
  status: number
  statusMessage?: string
  constructor(input: AnyRecord) {
    super(input.message ?? 'Error')
    this.statusCode = input.status ?? input.statusCode ?? 500
    this.status = this.statusCode
    this.statusMessage = input.statusText ?? input.statusMessage
  }
}

Object.assign(globalThis, {
  // Real schemas, not stubs: handlers validate against them.
  emailSchema,
  otpSchema,
  useRuntimeConfig: () => config,
  createError: (input: AnyRecord) => new HttpError(input),
  defineEventHandler: (handler: any) => handler,
  getUserSession: async () => session,
  requireUserSession: async () => {
    if (!session.user) throw new HttpError({ status: 401, message: 'Not authenticated' })
    return session
  },
  getClientIP: (event: AnyRecord) => event?.ip ?? '203.0.113.1',
  log: logSpy,
  useStorage: (base: string) => ({
    getItem: async (key: string) => structuredClone(storage.get(`${base}:${key}`) ?? null),
    setItem: async (key: string, value: unknown) =>
      void storage.set(`${base}:${key}`, structuredClone(value)),
    removeItem: async (key: string) => void storage.delete(`${base}:${key}`),
  }),
  // Stand-in for scrypt: same shape (opaque string in, boolean out), no cost.
  hashPassword: async (value: string) => `hashed:${value}`,
  verifyPassword: async (hash: string, value: string) => hash === `hashed:${value}`,
  readValidatedBody: async (event: AnyRecord, parse: (body: unknown) => unknown) =>
    parse(event?.body),
  getRequestURL: (event: AnyRecord) => new URL(event?.path ?? '/', 'https://app.test'),
  setResponseHeader: vi.fn(),
  setHeader: vi.fn(),
  setResponseStatus: vi.fn(),
  getRequestHeader: vi.fn(),
  readFormData: vi.fn(async () => new FormData()),
  sendRedirect: vi.fn(),
})
