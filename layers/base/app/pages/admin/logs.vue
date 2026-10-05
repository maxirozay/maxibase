<script setup lang="ts">
definePageMeta({
  middleware: ['admin'],
})

const appStore = useAppStore()

const isLoading = ref()
const error = ref('')
const logs = ref([] as any[])
const hasMore = ref(false)
const shownLimit = ref(0)
const expanded = ref(new Set<number>())
const day = 24 * 60 * 60 * 1000
const offset = new Date().getTimezoneOffset() * 60 * 1000 - 60000
const from = ref(new Date(Date.now() - 7 * day - offset).toISOString().substring(0, 16))
const to = ref(new Date(Date.now() - offset).toISOString().substring(0, 16))
const search = ref('')
const type = ref('')
const hideDuplicates = ref(true)
const duplicateMap = ref({} as Record<string, any[]>)
const sortBy = ref('time')

const filteredLogs = computed(() => {
  if (!hideDuplicates.value) return logs.value
  return logs.value.filter((log) => {
    if (log.duplicates.length === 1) return true
    const duplicateId = log.summary + log.origin
    return duplicateMap.value[duplicateId] && duplicateMap.value[duplicateId][0]?.id === log.id
  })
})

const sortedLogs = computed(() => {
  if (sortBy.value === 'time') return filteredLogs.value
  return filteredLogs.value.toSorted((a, b) => {
    if (sortBy.value === 'type') {
      return a.type.localeCompare(b.type)
    } else if (sortBy.value === 'duplicates') {
      return b.duplicates.length - a.duplicates.length
    }
    return 0
  })
})

const groupedLogs = computed(() => {
  if (sortBy.value !== 'time') return [{ label: '', logs: sortedLogs.value }]
  const groups = [] as { label: string; logs: any[] }[]
  for (const log of sortedLogs.value) {
    const label = formatDay(log.time)
    const group = groups[groups.length - 1]
    if (group?.label === label) group.logs.push(log)
    else groups.push({ label, logs: [log] })
  }
  return groups
})

