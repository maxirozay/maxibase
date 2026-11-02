<script setup lang="ts">
const appStore = useAppStore()
const emits = defineEmits(['deleted'])
const props = defineProps({
  path: String,
  isPrivate: {
    type: Boolean,
    default: true,
  },
})

async function deleteFile() {
  try {
    if (await appStore.confirm()) {
      await deleteFiles(props.path!, { isPrivate: props.isPrivate })
      appStore.notify('deleted', 'success')
      emits('deleted')
    }
  } catch (e: any) {
    appStore.notify(e.data?.message, 'error')
  }
}
</script>

<template>
  <button
    type="button"
    class="flex-row g2"
    @click="deleteFile"
  >
    {{ $t('delete') }}
  </button>
</template>
