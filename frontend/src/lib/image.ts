export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5 MB

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Read an image File, center-crop to a square, downscale, and return a compact
 * JPEG data URL — small enough to store inline as the user's photo_url.
 */
export function fileToAvatarDataUrl(
  file: File,
  size = 256,
  quality = 0.82,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file.'))
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      reject(new Error(`Image is too large (max 5 MB). Yours is ${formatBytes(file.size)}.`))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not load the image.'))
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas not supported.'))
          return
        }
        const side = Math.min(img.width, img.height)
        const sx = (img.width - side) / 2
        const sy = (img.height - side) / 2
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

const ALLOWED_DOC_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]

/**
 * Read any allowed document File (PDF or image) as a data URL, enforcing the
 * 5 MB cap. Used for direct document uploads (stored inline, no external URL).
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      reject(new Error(`File is too large (max 5 MB). Yours is ${formatBytes(file.size)}.`))
      return
    }
    if (!ALLOWED_DOC_TYPES.includes(file.type)) {
      reject(new Error('Please upload a PDF or image (PNG / JPG / WEBP).'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}
