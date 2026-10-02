import { z } from 'zod'

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email())

export const passwordSchema = () => {
  const { min, max } = useRuntimeConfig().public.password
  return z.string().trim().min(min).max(max)
}
