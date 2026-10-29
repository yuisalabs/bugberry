import { RiCheckLine, RiFileCopyLine } from "@remixicon/react"
import { useState } from "react"
import { Button } from "@bugberry/ui/button"

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState("copied")
    } catch {
      setState("failed")
    }
    setTimeout(() => setState("idle"), 2000)
  }
  return (
    <Button intent="outline" size="sm" onPress={() => void copy()} className={className}>
      {state === "copied" ? <RiCheckLine aria-hidden /> : <RiFileCopyLine aria-hidden />}
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
    </Button>
  )
}
