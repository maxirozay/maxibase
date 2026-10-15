<script setup lang="ts">
type Product = {
  id?: string
  name: string
  description: string | null
  image: string | null
  price: number // in major units in the form, e.g. 25.50
  active: boolean
}

const appStore = useAppStore()
const { $t } = useI18n()

const products = ref<Product[]>([])
const error = ref('')

async function load() {
  try {
    const list = await $fetch('/api/shop/products')
    products.value = list.map((p) => ({ ...p, price: p.price / 100 }))
  } catch (e: any) {
    error.value = e.data?.message || e.message
  }
}
onMounted(load)

function addProduct() {
  products.value.unshift({ name: '', description: null, image: null, price: 0, active: true })
}

async function save(product: Product) {
  const body = {
    name: product.name,
    description: product.description || null,
    image: product.image || null,
    price: Math.round(product.price * 100),
    active: product.active,
  }
  try {
    const saved = product.id
      ? await $fetch(`/api/shop/products/${product.id}`, { method: 'PATCH', body })
      : await $fetch('/api/shop/products', { method: 'POST', body })
    Object.assign(product, { ...saved, price: saved!.price / 100 })
    appStore.notify('saved')
  } catch (e: any) {
    appStore.notify(e.data?.message || e.message, 'error')
  }
}

async function remove(product: Product) {
  if (!(await appStore.confirm(String($t('deleteProduct', { name: product.name }))))) return
  try {
    if (product.id) await $fetch(`/api/shop/products/${product.id}`, { method: 'DELETE' })
    products.value = products.value.filter((p) => p !== product)
    appStore.notify('deleted')
  } catch (e: any) {
    appStore.notify(e.data?.message || e.message, 'error')
  }
}
</script>

<template>
  <div class="portrait px2">
    <div class="flex g2 flex-center">
      <h1 class="flex-1">{{ $t('products') }}</h1>
      <button
        v-if="!error"
        class="primary"
        @click="addProduct"
      >
        {{ $t('add') }}
      </button>
    </div>
    <p
      v-if="error"
      class="danger-text"
    >
      {{ error }}
    </p>
    <form
      v-for="(product, i) in products"
      :key="product.id ?? `new-${i}`"
      class="flex-column g1 p2 mb2 shadow border-radius"
      @submit.prevent="save(product)"
    >
      <label :for="`name-${i}`">{{ $t('name') }}</label>
      <input
        :id="`name-${i}`"
        v-model="product.name"
        required
        maxlength="200"
      />
      <label :for="`price-${i}`">{{ $t('price') }}</label>
      <input
        :id="`price-${i}`"
        v-model.number="product.price"
        type="number"
        min="0.01"
        step="0.01"
        required
      />
      <label :for="`description-${i}`">{{ $t('productDescription') }}</label>
      <textarea
        :id="`description-${i}`"
        v-model="product.description"
        maxlength="2000"
      />
      <label :for="`image-${i}`">{{ $t('imageUrl') }}</label>
      <input
        :id="`image-${i}`"
        v-model="product.image"
        type="url"
      />
      <label class="flex-row g1">
        <input
          v-model="product.active"
          type="checkbox"
        />
        {{ $t('active') }}
      </label>
      <div class="flex g2 mt1">
        <button
          type="submit"
          class="primary"
        >
          {{ $t('save') }}
        </button>
        <button
          type="button"
          @click="remove(product)"
        >
          {{ $t('delete') }}
        </button>
      </div>
    </form>
  </div>
</template>
