type CartItem = { productId: string; name: string; price: number; quantity: number }

export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>([])
  const total = computed(() => items.value.reduce((sum, i) => sum + i.price * i.quantity, 0))
  const count = computed(() => items.value.reduce((sum, i) => sum + i.quantity, 0))

  // kept in the browser only, localStorage is per domain so each shop has its own cart
  if (import.meta.client) {
    try {
      items.value = JSON.parse(localStorage.getItem('cart') || '[]')
    } catch {}
    watch(items, (value) => localStorage.setItem('cart', JSON.stringify(value)), { deep: true })
  }

  function add(product: Omit<CartItem, 'quantity'>) {
    const item = items.value.find((i) => i.productId === product.productId)
    if (item) item.quantity++
    else items.value.push({ ...product, quantity: 1 })
  }

  function setQuantity(productId: string, quantity: number) {
    if (quantity < 1) items.value = items.value.filter((i) => i.productId !== productId)
    else {
      const item = items.value.find((i) => i.productId === productId)
      if (item) item.quantity = Math.min(quantity, 99)
    }
  }

  function clear() {
    items.value = []
  }

  return { items, total, count, add, setQuantity, clear }
})
