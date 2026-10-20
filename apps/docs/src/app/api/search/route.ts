import { createFromSource } from "fumadocs-core/search/server"
import { source } from "@/lib/source"

// Built once into out/api/search: the static export has no server to answer searches.
export const revalidate = false

export const { staticGET: GET } = createFromSource(source, { language: "english" })
