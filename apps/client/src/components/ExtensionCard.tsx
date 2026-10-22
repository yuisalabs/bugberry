import { RiPuzzle2Line } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { Link } from "@bugberry/ui/link"
import { askExtension, type ExtensionAnswer, useServerInExtension } from "../lib/extension-bridge"
import { queries } from "../lib/queries"
import { installHref } from "../pages/landing/site-links"

/** The extension's state at the bottom of the sidebar: installed, sending elsewhere, or missing. */
export function ExtensionCardView({
  answer,
  installUrl,
  onUseServer,
}: {
  answer: ExtensionAnswer
  installUrl: string | null
  onUseServer(): void
}) {
  return (
    <section aria-label="Browser extension" className="rounded-xl border border-sidebar-border bg-background p-3 text-xs">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <RiPuzzle2Line aria-hidden className="size-4 text-primary" />
        Browser extension
      </p>
      <div className="mt-2">
        {!answer.installed ? (
          <span className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Not installed</span>
            {installUrl && (
              <Link href={installUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                Install
              </Link>
            )}
          </span>
        ) : answer.active ? (
          <span className="flex items-center gap-1.5 text-success-subtle-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            {answer.version ? `Installed, v${answer.version}` : "Installed"}
          </span>
        ) : (
          <AriaButton onPress={onUseServer} className="font-semibold text-primary hover:underline">
            Use the extension with this server
          </AriaButton>
        )}
      </div>
    </section>
  )
}

const askThisPage = () => askExtension(window)

/** Asks the extension again whenever the person comes back to this tab. */
export function useExtensionAnswer(ask: () => Promise<ExtensionAnswer> = askThisPage): ExtensionAnswer {
  const [answer, setAnswer] = useState<ExtensionAnswer>({ installed: false })
  useEffect(() => {
    let cancelled = false
    const check = () => {
      void ask().then((next) => {
        if (!cancelled) setAnswer(next)
      })
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") check()
    }
    check()
    window.addEventListener("focus", check)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      window.removeEventListener("focus", check)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [ask])
  return answer
}

export function ExtensionCard() {
  const answer = useExtensionAnswer()
  const config = useQuery(queries.clientConfig())
  return (
    <ExtensionCardView
      answer={answer}
      installUrl={installHref(config.data?.extensionInstallUrl ?? null)}
      onUseServer={() => useServerInExtension(window)}
    />
  )
}
