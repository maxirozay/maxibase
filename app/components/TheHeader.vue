<script setup lang="ts">
const { loggedIn, user, clear: clearSession } = useUserSession()

const config = useRuntimeConfig()

async function signout() {
  await clearSession()
  await navigateTo('/signin')
}

watch(
  () => useRoute().path,
  () => {
    const navToggle = document.getElementById('nav-toggle') as HTMLInputElement
    if (navToggle) {
      navToggle.checked = false
    }
  },
)
</script>

<template>
  <nav class="p2 g2 fg">
    <I18nLink
      :to="{ name: 'index' }"
      style="color: inherit"
    >
      <img
        v-if="config.public.logo"
        :src="config.public.logo"
        :alt="config.public.name"
        height="42"
        style="display: block"
      />
      <span v-else>{{ config.public.name }}</span>
    </I18nLink>
    <input
      id="nav-toggle"
      type="checkbox"
      aria-label="Toggle menu"
    />
    <div class="content ml">
      <template v-if="loggedIn">
        <I18nLink :to="{ name: 'user-auth' }">{{ $t('settings') }}</I18nLink>
        <I18nLink
          v-if="user?.role === 'admin'"
          :to="{ name: 'admin-logs' }"
        >
          Logs
        </I18nLink>
        <button @click="signout">
          {{ $t('signout') }}
        </button>
      </template>
    </div>
    <label
      class="toggle ml"
      for="nav-toggle"
      aria-label="menu"
    >
      <span />
      <span />
      <span />
    </label>
  </nav>
</template>
