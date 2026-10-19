import { useEffect, useState } from "react"
import { FileTrigger } from "@bugberry/ui/file-trigger"

const MAX_BYTES = 2 * 1024 * 1024
const MIN_SIDE = 128
const TYPES = ["image/png", "image/jpeg"]
export const LOGO_RULE = "PNG or JPG, at least 128 × 128 px"

type Measure = (file: File) => Promise<{ width: number; height: number }>
const measureImage: Measure = async (file) => {
  const bitmap = await createImageBitmap(file)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

/**
 * The workspace logo field: a preview of the chosen file, or the first letter until one is chosen.
 * Type, size and the 128 px minimum are checked here; the server checks the type again on upload.
 */
export function LogoPicker({
  file,
  current = null,
  name,
  onChange,
  measure = measureImage,
}: {
  file: File | null
  /** The logo already in use (Settings), shown until another file is chosen. */
  current?: string | null
  name: string
  onChange(file: File): void
  measure?: Measure
}) {
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!file) return setPreview(current)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file, current])

  const choose = async (files: FileList | null) => {
    const chosen = files?.[0]
    if (!chosen) return
    const size = TYPES.includes(chosen.type) && chosen.size <= MAX_BYTES ? await measure(chosen).catch(() => null) : null
    if (!size || size.width < MIN_SIDE || size.height < MIN_SIDE) return setError(LOGO_RULE)
    setError(null)
    onChange(chosen)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        {preview ? (
          <img src={preview} alt="" className="size-10 shrink-0 rounded-lg object-cover ring-1 ring-border" />
        ) : (
          <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-success text-base font-bold text-white">
            {name.trim().charAt(0).toUpperCase() || "?"}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          {!file && !current && <span className="text-sm text-foreground">Using the first letter for now</span>}
          <span className="text-xs text-muted-foreground">{LOGO_RULE}</span>
        </span>
        <FileTrigger acceptedFileTypes={TYPES} onSelect={(files) => void choose(files)} size="sm">
          Upload
        </FileTrigger>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger-subtle-foreground">
          {error}
        </p>
      )}
    </div>
  )
}
