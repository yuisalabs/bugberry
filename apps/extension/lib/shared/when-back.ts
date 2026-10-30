/**
 * Calls `callback` when the reporter comes back to this page: its window gets focus, or its tab shows again. Over a
 * page the review is a frame, and its window only gets focus once clicked, so the tab showing again counts too.
 * Returns a function that stops listening.
 */
export function whenBack(
  win: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  doc: Pick<EventTarget, "addEventListener" | "removeEventListener"> & { readonly visibilityState: DocumentVisibilityState },
  callback: () => void,
): () => void {
  const onVisible = () => {
    if (doc.visibilityState === "visible") callback()
  }
  win.addEventListener("focus", callback)
  doc.addEventListener("visibilitychange", onVisible)
  return () => {
    win.removeEventListener("focus", callback)
    doc.removeEventListener("visibilitychange", onVisible)
  }
}
