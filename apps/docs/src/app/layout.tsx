import type { Metadata } from "next"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import type { ReactNode } from "react"
import { Provider } from "@/components/provider"
import { BASE_PATH } from "@/lib/base-path"
import { baseOptions } from "@/lib/layout.shared"
import { source } from "@/lib/source"
import "./global.css"

export const metadata: Metadata = {
  title: { template: "%s · BugBerry Docs", default: "BugBerry Docs" },
  description: "Set up, self-host, and use BugBerry: bug reports with the console, network, and steps attached.",
  icons: { icon: `${BASE_PATH}/favicon.png` },
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider>
          <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
            {children}
          </DocsLayout>
        </Provider>
      </body>
    </html>
  )
}
