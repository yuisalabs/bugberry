import { metaSchema, pageSchema } from "fumadocs-core/source/schema"
import { loader } from "fumadocs-core/source"
import { defineDocs } from "fumadocs-mdx/macro"

const docs = defineDocs({
  dir: "content/docs",
  docs: { schema: pageSchema },
  meta: { schema: metaSchema },
})

/** Pages live at the site root ("/self-host/install"); the "/docs" in front comes from Next's basePath. */
export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
})
