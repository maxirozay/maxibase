// https://nuxt.com/docs/api/configuration/nuxt-config
const privateRoute = { ssr: false, headers: { 'X-Robots-Tag': 'noindex' } }

export default defineNuxtConfig({
  routeRules: {
    '/signin': { ssr: false },
    '/user/**': { ...privateRoute, appMiddleware: 'authenticated' },
    '/admin/**': { ...privateRoute, appMiddleware: 'admin' },
  },
  app: {
    head: {
      htmlAttrs: {
        lang: 'en',
      },
      title: process.env.NUXT_PUBLIC_NAME,
      link: [],
      meta: [{ name: 'theme-color', content: '#000000' }],
    },
  },
  runtimeConfig: {
    public: {
      url: 'http://localhost:3000',
      name: 'Nuxt base',
      logo: 'https://placehold.co/200x100?text=logo',
    },
    rateLimit: {
      routes: {
        // limit: max requests per IP, window: in seconds
        '/api/log': { limit: 30, window: 60 },
        '/api/auth/password': { limit: 5, window: 60 },
        '/api/auth/otp/get': { limit: 5, window: 900 },
        '/api/auth/email/get': { limit: 5, window: 900 },
        '/api/auth/email/verify': { limit: 10, window: 60 },
        '/api/auth/otp/verify': { limit: 10, window: 60 },
        '/api/auth/totp/verify': { limit: 10, window: 60 },
        '/api/auth/webauthn/authenticate': { limit: 10, window: 60 },
        '/api/auth/anonymous': { limit: 5, window: 3600 },
      },
    },
  },
  i18n: {
    locales: [
      { code: 'en', iso: 'en-US' },
      { code: 'fr', iso: 'fr-FR' },
    ],
    defaultLocale: 'en',
    translationDir: 'locales',
  },
  css: ['~/assets/css/index.css'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  srcDir: 'app/',
  extends: ['./layers/base'],
})
