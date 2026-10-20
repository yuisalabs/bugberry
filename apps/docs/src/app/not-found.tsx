import { DocsBody, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page"
import Link from "next/link"

export default function NotFound() {
  return (
    <DocsPage>
      <DocsTitle>Page not found</DocsTitle>
      <DocsBody>
        <p>
          This page doesn't exist, or it moved. Start from the <Link href="/">introduction</Link>, or press{" "}
          <kbd>Ctrl</kbd> <kbd>K</kbd> to search.
        </p>
      </DocsBody>
    </DocsPage>
  )
}
