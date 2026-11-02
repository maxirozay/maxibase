// Stands in for nuxt/server, nitro, nitro/kv and nitro/task, which need a Nitro build: each export
// forwards to the global of the same name, so a test swaps one with vi.stubGlobal
const global = globalThis as any

export const createError = (...args: any[]) => global.createError(...args)
export const defineEventHandler = (...args: any[]) => global.defineEventHandler(...args)
export const deleteCookie = (...args: any[]) => global.deleteCookie(...args)
export const getCookie = (...args: any[]) => global.getCookie(...args)
export const getQuery = (...args: any[]) => global.getQuery(...args)
export const getRequestHeader = (...args: any[]) => global.getRequestHeader(...args)
export const getRequestIP = (...args: any[]) => global.getRequestIP(...args)
export const getRouterParam = (...args: any[]) => global.getRouterParam(...args)
export const getValidatedQuery = (...args: any[]) => global.getValidatedQuery(...args)
export const readValidatedBody = (...args: any[]) => global.readValidatedBody(...args)
export const sendRedirect = (...args: any[]) => global.sendRedirect(...args)
export const setCookie = (...args: any[]) => global.setCookie(...args)
export const setResponseStatus = (...args: any[]) => global.setResponseStatus(...args)
export const useRuntimeConfig = (...args: any[]) => global.useRuntimeConfig(...args)
export const useKV = (...args: any[]) => global.useKV(...args)
export const definePlugin = (...args: any[]) => global.definePlugin(...args)
export const defineTask = (...args: any[]) => global.defineTask(...args)
