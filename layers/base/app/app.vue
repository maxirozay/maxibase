<script setup lang="ts">
const config = useRuntimeConfig()
const { $t } = useI18n()
useSeoMeta({
  title: config.public.name,
  ogTitle: config.public.name,
  description: $t('description') as string,
  ogDescription: $t('description') as string,
})

const appStore = useAppStore()
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <LazyTheConfirmation />
  <LazyTheLoading />
  <LazyTheNotifications />
  <LazyAuthCheck v-if="appStore.authPromise" />
</template>
