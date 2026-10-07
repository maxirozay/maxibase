<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const isClientError = props.error.status && props.error.status >= 400 && props.error.status < 500

if (import.meta.client && !isClientError) {
  $fetch('/api/log', {
    method: 'POST',
    body: {
      summary: props.error.message,
      data: props.error,
      origin: useRoute().fullPath,
      type: 'error',
    },
  }).catch(() => {})
}
</script>

<template>
  <NuxtLayout name="default">
    <div class="text-center flex-center flex-column m3 g3">
      <h1 class="mt0">{{ error.message }}</h1>
      <NuxtLink to="/">Go back home</NuxtLink>
    </div>
  </NuxtLayout>
</template>
