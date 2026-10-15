<script setup lang="ts">
const { loggedIn, user, clear: clearSession } = useUserSession()

const config = useRuntimeConfig()
const cart = useCartStore()

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
  <nav class="p2 g2">
    <I18nLink
      :to="{ name: 'index' }"
      style="color: inherit"
    >
      <img
        v-if="config.public.logo"
        :src="config.public.logo"
        :alt="config.public.name"
        height="42"
        class="fg"
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
      <I18nLink
        :to="{ name: 'cart' }"
        class="flex-row g1 flex-center"
        :aria-label="$t('cart')"
      >
        <Icon
          name="lucide:shopping-cart"
          size="24"
        />
        <ClientOnly>
          <span v-if="cart.count">{{ cart.count }}</span>
        </ClientOnly>
      </I18nLink>
      <div
        v-if="loggedIn"
        class="dropdown -desktop right icon"
      >
        <span>
          <Icon
            name="lucide:user"
            size="24"
          />
        </span>
        <div class="p2 g2">
          <I18nLink :to="{ name: 'user-auth' }">{{ $t('authentication') }}</I18nLink>
          <I18nLink :to="{ name: 'manage-products' }">{{ $t('products') }}</I18nLink>
          <I18nLink
            v-if="user?.role === 'admin'"
            :to="{ name: 'admin-logs' }"
          >
            Logs
          </I18nLink>
          <button @click="signout">
            {{ $t('signout') }}
          </button>
        </div>
      </div>
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
