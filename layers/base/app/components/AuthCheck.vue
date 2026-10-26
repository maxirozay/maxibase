<script setup lang="ts">
import { WebAuthnAbortService } from '@simplewebauthn/browser'

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
const recoveryCode = ref('')
const useRecoveryCode = ref(false)
const optionsFetched = ref(false)
const showPassword = ref(false)
const options = ref({
  hasOTP: true,
  hasPassword: false,
  hasTOTP: false,
  hasPasskey: false,
  hasRecoveryCodes: false,
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

function firstFactor(): { otp: string } | { password: string } {
  if (password.value.length === 6 || password.value === route.query.token) {
    return { otp: password.value }
  }
  return { password: password.value }
}

async function signInWithTOTP() {
  if (!email.value || !totp.value || !password.value) return
  isLoading.value = true
  try {
    await $fetch('/api/auth/totp/verify', {
      method: 'POST',
      body: { email: email.value, token: totp.value, ...firstFactor() },
    })
    await refreshSession()
    totp.value = ''
  } catch (e: any) {
    handleError(e)
  } finally {
    isLoading.value = false
  }
}

async function signInWithRecoveryCode() {
  if (!email.value || !recoveryCode.value || !password.value) return
  isLoading.value = true
  try {
    await $fetch('/api/auth/recovery/verify', {
      method: 'POST',
      body: {
        email: email.value,
        code: recoveryCode.value,
        locale: useI18n().$getLocale(),
        ...firstFactor(),
      },
    })
    await refreshSession()
    recoveryCode.value = ''
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

const signInForm = useTemplateRef<HTMLFormElement>('signInForm')
let signInTimer: ReturnType<typeof setTimeout> | undefined

watch(totp, (value) => {
  const digits = value.replace(/\s/g, '')
  if (digits !== value) totp.value = digits
})

// Paste, change and submit can fire together: wait for the pasted value, then sign in once
function signIn() {
  clearTimeout(signInTimer)
  signInTimer = setTimeout(() => {
    if (!email.value || isLoading.value) return
    // paste and change bypass the browser's check, which only guards the submit
    if (!signInForm.value?.reportValidity()) return
    if (useRecoveryCode.value) signInWithRecoveryCode()
    else if (totp.value) signInWithTOTP()
    else if (password.value.length === 6) signInWithOtp()
    else signInWithPassword()
  }, 100)
}

const webAuthnEndpoints = {
  registerEndpoint: '/api/auth/webauthn/register',
  authenticateEndpoint: '/api/auth/webauthn/authenticate',
}
const { authenticate } = useWebAuthn(webAuthnEndpoints)
const { authenticate: authenticateWithAutofill, isAutofillSupported } = useWebAuthn({
  ...webAuthnEndpoints,
  useBrowserAutofill: true,
})

async function signInWithPasskey(userName?: string, autofill = false) {
  try {
    await (autofill ? authenticateWithAutofill() : authenticate(userName))
    await refreshSession()
  } catch (e: any) {
    // any other passkey prompt aborts the pending autofill request
    if (e.name !== 'AbortError' && !e.message.startsWith('The operation either timed out')) {
      handleError(e)
    }
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
      await signInWithPasskey(email)
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

const pasteFields = { password, totp, recoveryCode }

async function pasteTo(field: keyof typeof pasteFields) {
  try {
    pasteFields[field].value = (await navigator.clipboard.readText()).trim()
    signIn()
  } catch (e) {
    appStore.notify($t('authCheck.clipboardPermission') as string, 'error')
  }
}

onMounted(async () => {
  email.value = user.value?.email || (route.query.email as string) || ''
  if (email.value) {
    await getSignInOptions(email.value)
  } else if (await isAutofillSupported()) {
    signInWithPasskey(undefined, true)
  }
})

onBeforeUnmount(() => WebAuthnAbortService.cancelCeremony())
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
        ref="signInForm"
        class="flex-column g2"
        @submit.prevent="signIn"
      >
        <input
          v-show="false"
          type="email"
          :value="email"
          autocomplete="username email"
        />
        <div>
          <label for="password">
            {{
              options.hasPassword && !otpRequested ? $t('authCheck.password') : $t('authCheck.code')
            }}
          </label>
          <div class="group flex-row">
            <input
              id="password"
              v-model.trim="password"
              :type="showPassword ? 'text' : 'password'"
              :disabled="isLoading"
              autocomplete="current-password"
              :pattern="
                otpRequested
                  ? '[0-9]{6}'
                  : `[0-9]{6}|.{${config.public.password.min},${config.public.password.max}}`
              "
              required
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
              :title="$t('paste') as string"
              @click="pasteTo('password')"
            >
              <Icon name="lucide:clipboard-paste" />
            </button>
          </div>
        </div>
        <div v-if="useRecoveryCode">
          <label for="recovery-code">{{ $t('authCheck.recoveryCode') }}</label>
          <div class="group flex-row">
            <input
              id="recovery-code"
              v-model.trim="recoveryCode"
              type="text"
              :disabled="isLoading || !password"
              autocomplete="off"
              autocapitalize="none"
              pattern="[0-9a-fA-F]{5}-?[0-9a-fA-F]{5}"
              required
              @paste="signIn"
            />
            <button
              type="button"
              class="flex-center fg"
              :title="$t('paste') as string"
              :disabled="isLoading || !password"
              @click="pasteTo('recoveryCode')"
            >
              <Icon name="lucide:clipboard-paste" />
            </button>
          </div>
        </div>
        <div v-else-if="options.hasTOTP">
          <label for="totp">{{ $t('authCheck.authenticatorCode') }}</label>
          <div class="group flex-row">
            <input
              id="totp"
              v-model.trim="totp"
              type="text"
              :disabled="isLoading || !password"
              autocomplete="one-time-code"
              inputmode="numeric"
              pattern="[0-9]{6}"
              required
              @paste="signIn"
              @change="signIn"
            />
            <button
              type="button"
              class="flex-center fg"
              :title="$t('paste') as string"
              :disabled="isLoading || !password"
              @click="pasteTo('totp')"
            >
              <Icon name="lucide:clipboard-paste" />
            </button>
          </div>
        </div>
        <button
          type="submit"
          :disabled="
            isLoading ||
            (!password && !otpRequested) ||
            (useRecoveryCode ? !recoveryCode : options.hasTOTP && !totp)
          "
          :class="['w mt1', isLoading ? 'spin' : '']"
        >
          {{ $t('authCheck.signin') }}
        </button>
        <button
          v-if="options.hasPasskey"
          type="button"
          :disabled="isLoading"
          class="flex-center g2 w mt1 bg bg-border"
          @click="signInWithPasskey(email)"
        >
          <Icon name="lucide:key-round" />
          {{ $t('authCheck.passkey') }}
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
        <button
          v-if="options.hasRecoveryCodes"
          type="button"
          class="w"
          style="background: none; border: none; color: inherit"
          :disabled="isLoading"
          @click="useRecoveryCode = !useRecoveryCode"
        >
          {{ useRecoveryCode ? $t('cancel') : $t('authCheck.useRecoveryCode') }}
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
        class="flex-column g2"
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
            autocomplete="username webauthn"
          />
        </label>
        <button
          :class="['w', isLoading ? 'spin' : '']"
          :disabled="isLoading || !email.includes('@')"
        >
          {{ $t('continue') }}
        </button>
      </form>
      <div
        v-if="!optionsFetched"
        class="flex-column"
      >
        <span class="text-center muted-text my1">{{ $t('or') }}</span>
        <button
          type="button"
          class="provider flex-center g2 w mb1 fg b"
          style="font-weight: normal"
          @click="signInWithPasskey()"
        >
          <Icon name="lucide:key-round" />
          {{ $t('authCheck.passkey') }}
        </button>
        <slot name="footer"></slot>
      </div>
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
  box-sizing: border-box;
  width: min(400px, 100vw - (var(--g-padding-l) + var(--g-padding-r)) * var(--g-padding-ratio2));
}

.provider,
:slotted(.provider) {
  height: 40px;
  border-radius: var(--g-border-radius);
  font-size: 14px;
  color: inherit;
}

.provider > :is(img, .iconify),
:slotted(.provider) > :is(img, .iconify) {
  width: 20px;
  height: 20px;
}
</style>
