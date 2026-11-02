import { definePlugin } from 'nitro'
import { useRuntimeConfig } from 'nuxt/server'

export function parseEnvValues(config: Record<string, any>) {
  for (const [key, value] of Object.entries(config)) {
    if (value === 'true' || value === 'false') config[key] = value === 'true'
    else if (typeof value === 'string' && value && String(Number(value)) === value) {
      config[key] = Number(value)
    } else if (value && typeof value === 'object' && !Array.isArray(value)) parseEnvValues(value)
  }
  return config
}

export default definePlugin(() => {
  parseEnvValues(useRuntimeConfig())
})
