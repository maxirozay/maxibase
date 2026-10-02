<script setup lang="ts">
const emits = defineEmits(['authenticated', 'cancel'])
const appStore = useAppStore()
const { $t } = useI18n()
const { loggedIn, user, fetch: fetchUserSession } = useUserSession()
const config = useRuntimeConfig()
const route = useRoute()
const email = ref('')
const password = ref('')
const otpRequested = ref(false)
const totp = ref('')
const optionsFetched = ref(false)
const showPassword = ref(false)
const options = ref({
  hasOTP: true,
  hasPassword: false,
  hasTOTP: false,
  hasPasskey: false,
})
let isLoading = ref()

async function refreshSession() {
  await fetchUserSession()
  if (loggedIn.value) {
    appStore.authPromise?.resolve(true)
    emits('authenticated')
  }
  email.value = ''
}

async function requestOtp() {
  if (!email.value) return
  isLoading.value = true
  try {
    await $fetch('/api/auth/otp/get', {
      method: 'POST',
      body: {
        email: email.value,
        locale: useI18n().$getLocale(),
        goto: route.query.goto,
        path: route.path,
      },
    })
    otpRequested.value = true
  } catch (e: any) {
    handleError(e)
  } finally {
    isLoading.value = false
  }
}

async function signInWithOtp() {
  isLoading.value = true
  try {
    await $fetch('/api/auth/otp/verify', {
      method: 'POST',
      body: { email: email.value, otp: password.value },
    })
    await refreshSession()
  } catch (e: any) {
    handleError(e)
  } finally {
    otpRequested.value = false
    isLoading.value = false
  }
}

async function signInWithTOTP() {
  if (!email.value || !totp.value || !password.value) return
  isLoading.value = true
  try {
    const body: {
      email: string
      token: string
      otp?: string
      password?: string
    } = { email: email.value, token: totp.value }
    if (password.value.length === 6 || password.value === route.query.token) {
      body.otp = password.value
    } else body.password = password.value
    await $fetch('/api/auth/totp/verify', {
      method: 'POST',
      body,
    })
    await refreshSession()
    totp.value = ''
  } catch (e: any) {
    handleError(e)
  } finally {
    isLoading.value = false
  }
}

async function signInWithPassword() {
  if (!email.value || !password.value) return
  isLoading.value = true
  try {
    await $fetch('/api/auth/password', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    })
    await refreshSession()
    password.value = ''
  } catch (e: any) {
    handleError(e)
  } finally {
    isLoading.value = false
  }
}

function handleError(error: any) {
  appStore.notify(error.data?.message || 'Bad credentials', 'error')
}

function signIn() {
  if (!email.value) return
  if (options.value.hasTOTP && !totp.value) return
  setTimeout(() => {
    if (totp.value) signInWithTOTP()
    else if (!password.value) requestOtp()
    else if (password.value.length === 6) signInWithOtp()
    else signInWithPassword()
  }, 100) // wait for paste event to complete
}

const { authenticate } = useWebAuthn({
  registerEndpoint: '/api/auth/webauthn/register',
  authenticateEndpoint: '/api/auth/webauthn/authenticate',
})

async function signInWithPasskey() {
  try {
    await authenticate(email.value)
    await refreshSession()
  } catch (e: any) {
    if (!e.message.startsWith('The operation either timed out')) {
      handleError(e)
    }
  }
}

async function signInAnonymously() {
  isLoading.value = true
  try {
    await $fetch('/api/auth/anonymous', {
      method: 'POST',
    })
    await refreshSession()
  } catch (e: any) {
    handleError(e)
  } finally {
    isLoading.value = false
  }
}

async function getSignInOptions(email: string) {
  isLoading.value = true
  try {
    options.value = await $fetch<typeof options.value>('/api/auth/options', {
      method: 'POST',
      body: { email },
    })
    if (route.query.token) {
      password.value = route.query.token as string
      if (!options.value.hasTOTP) await signInWithOtp()
    } else if (options.value.hasPasskey) {
      await signInWithPasskey()
    } else if (!options.value.hasPassword) {
      await requestOtp()
    }
    optionsFetched.value = true
  } catch (e: any) {
    handleError(e)
  } finally {
    isLoading.value = false
  }
}

