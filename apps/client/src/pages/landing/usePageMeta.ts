import { useEffect } from "react"

/** The tab title and search description of a public page, put back as they were when the page closes. */
export function usePageMeta(title: string, description: string): void {
  useEffect(() => {
    const previousTitle = document.title
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const created = !meta
    if (!meta) {
      meta = document.createElement("meta")
      meta.name = "description"
      document.head.append(meta)
    }
    const previousDescription = meta.content
    document.title = title.includes("BugBerry") ? title : `${title} · BugBerry`
    meta.content = description
    return () => {
      document.title = previousTitle
      if (created) meta.remove()
      else meta.content = previousDescription
    }
  }, [title, description])
}
