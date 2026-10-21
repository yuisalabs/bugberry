"use client"

import { type ReactNode, useCallback, useRef, useState } from "react"
import { Button } from "./button"
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog"

export interface ConfirmOptions {
  /** The question, such as "Delete this comment?". */
  title: string
  /** What happens if they go ahead. */
  description?: ReactNode
  /** The button that goes ahead, such as "Delete". */
  confirmLabel: string
  cancelLabel?: string
  /** "danger" (the default) for deleting, revoking and the like. */
  intent?: "danger" | "primary"
}

/**
 * The app's own window.confirm: an alert dialog that asks before something that can't be taken back. Clicking
 * outside does not close it; Cancel and Escape answer no.
 */
export function ConfirmDialog({
  isOpen,
  options,
  onAnswer,
}: {
  isOpen: boolean
  options: ConfirmOptions | null
  onAnswer(yes: boolean): void
}) {
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && onAnswer(false)}
      role="alertdialog"
      size="sm"
      closeButton={false}
    >
      {options && (
        <>
          <DialogHeader>
            <DialogTitle>{options.title}</DialogTitle>
            {options.description && <DialogDescription>{options.description}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <DialogClose intent="outline">{options.cancelLabel ?? "Cancel"}</DialogClose>
            <Button intent={options.intent ?? "danger"} onPress={() => onAnswer(true)}>
              {options.confirmLabel}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  )
}

/**
 * Asks like window.confirm, in the app's dialog: `if (await confirm({ ... })) remove()`. Render `dialog`
 * somewhere in the component.
 */
export function useConfirm(): { confirm(options: ConfirmOptions): Promise<boolean>; dialog: ReactNode } {
  // The options outlive `open`, so the dialog keeps its text while it animates away.
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [open, setOpen] = useState(false)
  const answer = useRef<((yes: boolean) => void) | null>(null)
  const confirm = useCallback((next: ConfirmOptions) => {
    answer.current?.(false)
    setOptions(next)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      answer.current = resolve
    })
  }, [])
  const onAnswer = (yes: boolean) => {
    answer.current?.(yes)
    answer.current = null
    setOpen(false)
  }
  return { confirm, dialog: <ConfirmDialog isOpen={open} options={options} onAnswer={onAnswer} /> }
}
