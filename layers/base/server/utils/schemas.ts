import { z } from 'zod'

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email())

// The emailed 6-digit code, or the magic-link token (32 bytes in base64url, 43 characters)
export const otpSchema = z.string().length(6).or(z.string().min(32).max(64))

export const passwordSchema = () => {
  const { min, max } = useRuntimeConfig().public.password
  return z.string().trim().min(min).max(max)
}
