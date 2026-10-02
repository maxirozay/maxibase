<script setup lang="ts">
const { $t } = useI18n()
useSeoMeta({
  title: $t('authCheck.signin') as string,
  ogTitle: $t('authCheck.signin') as string,
  description: $t('authCheck.signin') as string,
  ogDescription: $t('authCheck.signin') as string,
})

definePageMeta({
  layout: 'simple',
  middleware: [
    (to) => {
      const { user } = useUserSession()

      if (user.value?.email) {
        return navigateTo(safePath(to.query.goto), { replace: true })
      }
    },
  ],
})
const config = useRuntimeConfig()
const route = useRoute()
</script>

<template>
  <div class="page" />
  <div
    class="absolute top w p2 flex-row flex-center"
    style="z-index: 99999"
  >
    <I18nLink
      :to="{ name: 'index' }"
      style="color: var(--g-bg-contrast)"
    >
      <img
        v-if="config.public.logo"
        :src="config.public.logo"
        :alt="config.public.name"
        height="42"
        class="fg"
      />
      <span v-else>{{ config.public.name }}</span>
    </I18nLink>
    <LocaleSwitcher class="ml" />
  </div>
  <AuthCheck @authenticated="navigateTo(safePath(route.query.goto), { replace: true })">
    <template #header>
      <h1 class="text-center">{{ $t('authCheck.signin') }}</h1>
    </template>
    <template #footer>
      <div
        v-if="config.public.oauth.microsoft"
        class="flex-column mt2"
      >
        <a
          href="/auth/microsoft"
          class="flex-center p-input text-center bg"
        >
          <b>Continue with Microsoft</b>
        </a>
      </div>
    </template>
  </AuthCheck>
</template>

<style scoped>
.page {
  box-shadow: inset 0 0 40vh var(--g-fg);
  height: 100dvh;
}
</style>
