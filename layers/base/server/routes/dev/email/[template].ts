export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({
      status: 404,
      message: 'Not found',
    })
  }

  const templateId = getRouterParam(event, 'template') || ''
  const query = getQuery(event)
  const locale = (query.locale as string) || 'en'

  const template = (await buildEmailTemplate(templateId, locale)).html
  return buildEmail(template, locale, query)
})
