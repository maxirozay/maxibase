<script setup lang="ts">
import QRCode from 'qrcode'

definePageMeta({
  middleware: ['authenticated'],
})

const appStore = useAppStore()
const { user, fetch: fetchUserSession } = useUserSession()
const passwordPolicy = useRuntimeConfig().public.password
type AuthInfo = {
  credentials: { id: string; name: string }[]
  hasPassword: boolean
  hasTOTP: boolean
  forceMfa: boolean
}

const auth = ref<AuthInfo>({
  credentials: [],
  hasPassword: false,
  hasTOTP: false,
  forceMfa: false,
})
const TOTPSecret = ref('')
const TOTPCode = ref('')
const password1 = ref('')
const password2 = ref('')
const showPasswordChange = ref(false)
const showPassword1 = ref(false)
const showPassword2 = ref(false)
const showTOTP = ref(false)
const newEmail = ref('')
const emailCode = ref('')
const emailCodeSent = ref(false)
const { clear: clearSession } = useUserSession()
const { $getLocale, $t } = useI18n()

const isMfaSetup = computed(() => user.value?.requiresMfaSetup === true)

async function checkAuth() {
  return isMfaSetup.value || (await appStore.checkAuth())
}

const isCurrentEmail = computed(() => {
  const value = newEmail.value.toLowerCase()
  return !value || value === user.value?.email?.toLowerCase()
})

const isPasswordValid = computed(() => {
  return password1.value.length >= passwordPolicy.min
})

const canRemovePasskey = computed(
  () => !auth.value?.forceMfa || auth.value.hasTOTP || auth.value.credentials.length > 1,
)
const canDisableTOTP = computed(() => !auth.value?.forceMfa || auth.value.credentials.length > 0)

async function getAuth() {
  try {
    auth.value = await $fetch<AuthInfo>('/api/auth')
  } catch (e: any) {
    appStore.notify(e?.data?.message || e?.message, 'error')
  }
}

const { register } = useWebAuthn({
  registerEndpoint: '/api/auth/webauthn/register',
})

async function registerPasskey() {
  try {
    if (!(await checkAuth())) return
    await register({ userName: user.value!.email! })
    await getAuth()
    appStore.notify('saved', 'success')
    if (isMfaSetup.value) {
      await fetchUserSession()
      if (!user.value?.requiresMfaSetup) await navigateTo('/', { replace: true })
    }
  } catch (e: any) {
    appStore.notify(e?.data?.message || e?.message, 'error')
  }
}

async function setPasskeyName(name: string, credentialId: string) {
  try {
    if (!(await checkAuth())) return
    await $fetch('/api/auth/webauthn', {
      method: 'POST',
      body: { name, credentialId },
    })
    appStore.notify('saved', 'success')
  } catch (e: any) {
    appStore.notify(e?.data?.message || e?.message, 'error')
  }
}

async function deletePasskey(credentialId: string) {
  try {
    if (!(await checkAuth())) return
    await $fetch('/api/auth/webauthn', {
      method: 'DELETE',
      body: { credentialId },
    })
    await getAuth()
    appStore.notify('deleted', 'success')
  } catch (e: any) {
    appStore.notify(e?.data?.message || e?.message, 'error')
  }
}

async function requestEmailChange() {
  try {
    await $fetch('/api/auth/email/get', {
      method: 'POST',
      body: { email: newEmail.value, locale: $getLocale() },
    })
    emailCodeSent.value = true
  } catch (e: any) {
    appStore.notify(e?.data?.message || e?.message, 'error')
  }
}

async function confirmEmailChange() {
  if (emailCode.value.length !== 6) return
  try {
    if (!(await checkAuth())) return
    await $fetch('/api/auth/email/verify', {
      method: 'POST',
      body: { email: newEmail.value, otp: emailCode.value, locale: $getLocale() },
    })
    await fetchUserSession()
    emailCodeSent.value = false
    emailCode.value = ''
    appStore.notify('saved', 'success')
  } catch (e: any) {
    if ((e?.status ?? e?.statusCode) === 409) {
      emailCodeSent.value = false
      emailCode.value = ''
    }
    appStore.notify(e?.data?.message || e?.message, 'error')
  }
}

async function setPassword() {
  try {
    if (!(await checkAuth())) return
    await $fetch('/api/auth', {
      method: 'POST',
      body: { password: password1.value },
    })
    password1.value = ''
    password2.value = ''
    showPasswordChange.value = false
    auth.value.hasPassword = true
    appStore.notify('saved', 'success')
  } catch (e: any) {
    appStore.notify(e?.data?.message || e?.message, 'error')
  }
}

