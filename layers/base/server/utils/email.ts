import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

let transporter: Transporter | null = null

function useTransporter() {
  const config = useRuntimeConfig()
  if (!transporter) {
    const port = Number(config.smtp.port)
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      pool: true,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    })
  }
  return transporter
}

export function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  locale: string = 'en',
  attachments?: any[],
  bcc?: string,
  params = {},
) {
  const config = useRuntimeConfig()
  const mail = await useTransporter().sendMail({
    from: config.smtp.from,
    to,
    bcc,
    subject: fillTemplate(subject, params, false),
    html: await buildEmail(html, locale, params),
    attachments,
  })
  return mail
}

async function getEmailAsset(key: string) {
  return ((await useStorage('assets:server').getItem(`emails/${key}`)) ??
    (await useStorage('assets:base').getItem(`emails/${key}`))) as string | null
}

export async function buildEmail(html: string, locale: string = 'en', params = {}) {
  const base = (await getEmailAsset('base.html')) as string
  const localeBase = await getEmailAsset(`${locale}/base.html`)
  return fillTemplate(
    inlineStyles(base.replace('{{content}}', localeBase?.replace('{{content}}', html) || html)),
    params,
  )
}

export async function sendEmailTemplate(
  templateId: string,
  locale: string = 'en',
  params: Record<string, any> = {},
  to: string,
  attachments?: any[],
  bcc?: string,
) {
  const { subject, html } = await buildEmailTemplate(templateId, locale)
  return sendEmail(to, subject, html, locale, attachments, bcc, params)
}

export async function buildEmailTemplate(templateId: string, locale: string = 'en') {
  const template =
    (await getEmailAsset(`${locale}/${templateId}.html`)) ??
    (await getEmailAsset(`en/${templateId}.html`))
  if (!template) {
    throw new Error(`Email template not found: ${locale}/${templateId}`)
  }
  const match = template.match(/<title>(.*?)<\/title>/i)
  const subject = match ? (match[1] as string) : '{{appName}}'
  return {
    subject,
    html: template,
  }
}

function getClasses(html: string) {
  const classes: Record<string, string> = {}
  const style = html
    .replaceAll(/\n/g, '')
    .replaceAll(/\s{2,}/g, ' ')
    .replace(/.*<style>/, '')
    .replace(/<\/style>.*/, '')
  style.split('}').forEach((rule) => {
    const [selectors, declarations] = rule.split('{')
    if (!selectors || !declarations) return
    classes[selectors.trim().replace(/^\./, '')] = declarations.trim()
  })
  return classes
}

function inlineStyles(html: string): string {
  const classes = getClasses(html)
  return html.replace(/class="(.*?)"/g, (_, className) => {
    const styles = className
      .split(' ')
      .map((name: string) => classes[name] || '')
      .join('; ')
    return `style="${styles}"`
  })
}

function appPlaceholders() {
  const config = useRuntimeConfig()
  return { appName: config.public.name, url: config.public.url, logo: config.public.logo }
}

// {{value}} is escaped, {{{value}}} is inserted as raw html. Reach for the raw
// form only for markup we build ourselves, never for a user-controlled value.
export function fillTemplate(html: string, params = {}, escape = true) {
  const context: Record<string, any> = { ...appPlaceholders(), ...params }
  return html.replace(/{{{(\w+)}}}|{{(\w+)}}/g, (match, rawKey?: string, key?: string) => {
    const name = rawKey ?? key
    if (!name) return match
    const value = context[name]
    if (value === undefined || value === null) return ''
    return escape && !rawKey ? escapeHtml(value) : String(value)
  })
}
