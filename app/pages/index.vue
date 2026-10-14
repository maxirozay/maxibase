<script setup lang="ts">
definePageMeta({
  middleware: ['authenticated'],
})
const { user } = useUserSession()
const path = ref('u/' + user.value!.id)
const appStore = useAppStore()

async function sendLog() {
  await $fetch('/api/log', {
    method: 'POST',
    body: {
      summary: 'Test log ' + new Date().toISOString().substring(0, 16),
      data: { test: 1, nested: { value: 'abc' } },
      origin: useRoute().fullPath,
      type: Math.random() > 0.5 ? 'Info' : 'Error',
    },
  })
  appStore.notify('Test log sent to server')
}

const files = ref([] as any[])
async function listFiles() {
  const params = new URLSearchParams({
    path: path.value,
    isPrivate: 'true',
  }).toString()
  files.value = await $fetch<any[]>(`/api/files?${params}`)
}

async function copyFiles(deleteSrc = false) {
  await $fetch('/api/files/copy', {
    method: 'POST',
    body: {
      src: path.value,
      dest: path.value.replace(user.value!.id, user.value!.id + (deleteSrc ? '/move' : '/copy')),
      isPrivate: true,
      deleteSrc,
    },
  })
  appStore.notify('Files copied')
}

function testConfirmation() {
  appStore.confirm('Are you sure?').then((confirmed) => {
    if (confirmed) appStore.notify('Confirmed', 'success')
    else appStore.notify('Cancelled', 'error')
  })
}
</script>

<template>
  <div class="portrait px2">
    <div class="flex g2 mt2">
      <button @click="sendLog">Send test log</button>
      <button
        class="primary"
        @click="testConfirmation"
      >
        Show Confirmation
      </button>
    </div>
    <h1>File Management</h1>
    <label for="path">Path</label>
    <div class="flex group">
      <input
        type="text"
        id="path"
        v-model="path"
        class="flex-4"
      />
      <FilesDelete
        class="bg flex-center"
        :path="path"
        :isPrivate="true"
      />
      <button @click="copyFiles()">Copy</button>
      <button @click="copyFiles(true)">Move</button>
      <button @click="listFiles">List</button>
      <label
        for="upload"
        class="label__file primary flex-row g2 flex-center"
      >
        <b>{{ $t('upload') }}</b>
        <FilesUpload
          id="upload"
          :path="path"
          :isPrivate="true"
          @uploaded="(response) => console.log('File uploaded', response)"
        />
      </label>
    </div>
    <div
      v-for="file in files"
      :key="file.path"
    >
      <a
        :href="file.url"
        target="_blank"
      >
        {{ file.path }}
      </a>
    </div>
  </div>
</template>
