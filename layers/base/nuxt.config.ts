// https://nuxt.com/docs/api/configuration/nuxt-config
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const authTypes = { path: fileURLToPath(new URL('./shared/types/auth.d.ts', import.meta.url)) }

export default defineNuxtConfig({
  routeRules: {
    '/images/auth/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
  },
  runtimeConfig: {
    public: {
      anonymousSignup: false,
      password: {
        min: 16,
        max: 64,
      },
      refreshToken: {
        rotateAfter: 60 * 60 * 24, // 1 day
      },
      recentAuth: {
        maxAge: 300, // 5 minutes
      },
      oauth: {
        microsoft: false,
      },
      files: {
        url: '/files',
        chunkSize: 5, // in MB
      },
    },
    session: {
      maxAge: 3600, // 1 hour
      password: '',
      unique: false,
    },
    oauth: {
      microsoft: {
        clientId: '',
        clientSecret: '',
        tenant: 'common',
      },
    },
    refreshToken: {
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
    autoSignup: false,
    forceMfa: false,
    db: '',
    smtp: {
      host: '',
      port: 465,
      user: '',
      pass: '',
      from: '',
    },
    filesPublicFolder: 'files/public',
    filesPrivateFolder: 'files/private',
    s3: {
      redirect: true,
      endpoint: '',
      region: 'us-east-1',
      publicBucket: '',
      privateBucket: '',
      accessKeyId: '',
      secretAccessKey: '',
    },
    backup: {
      dumpArgs: '-F c',
      retentionDays: 30,
      agePublicKey: '', // age public key to encrypt backups
    },
    logs: {
      retentionDays: 90,
    },
    rateLimit: {
      enabled: true,
      banMultiplier: 5, // banned after limit × multiplier requests in one window
      banSeconds: 3600,
      // Number of reverse proxies in front of the app. Set to 0 when directly exposed, else
      // clients can spoof x-forwarded-for and bypass every limit below.
      trustedProxies: 1,
    },
  },
  nitro: {
    experimental: {
      tasks: true,
    },
    scheduledTasks: {
      '0 3 * * *': 'backup',
      '0 2 1 * *': 'clean',
    },
    storage: {
      auth: {
        driver: 'memory',
      },
    },
    serverAssets: [
      { baseName: 'base', dir: fileURLToPath(new URL('../../server/assets', import.meta.url)) },
    ],
  },
  i18n: {
    locales: [{ code: 'en' }, { code: 'fr' }],
    defaultLocale: 'en',
    translationDir: 'locales',
    localeCookie: 'user-locale',
  },
  auth: {
    webAuthn: true,
  },
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: [
    '@nuxt/hints',
    '@nuxt/icon',
    'nuxt-auth-utils',
    '@pinia/nuxt',
    'nuxt-i18n-micro',
    (_, nuxt) => {
      // #database/{name} is the project's server/database/{name}.ts, else the layer's default
      for (const name of ['db', 'relations', 'access']) {
        const own = `${nuxt.options.serverDir}/database/${name}`
        nuxt.options.alias[`#database/${name}`] = existsSync(`${own}.ts`)
          ? own
          : fileURLToPath(new URL(`./server/database/defaults/${name}`, import.meta.url))
      }
    },
  ],
  pinia: {
    storesDirs: ['stores'],
  },
  vite: {
    optimizeDeps: {
      include: ['qrcode'],
    },
  },
  hooks: {
    'prepare:types': ({ references, sharedReferences }) => {
      references.push(authTypes)
      sharedReferences.push(authTypes)
    },
    'nitro:prepare:types': ({ references }) => {
      references.push(authTypes)
    },
  },
})
