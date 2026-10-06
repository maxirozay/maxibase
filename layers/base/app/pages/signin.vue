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
const appStore = useAppStore()
const { fetch: fetchUserSession } = useUserSession()
const isLoading = ref(false)

async function signInAnonymously() {
  isLoading.value = true
  try {
    await $fetch('/api/auth/anonymous', {
      method: 'POST',
    })
    await fetchUserSession()
    await navigateTo(safePath(route.query.goto), { replace: true })
  } catch (e: any) {
    appStore.notify(e.data?.message || e.message, 'error')
  } finally {
    isLoading.value = false
  }
}
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
        v-if="config.public.oauth.microsoft || config.public.anonymousSignup"
        class="flex-column"
      >
        <span class="text-center muted-text my1">{{ $t('or') }}</span>
        <a
          v-if="config.public.oauth.microsoft"
          href="/auth/microsoft"
          class="provider b flex-center g2 mb1"
        >
          <img
            src="/images/auth/microsoft.svg"
            alt=""
            width="21"
            height="21"
          />
          {{ $t('signinWith') }} Microsoft
        </a>
        <button
          v-if="config.public.anonymousSignup"
          type="button"
          :class="['w', isLoading ? 'spin' : '']"
          style="
            background: none;
            border: none;
            color: inherit;
            font-weight: normal;
            font-size: 14px;
          "
          :disabled="isLoading"
          @click="signInAnonymously"
        >
          {{ $t('continueAsGuest') }}
        </button>
      </div>
    </template>
  </AuthCheck>
</template>

<style scoped>
.page {
  box-shadow: inset 0 0 40vh var(--g-fg);
  height: 100dvh;
}

.provider {
  height: 40px;
  border-radius: var(--g-border-radius);
  font-size: 14px;
  color: inherit;
}
</style>