async function pastePassword() {
  try {
    password.value = await navigator.clipboard.readText()
    signIn()
  } catch (e) {
    appStore.notify($t('authCheck.clipboardPermission') as string, 'error')
  }
}

onMounted(async () => {
  email.value = user.value?.email || (route.query.email as string) || ''
  if (email.value) {
    await getSignInOptions(email.value)
  }
})
</script>

<template>
  <div
    class="modal"
    @click.self="emits('cancel')"
  >
    <div class="signin p3 mx">
      <slot name="header"></slot>
      <form
        v-if="optionsFetched"
        @submit.prevent="signIn"
      >
        <input
          v-show="false"
          type="email"
          :value="email"
          autocomplete="username email"
        />
        <label for="password">
          {{
            options.hasPassword && !otpRequested ? $t('authCheck.password') : $t('authCheck.code')
          }}
        </label>
        <div class="group flex-row">
          <input
            id="password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            :disabled="isLoading"
            autocomplete="current-password"
            :pattern="
              otpRequested
                ? '[0-9]{6}'
                : `.{${config.public.password.min},${config.public.password.max}}`
            "
            @paste="signIn"
          />
          <button
            type="button"
            class="flex-center fg"
            @click="showPassword = !showPassword"
          >
            <Icon :name="showPassword ? 'lucide:eye-off' : 'lucide:eye'" />
          </button>
          <button
            type="button"
            class="flex-center fg"
            :title="$t('paste')"
            @click="pastePassword"
          >
            <Icon name="lucide:clipboard-paste" />
          </button>
        </div>
        <div v-if="options.hasTOTP">
          <label for="totp">{{ $t('authCheck.authenticatorCode') }}</label>
          <input
            id="totp"
            v-model.trim="totp"
            type="text"
            :disabled="isLoading || !password"
            autocomplete="one-time-code"
            @paste="signInWithTOTP"
            @change="signInWithTOTP"
          />
        </div>
        <button
          type="submit"
          :disabled="isLoading || (!password && !otpRequested) || (options.hasTOTP && !totp)"
          :class="['w mt1', isLoading ? 'spin' : '']"
        >
          {{ $t('authCheck.signin') }}
        </button>
        <button
          v-if="!otpRequested"
          type="button"
          :disabled="isLoading"
          :class="['flex-1 w mt1 bg bg-border', isLoading ? 'spin' : '']"
          @click="requestOtp"
        >
          {{ $t('authCheck.getCode') }}
        </button>
        <p
          v-if="otpRequested"
          class="text-center"
        >
          {{ $t('authCheck.otpSent', { email }) }}
        </p>
      </form>
      <form
        v-else
        @submit.prevent="getSignInOptions(email)"
      >
        <label for="email">
          {{ $t('email') }}
          <input
            id="email"
            v-model.trim="email"
            type="email"
            required
            :disabled="isLoading"
            autocomplete="username"
          />
        </label>
        <button
          :class="['w', isLoading ? 'spin' : '']"
          :disabled="isLoading || !email.includes('@')"
        >
          {{ $t('continue') }}
        </button>
      </form>
      <slot
        v-if="!optionsFetched"
        name="footer"
      ></slot>
      <button
        v-if="!loggedIn && config.public.anonymousSignup && !optionsFetched"
        type="button"
        class="mt2 w"
        style="background: none; border: none; color: inherit"
        :disabled="isLoading"
        @click="signInAnonymously"
      >
        {{ $t('authCheck.continueAsGuest') }}
      </button>
      <button
        v-if="appStore.authPromise"
        type="button"
        class="mt2 w"
        style="background: none; border: none; color: inherit"
        :disabled="isLoading"
        @click="(appStore.authPromise.resolve(false), emits('cancel'))"
      >
        {{ $t('cancel') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.signin {
  max-width: min(400px, 80vw);
  min-width: 300px;
}
</style>
