import { useCallback, useLayoutEffect, useState } from "react"

/** A textarea as tall as its text: no inner scrollbar, the panel around it scrolls instead. Pass the field's value. */
export function useAutoGrow(value: string): (element: HTMLTextAreaElement | null) => void {
  const [element, setElement] = useState<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${element.scrollHeight}px`
  }, [element, value])
  return useCallback((next: HTMLTextAreaElement | null) => setElement(next), [])
}
