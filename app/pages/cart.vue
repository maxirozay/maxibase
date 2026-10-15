<script setup lang="ts">
const { shop, formatPrice } = await useShop()
const cart = useCartStore()
const appStore = useAppStore()
const route = useRoute()

// Stripe sends the buyer back here with ?order=paid
onMounted(() => {
  if (route.query.order !== 'paid') return
  cart.clear()
  appStore.notify('orderPaid')
  navigateTo({ query: {} }, { replace: true })
})

const isCheckingOut = ref(false)
async function checkout() {
  isCheckingOut.value = true
  try {
    const { url } = await $fetch('/api/shop/checkout', {
      method: 'POST',
      body: { items: cart.items.map(({ productId, quantity }) => ({ productId, quantity })) },
    })
    if (url) window.location.href = url
  } catch (error: any) {
    appStore.notify(error.data?.message || error.message, 'error')
    isCheckingOut.value = false
  }
}
</script>

<template>
  <div
    v-if="shop"
    class="portrait px2"
  >
    <h1>{{ $t('cart') }}</h1>
    <ClientOnly>
      <p v-if="!cart.items.length">
        {{ $t('cartEmpty') }}
        <I18nLink :to="{ name: 'index' }">{{ $t('continueShopping') }}</I18nLink>
      </p>
      <template v-else>
        <div
          v-for="item in cart.items"
          :key="item.productId"
          class="flex g2 mb1"
        >
          <span class="flex-1">{{ item.name }}</span>
          <input
            type="number"
            min="0"
            max="99"
            :value="item.quantity"
            :aria-label="$t('quantity')"
            style="width: 5em"
            @change="cart.setQuantity(item.productId, +($event.target as HTMLInputElement).value)"
          />
          <span>{{ formatPrice(item.price * item.quantity) }}</span>
        </div>
        <div class="flex g2 mt2">
          <b class="flex-1">{{ $t('total') }}: {{ formatPrice(cart.total) }}</b>
          <button
            class="primary"
            :disabled="isCheckingOut"
            @click="checkout"
          >
            {{ $t('checkout') }}
          </button>
        </div>
      </template>
    </ClientOnly>
  </div>
</template>
