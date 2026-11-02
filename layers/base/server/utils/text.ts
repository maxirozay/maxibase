export function prepareStringForSearch(text?: string) {
  if (!text) return
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`
}
