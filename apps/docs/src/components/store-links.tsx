import { STORE_LINKS } from "@/lib/store-links"

const STORES = [
  { key: "chrome", name: "Chrome Web Store", note: "Chrome, Edge, Brave, and Opera" },
  { key: "firefox", name: "Firefox Add-ons", note: "Firefox 128 or newer" },
] as const

/** One row per store: a link once the listing is live, "Coming soon" until then. */
export function StoreLinks() {
  return (
    <ul>
      {STORES.map((store) => {
        const url = STORE_LINKS[store.key]
        return (
          <li key={store.key}>
            {url ? <a href={url}>{store.name}</a> : <strong>{store.name}</strong>} ({store.note})
            {url ? null : <> — Coming soon</>}
          </li>
        )
      })}
    </ul>
  )
}
