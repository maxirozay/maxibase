export type ImageFormat = {
  maxHeight?: number
  format?: string
  quality?: number
}

export async function formatImage(
  file: File,
  { maxHeight, format = 'webp', quality = 0.8 }: ImageFormat = {},
): Promise<File> {
  if (file.type === 'image/svg+xml') return file

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  try {
    const ratio = maxHeight ? Math.min(1, maxHeight / bitmap.height) : 1
    if (ratio === 1 && file.type === `image/${format}`) return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * ratio)
    canvas.height = Math.round(bitmap.height * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')

    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, `image/${format}`, quality),
    )
    if (!blob) throw new Error('blob failed')

    return new File([blob], `${file.name.replace(/\.[^./\\]+$/, '')}.${blob.type.split('/')[1]}`, {
      type: blob.type,
    })
  } finally {
    bitmap.close()
  }
}