function toggleTOTP() {
  if (auth.value?.hasTOTP) disableTOTP()
  else showTOTPSecret()
}

async function showTOTPSecret() {
  try {
    if (!(await checkAuth())) {
      return
    }
    const response = await $fetch<{ secret: string }>('/api/auth/totp/generate')
    showTOTP.value = true
    TOTPSecret.value = response.secret
    await nextTick()
    const canvas = document.getElementById('totp-qrcode') as HTMLCanvasElement

    const config = useRuntimeConfig()
    const issuer = config.public.name
    const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.value!.email!)}?secret=${TOTPSecret.value}&issuer=${encodeURIComponent(issuer)}`
    QRCode.toCanvas(canvas, uri)
  } catch (e: any) {
    showTOTP.value = false
    appStore.notify(e?.data?.message || e?.message, 'error')
  }
}

async function confirmTOTP() {
  if (TOTPCode.value.length !== 6) return
  try {
    if (!(await checkAuth())) return
    await $fetch('/api/auth/totp/confirm', {
      method: 'POST',
      body: { secret: TOTPSecret.value, token: TOTPCode.value },
    })
    TOTPSecret.value = ''
    TOTPCode.value = ''
    auth.value.hasTOTP = true
    showTOTP.value = false
    if (isMfaSetup.value) {
      await fetchUserSession()
      if (!user.value?.requiresMfaSetup) await navigateTo('/', { replace: true })
    }
  } catch (e: any) {
    appStore.notify(e?.data?.message || e?.message, 'error')
  }
}

async function disableTOTP() {
  try {
    if (!(await appStore.confirm($t('disableTOTP') as string)) || !(await checkAuth())) return
    await $fetch('/api/auth/totp/disable', { method: 'POST' })
    TOTPCode.value = ''
    auth.value.hasTOTP = false
    showTOTP.value = false
  } catch (e: any) {
    appStore.notify(e?.data?.message || e?.message, 'error')
  }
}

async function deleteRefreshTokens() {
  if (!(await checkAuth())) return
  appStore.setLoading(true)
  try {
    await $fetch('/api/auth/refresh', {
      method: 'DELETE',
    })
    await clearSession()
    navigateTo('/')
  } catch (e: any) {
    appStore.notify(e?.data?.message || e?.message, 'error')
  } finally {
    appStore.setLoading(false)
  }
}

onMounted(getAuth)
</script>

<template>
  <div class="page">
    <template v-if="isMfaSetup">
      <div class="p2 my2 text-center">
        <b>{{ $t('mfaRequired') }}</b>
        <p class="m0">{{ $t('mfaRequiredDescription') }}</p>
      </div>

      <button
        class="w mb2"
        @click="registerPasskey"
      >
        {{ $t('registerPasskey') }}
      </button>
      <button
        class="w fg fg-border"
        @click="toggleTOTP"
      >
        {{ $t('setupTotp') }}
      </button>
    </template>

    <template v-else>
      <h1>{{ $t('authentication') }}</h1>

      <section>
        <form @submit.prevent="requestEmailChange">
          <label for="email">
            {{ $t('email') }}
            <div class="group flex-row">
              <input
                id="email"
                type="email"
                autocapitalize="none"
                v-model.trim="newEmail"
                :placeholder="user?.email"
              />
              <button
                class="flex-center fg"
                :title="$t('changeEmail')"
                :disabled="isCurrentEmail"
                type="submit"
              >
                <Icon name="lucide:save" />
              </button>
            </div>
          </label>
        </form>
        <div
          v-if="emailCodeSent"
          class="modal"
          @click.self="emailCodeSent = false"
        >
          <div
            class="p3"
            style="max-width: min(400px, 90vw)"
          >
            <form
              class="flex-column g2"
              @submit.prevent="confirmEmailChange"
            >
              <label for="email-code">{{ $t('code') }}</label>
              <input
                id="email-code"
                v-model.trim="emailCode"
                type="text"
                autocomplete="one-time-code"
                maxlength="6"
                required
              />
              <p class="muted-text">{{ $t('emailChangeCodeSent', { email: newEmail }) }}</p>
              <div class="text-right">
                <button
                  type="submit"
                  :disabled="emailCode.length !== 6"
                >
                  {{ $t('save') }}
                </button>
              </div>
            </form>
          </div>
        </div>
        <form
          class="mt1"
          @submit.prevent="showPasswordChange = true"
        >
          <label for="password1">
            {{ $t('password') }}
            <div class="group flex-row">
              <input
                :type="showPassword1 ? 'text' : 'password'"
                id="password1"
                v-model.trim="password1"
                autocomplete="new-password"
                :minlength="passwordPolicy.min"
                :maxlength="passwordPolicy.max"
                required
                :placeholder="auth?.hasPassword ? '************' : ''"
              />
              <button
                class="flex-center fg"
                type="button"
                @click="showPassword1 = !showPassword1"
              >
                <Icon :name="showPassword1 ? 'lucide:eye-off' : 'lucide:eye'" />
              </button>
              <button
                class="fg flex-center"
                :title="$t('changePassword')"
                type="submit"
                :disabled="!isPasswordValid"
              >
                <Icon name="lucide:save" />
              </button>
            </div>
            <small class="warning-text">{{
              $t('passwordPolicy', { count: passwordPolicy.min })
            }}</small>
          </label>
        </form>
        <div
          v-if="showPasswordChange"
          class="modal"
          @click.self="showPasswordChange = false"
        >
          <div
            class="p3"
            style="max-width: min(400px, 90vw)"
          >
            <form
              class="flex-column g2"
              @submit.prevent="setPassword"
            >
              <input
                v-show="false"
                type="email"
                :value="user?.email"
                autocomplete="username email"
              />
              <label for="password2">{{ $t('confirm') }} {{ $t('password') }}</label>
              <div class="flex-row group">
                <input
                  :type="showPassword2 ? 'text' : 'password'"
                  id="password2"
                  v-model.trim="password2"
                  autocomplete="new-password"
                  :minlength="passwordPolicy.min"
                  :maxlength="passwordPolicy.max"
                  required
                />
                <button
                  class="flex fg"
                  type="button"
                  @click="showPassword2 = !showPassword2"
                >
                  <Icon :name="showPassword2 ? 'lucide:eye-off' : 'lucide:eye'" />
                </button>
              </div>
              <div class="text-right">
                <button
                  type="submit"
                  :disabled="password1 !== password2 || !isPasswordValid"
                >
                  {{ $t('save') }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section>
        <h2>{{ $t('2fa') }}</h2>
        <h3 class="m0">Passkeys</h3>
        <form
          v-for="credential in auth?.credentials || []"
          :key="credential.id"
          @submit.prevent="setPasskeyName(credential.name, credential.id)"
        >
          <div class="flex-row group mt1">
            <input
              type="text"
              v-model="credential.name"
              maxlength="32"
            />
            <button
              type="button"
              class="bg danger-text flex"
              :disabled="!canRemovePasskey"
              :title="canRemovePasskey ? '' : $t('lastFactor')"
              @click="deletePasskey(credential.id)"
            >
              <Icon name="lucide:trash" />
            </button>
            <button class="flex fg"><Icon name="lucide:save" /></button>
          </div>
        </form>
        <button
          class="flex mt1 mb2"
          :disabled="auth?.credentials.length >= 4"
          :title="auth?.credentials.length >= 4 ? $t('passkeyLimit') : $t('registerPasskey')"
          @click="registerPasskey"
        >
          {{ $t('registerPasskey') }}
        </button>

        <label for="totp">{{ $t('authenticatorApp') }}</label>
        <input
          type="checkbox"
          id="totp"
          class="ml1"
          :checked="!!auth?.hasTOTP"
          :disabled="!canDisableTOTP"
          :title="canDisableTOTP ? '' : $t('lastFactor')"
          @click.prevent="toggleTOTP"
        />
      </section>
      <div class="flex-row my3">
        <button
          class="ml bg danger-text danger-border"
          @click="deleteRefreshTokens"
        >
          {{ $t('deleteRefreshTokens') }}
        </button>
      </div>
    </template>

    <div
      v-if="showTOTP && TOTPSecret"
      class="modal"
      @click.self="showTOTP = false"
    >
      <div
        class="p3"
        style="max-width: min(400px, 90vw)"
      >
        <p class="mt0">{{ $t('totpSecret') }}</p>
        <div class="text-center">
          <canvas
            id="totp-qrcode"
            class="border-radius"
          ></canvas>
          <p
            class="muted-text"
            style="word-break: break-all"
          >
            {{ TOTPSecret }}
          </p>
        </div>
        <label for="totp-code">{{ $t('code') }}</label>
        <div class="flex-row group">
          <input
            id="totp-code"
            type="text"
            v-model.trim="TOTPCode"
            autocomplete="one-time-code"
            @keyup="confirmTOTP"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: min(400px, 90vw);
  margin: 0 auto;
}
</style>