function formatDay(utcTimestamp: string) {
  const date = new Date(utcTimestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

function originUrl(origin: string | null) {
  const url = origin?.replace(/ .*/, '')
  return url?.startsWith('/') || url?.startsWith('http') ? url : null
}

function toggleExpanded(id: number, isOpen: boolean) {
  if (isOpen) expanded.value.add(id)
  else expanded.value.delete(id)
}

function toUTC(datetimeLocal: string) {
  return new Date(datetimeLocal).toISOString()
}

function formatDateTime(utcTimestamp: string) {
  return new Date(utcTimestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function getLogs() {
  isLoading.value = true
  error.value = ''
  try {
    const response = await $fetch<any>('/api/admin/logs', {
      query: {
        from: toUTC(from.value),
        to: toUTC(to.value),
        search: search.value,
        type: type.value || undefined,
      },
    })
    logs.value = response.logs
    hasMore.value = response.hasMore
    shownLimit.value = response.limit
    expanded.value.clear()
    duplicateMap.value = {}
    logs.value.forEach((log) => {
      const duplicateId = log.summary + log.origin
      if (!duplicateMap.value[duplicateId]) {
        duplicateMap.value[duplicateId] = []
      }
      duplicateMap.value[duplicateId]?.push(log)
      log.duplicates = duplicateMap.value[duplicateId]
    })
  } catch (e: any) {
    logs.value = []
    hasMore.value = false
    error.value = e?.data?.message || e?.message || 'Failed to load logs'
    appStore.notify(error.value, 'error')
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  getLogs()
})
</script>

<template>
  <div class="flex">
    <div class="p3">
      <form
        @submit.prevent="getLogs"
        class="flex-column g2 mb1"
      >
        <div class="flex-row group fg flex-1">
          <label
            for="search"
            class="flex-center p-input"
          >
            <Icon
              name="lucide:search"
              class="mr"
            />
          </label>
          <input
            id="search"
            type="text"
            class="m0 flex-4"
            v-model="search"
          />
        </div>
        <div class="flex-row group fg flex-1">
          <label
            for="type"
            class="p-input"
          >
            Type
          </label>
          <select
            v-model="type"
            id="type"
            @change="getLogs"
          >
            <option value="">All</option>
            <option
              v-for="logType in logTypes"
              :key="logType.value"
              :value="logType.value"
            >
              {{ logType.label }}
            </option>
          </select>
        </div>
        <div class="flex-row group fg flex-1">
          <label
            for="sortBy"
            class="p-input"
            style="white-space: nowrap"
          >
            Sort by
          </label>
          <select
            v-model="sortBy"
            id="sortBy"
          >
            <option value="time">Time</option>
            <option value="type">Type</option>
            <option value="duplicates">Duplicates</option>
          </select>
        </div>
        <div class="flex-row group fg flex-1">
          <label
            for="from"
            class="p-input"
          >
            From
          </label>
          <input
            id="from"
            type="datetime-local"
            class="m0 flex-4"
            v-model="from"
            @change="getLogs"
          />
        </div>
        <div class="flex-row group fg flex-1">
          <label
            for="to"
            class="p-input"
          >
            To
          </label>
          <input
            id="to"
            type="datetime-local"
            class="m0 flex-4"
            v-model="to"
            @change="getLogs"
          />
        </div>
        <button
          type="submit"
          :class="['flex-1', isLoading ? 'spin' : '']"
          :disabled="isLoading"
        >
          Get logs
        </button>
      </form>
      <label>
        Hide duplicates
        <input
          type="checkbox"
          class="ml1"
          v-model="hideDuplicates"
        />
      </label>
    </div>
    <div
      class="flex-auto p3"
      style="min-width: 0"
    >
      <div
        v-if="error"
        class="danger-text mb2"
      >
        {{ error }}
      </div>
      <div
        v-else-if="!isLoading && !sortedLogs.length"
        class="muted-text mb2"
      >
        {{ 'No logs match this search.' }}
      </div>
      <div
        v-if="hasMore"
        class="warning-text mb2"
      >
        Showing the first {{ shownLimit }} matches. Narrow the period or refine the search.
      </div>
      <div
        v-for="group in groupedLogs"
        :key="group.label"
        class="mb2"
      >
        <div
          v-if="group.label"
          class="sticky top bg bb pb1 muted-text mb1"
        >
          {{ group.label }}
        </div>
        <div
          v-for="log in group.logs"
          :key="log.id"
          class="accordion fg mb1"
        >
          <label
            :for="`log-${log.id}`"
            class="p2"
          >
            <div class="flex g1">
              <div class="flex-1 line mr1">
                <span
                  :class="logTypes.find((t) => t.value === log.type.toLowerCase())?.color"
                  style="text-transform: capitalize"
                >
                  {{ log.type }}
                  <template v-if="log.duplicates.length > 1">
                    ({{ log.duplicates.length }})
                  </template>
                </span>
                @
                <a
                  v-if="originUrl(log.origin)"
                  :href="originUrl(log.origin)!"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ log.origin }}
                </a>
                <span v-else>{{ log.origin }}</span>
              </div>
              <div>{{ formatDateTime(log.time) }}</div>
            </div>
            <small style="word-wrap: break-word">{{ log.summary }}</small>
          </label>
          <input
            :id="`log-${log.id}`"
            type="checkbox"
            :checked="expanded.has(log.id)"
            @change="toggleExpanded(log.id, ($event.target as HTMLInputElement).checked)"
          />
          <div class="px2">
            <ul v-if="expanded.has(log.id)">
              <li
                v-for="duplicate in log.duplicates"
                :key="duplicate.id"
                class="mb1"
              >
                <small>
                  <div class="flex g1">
                    <div class="mr">
                      <b>User:</b> IP: {{ duplicate.ipAddress }}
                      <span v-if="duplicate.auth">
                        {{ duplicate.auth.email }} (ID: {{ duplicate.userId }})
                      </span>
                    </div>
                    <div>{{ formatDateTime(duplicate.time) }}</div>
                  </div>
                  <b>User Agent:</b> {{ duplicate.userAgent }}
                  <div
                    v-if="duplicate.data && Object.keys(duplicate.data).length"
                    class=""
                  >
                    <b>Data:</b>
                    <button
                      class="fg fg-border p0 ml1"
                      @click="copyToClipboard(JSON.stringify(duplicate.data))"
                    >
                      <Icon
                        name="lucide:copy"
                        class="mr"
                      />
                    </button>
                    <DataExplorer
                      :data="duplicate.data"
                      class="bl pl1"
                    />
                  </div>
                </small>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
