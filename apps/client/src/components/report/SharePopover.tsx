import type { Visibility } from "@bugberry/shared"
import { RiAlertLine, RiBuilding2Line, RiCheckLine, RiExpandUpDownLine, RiGlobalLine, RiLink, RiLockLine, RiRefreshLine } from "@remixicon/react"
import { cn } from "cn"
import { useEffect, useState } from "react"
import { SelectValue } from "react-aria-components/Select"
import { Button } from "@bugberry/ui/button"
import { Label } from "@bugberry/ui/field"
import { Select, SelectContent, SelectDescription, SelectItem, SelectLabel, SelectTrigger } from "@bugberry/ui/select"
import { accessOptions, type AccessOption } from "../../lib/share-access"

const ICONS = { workspace: RiLockLine, internal: RiBuilding2Line, public: RiGlobalLine } as const

function AccessIcon({ value }: { value: Visibility }) {
  const Icon = ICONS[value]
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full",
        value === "public" ? "bg-success-subtle text-success-subtle-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-4" />
    </span>
  )
}

/** The bare icon for a list item, where Intent's item lays out the svg itself. */
function OptionIcon({ value }: { value: Visibility }) {
  const Icon = ICONS[value]
  return <Icon aria-hidden />
}

function OptionText({ option }: { option: AccessOption }) {
  return (
    <span className="flex min-w-0 flex-col text-left">
      <span className="text-sm font-medium text-foreground">{option.title}</span>
      <span className="text-xs text-muted-foreground">{option.description}</span>
    </span>
  )
}

/** The Share popover's content: who can open the link, Copy link, and Reset link for public links. */
export function SharePopoverView({
  number,
  visibility,
  internalDomain,
  editable,
  busy,
  onChange,
  onCopy,
  onReset,
}: {
  number: number
  visibility: Visibility
  internalDomain: string | null
  editable: boolean
  busy: boolean
  onChange(next: Visibility): void
  onCopy(): Promise<void>
  onReset(): Promise<void>
}) {
  const [state, setState] = useState<"idle" | "confirm-reset" | "copied">("idle")
  const options = accessOptions(internalDomain)
  const current = options.find((option) => option.value === visibility) ?? {
    value: visibility,
    title: "Anyone at your company",
    description: "Signs in with a company email",
  }

  useEffect(() => {
    if (state !== "copied") return
    const timer = setTimeout(() => setState("idle"), 2000)
    return () => clearTimeout(timer)
  }, [state])

  const copy = async () => {
    try {
      await onCopy()
      setState("copied")
    } catch {
      // The caller already said why.
    }
  }
  const reset = async () => {
    await onReset()
    setState("idle")
  }

  return (
    <div className="flex w-[min(380px,calc(100vw-24px))] flex-col">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-semibold text-foreground">Share report</h2>
          <span className="font-mono text-xs text-muted-foreground">BB-{number}</span>
        </div>
        <Select
          selectedKey={visibility}
          isDisabled={!editable || busy}
          onSelectionChange={(key) => key && key !== visibility && onChange(key as Visibility)}
          className="flex flex-col gap-2 [&>[data-slot=label]+[data-slot=control]]:mt-0"
        >
          <Label className="text-xs text-muted-foreground sm:text-xs">Who can open this link</Label>
          <SelectTrigger className="gap-3 rounded-xl bg-background p-2.5 sm:p-2.5">
            <AccessIcon value={current.value} />
            {/* The value names the trigger too, so it reads "Workspace members only, Who can open this link". */}
            <SelectValue className="min-w-0">{() => <OptionText option={current} />}</SelectValue>
            <RiExpandUpDownLine aria-hidden className="ms-auto text-muted-foreground" />
          </SelectTrigger>
          <SelectContent items={options}>
            {(option) => (
              <SelectItem id={option.value} textValue={option.title}>
                <OptionIcon value={option.value} />
                <SelectLabel>{option.title}</SelectLabel>
                <SelectDescription className="text-xs">{option.description}</SelectDescription>
              </SelectItem>
            )}
          </SelectContent>
          {!editable && <p className="text-xs text-muted-foreground">Only the reporter or an admin can change this</p>}
        </Select>
      </div>
      {state === "confirm-reset" ? (
        <div className="flex flex-col gap-3 border-t border-danger/20 bg-danger-subtle p-4">
          <div className="flex gap-2">
            <RiAlertLine aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
            <div>
              <p className="text-sm font-medium text-foreground">Reset this link?</p>
              <p className="text-xs text-muted-foreground">
                The old link stops working right away. Anyone you sent it to will need the new one.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" intent="outline" isDisabled={busy} onPress={() => setState("idle")}>
              Cancel
            </Button>
            <Button size="sm" intent="danger" isDisabled={busy} onPress={reset}>
              Reset link
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-border p-4">
          {visibility === "public" && editable && (
            <Button size="sm" intent="outline" isDisabled={busy} onPress={() => setState("confirm-reset")}>
              <RiRefreshLine aria-hidden className="size-4" />
              Reset link
            </Button>
          )}
          {state === "copied" ? (
            <Button size="sm" className="ml-auto bg-success text-success-foreground hover:bg-success">
              <RiCheckLine aria-hidden className="size-4" />
              Copied
            </Button>
          ) : (
            <Button size="sm" className="ml-auto" isDisabled={busy} onPress={copy}>
              <RiLink aria-hidden className="size-4" />
              Copy link
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
