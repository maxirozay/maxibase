<script setup lang="ts">
import type { PropType } from 'vue'

const appStore = useAppStore()
const emits = defineEmits(['uploaded'])
const props = defineProps({
  path: String,
  isPrivate: {
    type: Boolean,
    default: true,
  },
  maxAge: Number,
  imageFormat: {
    type: Object as PropType<{
      maxHeight?: number
      format?: string
      quality?: number
    }>,
  },
})

const progress = ref<number>(0)

async function uploadFile(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0 || !props.path) return

  try {
    let files = Array.from(input.files)
    if (props.imageFormat) {
      progress.value = 1
      const { maxHeight, format, quality } = props.imageFormat
      const results = await Promise.allSettled(
        files.map((file) =>
          file.type.startsWith('image/')
            ? formatImage(file, maxHeight, format, quality)
            : Promise.resolve(file),
        ),
      )
      const failed: string[] = []
      files = files.flatMap((file, i) => {
        const result = results[i]!
        if (result.status === 'fulfilled') return result.value
        failed.push(file.name)
        return []
      })
      if (failed.length) {
        appStore.notify('formatFailed', 'error', false, { files: failed.join(', ') })
      }
    }
    const maxSize = Number(useRuntimeConfig().public.files.maxSize)
    const tooLarge = files.filter((file) => file.size > maxSize * 1024 * 1024)
    if (tooLarge.length) {
      appStore.notify('fileTooLarge', 'error', false, {
        files: tooLarge.map((file) => file.name).join(', '),
        max: maxSize,
      })
      files = files.filter((file) => !tooLarge.includes(file))
    }
    if (files.length) {
      let response = await uploadFiles(
        files,
        props.path,
        props.isPrivate,
        (p) => {
          progress.value = p
        },
        props.maxAge,
      )
      emits('uploaded', response)
      appStore.notify('saved', 'success')
    }
  } catch (e: any) {
    appStore.notify(e?.data?.message || e?.message, 'error')
  }
  progress.value = 0
  input.value = ''
}
</script>

<template>
  <div
    v-if="progress"
    class="modal flex-center"
  >
    <progress
      v-if="progress"
      :value="progress"
      max="100"
      style="width: 90vw"
    >
      {{ progress }}%
    </progress>
  </div>
  <input
    v-else
    type="file"
    multiple
    @change="uploadFile"
  />
</template>
