import { RiFileCopyLine, RiInformationLine, RiRefreshLine } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@bugberry/ui/button"
import { Radio, RadioField, RadioGroup } from "@bugberry/ui/radio"
import { Switch, SwitchField } from "@bugberry/ui/switch"
import { SettingRow, SettingsCardHeader, settingsCard, settingsPadding } from "../../components/layout/SettingsCard"
import { toast } from "../../lib/toast"
import { errorMessage } from "../../lib/query/unwrap"
import { accountQueries } from "../account/queries"
import { useUpdateWorkspaceAccess, type WorkspaceAccess, workspaceQueries } from "./queries"

const MODES = [
  { id: "direct", label: "Join directly" },
  { id: "approval", label: "Ask an admin" },
] as const

/** Who can join without a personal invite: the shared invite link, and people with the admin's email domain. */
export function WorkspaceAccessView({
  access,
  origin,
  busy,
  onShareLink,
  onDomain,
  membersAllowed = true,
  emailDomain = null,
}: {
  access: WorkspaceAccess
  origin: string
  busy: boolean
  onShareLink(action: "on" | "off" | "reset"): void
  onDomain(patch: { joinDomain?: string | null; joinMode?: "direct" | "approval" }): void
  /** False under ACCOUNT_LIMITS: nothing can be turned on, but a way in already open can be closed. */
  membersAllowed?: boolean
  /** The domain of my own email, to name it when it can't be used (gmail.com). */
  emailDomain?: string | null
}) {
  // The stored domain when there is one (it may be another admin's), else the domain I could turn on.
  const domain = access.joinDomain ?? access.ownDomain
  const link = access.shareCode ? `${new URL(origin).host}/join/${access.shareCode}` : null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${origin}/join/${access.shareCode}`)
      toast({ title: "Link copied" })
    } catch {
      toast({ title: "Couldn't copy the link", tone: "error" })
    }
  }

  return (
    <section className={settingsCard}>
      <SettingsCardHeader title="Joining" description="Choose how new people can get into this workspace." />

      {!membersAllowed && (
        <p className={`border-t border-border py-4 text-sm text-muted-foreground ${settingsPadding}`}>Inviting teammates isn't available on this account.</p>
      )}

      <SettingRow title="Invite link" description="Anyone signed in with the link or code joins as a Member.">
        {membersAllowed || link ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{link ? "On" : "Off"}</span>
              <span className="text-sm text-muted-foreground">
                {link ? "Share it with anyone who should join." : "Turn it on to get a shareable link."}
              </span>
            </div>
            {membersAllowed ? (
              <SwitchField aria-label="Invite link" isSelected={Boolean(link)} isDisabled={busy} onChange={() => onShareLink(link ? "off" : "on")}>
                <Switch />
              </SwitchField>
            ) : (
              <Button size="sm" intent="outline" isDisabled={busy} onPress={() => onShareLink("off")}>
                Turn off invite link
              </Button>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Off</span>
        )}
        {link && membersAllowed && (
          <div className="flex flex-wrap items-center gap-2">
            {/* A line of its own on phones, with Copy and Reset under it. */}
            <code className="w-full min-w-0 truncate rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm text-foreground sm:w-auto sm:flex-1">
              {link}
            </code>
            <Button size="sm" intent="outline" isDisabled={busy} onPress={() => void copy()}>
              <RiFileCopyLine aria-hidden />
              Copy
            </Button>
            <Button size="sm" intent="plain" isDisabled={busy} onPress={() => onShareLink("reset")}>
              <RiRefreshLine aria-hidden />
              Reset
            </Button>
          </div>
        )}
      </SettingRow>

      <SettingRow title="Join by email domain" description="People with a matching work email can join without an invite.">
        {!membersAllowed ? (
          access.joinDomain ? (
            <Button size="sm" intent="outline" className="self-start" isDisabled={busy} onPress={() => onDomain({ joinDomain: null })}>
              Turn off joining by email domain
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">Off</span>
          )
        ) : domain ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col">
                <span className="font-medium text-foreground">@{domain}</span>
                <span className="text-sm text-muted-foreground">
                  {access.joinDomain !== null ? "On" : "Off"}
                </span>
              </div>
              <SwitchField
                aria-label={`Let people with @${domain} join`}
                isSelected={access.joinDomain !== null}
                isDisabled={busy}
                onChange={() => onDomain(access.joinDomain !== null ? { joinDomain: null } : { joinDomain: domain, joinMode: "approval" })}
              >
                <Switch />
              </SwitchField>
            </div>
            {access.joinDomain !== null && (
              <RadioGroup
                aria-label="How they join"
                orientation="horizontal"
                value={access.joinMode}
                isDisabled={busy}
                onChange={(value) => onDomain({ joinMode: value === "direct" ? "direct" : "approval" })}
                className="flex flex-wrap gap-4 space-y-0"
              >
                {MODES.map((mode) => (
                  <RadioField key={mode.id} value={mode.id}>
                    <Radio>{mode.label}</Radio>
                  </RadioField>
                ))}
              </RadioGroup>
            )}
          </>
        ) : (
          <div className="flex items-start gap-3 rounded-xl bg-muted px-4 py-3">
            <RiInformationLine aria-hidden className="mt-0.5 size-4.5 shrink-0 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">Not available for {emailDomain ?? "your email"}</span>
              <span className="text-sm text-muted-foreground">Public email domains can't be used. Sign in with a company email to turn this on.</span>
            </div>
          </div>
        )}
      </SettingRow>
    </section>
  )
}

/** The access settings wired to the API. */
export function WorkspaceAccessSection({ workspaceId }: { workspaceId: string }) {
  const me = useQuery(accountQueries.me())
  const access = useQuery(workspaceQueries.workspaceAccess(workspaceId))
  const limits = useQuery(workspaceQueries.workspaceLimits(workspaceId))
  const update = useUpdateWorkspaceAccess(workspaceId)
  // Nothing until both are known, so a limited workspace never flashes controls that would be refused.
  if (!access.data || !limits.data) return null
  return (
    <>
      <WorkspaceAccessView
        access={access.data}
        origin={window.location.origin}
        busy={update.isPending}
        onShareLink={(action) => update.mutate({ shareLink: action })}
        onDomain={(patch) => update.mutate(patch)}
        membersAllowed={!limits.data.limited}
        emailDomain={me.data?.email.split("@")[1] ?? null}
      />
      {update.error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(update.error)}
        </p>
      )}
    </>
  )
}
