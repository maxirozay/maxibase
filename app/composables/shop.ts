// the shop of the current domain, shared by the pages through the 'shop' key
export async function useShop() {
  const { $getLocale } = useI18n()
  const { data: shop } = await useFetch('/api/shop', { key: 'shop' })

  function formatPrice(amount: number) {
    return new Intl.NumberFormat($getLocale(), {
      style: 'currency',
      currency: shop.value!.currency,
    }).format(amount / 100)
  }

  return { shop, formatPrice }
}
