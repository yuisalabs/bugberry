import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { BASE_PATH, GITHUB_URL } from "./base-path"

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2">
          <img src={`${BASE_PATH}/bugberry_icon_small.webp`} alt="" className="size-7 object-contain" />
          <img src={`${BASE_PATH}/bugberry_typeface_small.webp`} alt="BugBerry" className="h-5 w-auto" />
          <span className="font-heading text-sm font-medium text-fd-muted-foreground">Docs</span>
        </span>
      ),
    },
    githubUrl: GITHUB_URL,
  }
}
