import { toast as sonner } from "sonner"

export const TOAST_MS = 4000

export interface ToastMessage {
  title: string
  description?: string
  tone?: "success" | "info" | "error"
  /** One button on the toast, such as "Open" for something just made. */
  action?: { label: string; onClick(): void }
}

const SHOW = { success: sonner.success, info: sonner.info, error: sonner.error } as const

/** Shows a toast through Intent's Toast (Sonner); it leaves by itself after TOAST_MS. */
export function toast({ title, description, tone = "success", action }: ToastMessage): void {
  SHOW[tone](title, { description, duration: TOAST_MS, action })
}
