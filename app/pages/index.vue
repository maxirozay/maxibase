<script setup lang="ts">
const { shop, formatPrice } = await useShop()
const cart = useCartStore()

useHead({ title: () => shop.value?.name })
</script>

<template>
  <div
    v-if="shop"
    class="portrait px2"
  >
    <h1>{{ shop.name }}</h1>
    <div class="grid-fill g2">
      <div
        v-for="product in shop.products"
        :key="product.id"
        class="flex-column g1 p2 shadow border-radius"
      >
        <img
          v-if="product.image"
          :src="product.image"
          :alt="product.name"
          class="w"
        />
        <b>{{ product.name }}</b>
        <p
          v-if="product.description"
          class="m0"
        >
          {{ product.description }}
        </p>
        <div class="flex g2 mt">
          <span class="flex-1">{{ formatPrice(product.price) }}</span>
          <button
            class="primary"
            @click="cart.add({ productId: product.id, name: product.name, price: product.price })"
          >
            {{ $t('addToCart') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
