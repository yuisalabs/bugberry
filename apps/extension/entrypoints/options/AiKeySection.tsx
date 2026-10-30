import type { ProviderConfig } from "@bugberry/ai-write"
import { Button } from "@bugberry/ui/button"
import { Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { Radio, RadioField, RadioGroup } from "@bugberry/ui/radio"
import { TextField } from "@bugberry/ui/text-field"
import { type FormEvent, useEffect, useState } from "react"
import { type AiKeyStorage, keyHint } from "../../lib/ai/ai-key"
import type { AiTestReply } from "../../lib/ai/ai-relay"

const card = "flex flex-col gap-3 rounded-xl border border-border bg-overlay p-4"

/** Write with AI on the reporter's own key, used instead of the workspace's; a provider on localhost works too. */
export function AiKeySection({
  storage,
  test,
  disabled,
}: {
  storage: AiKeyStorage
  /** Asks the background to try the key; the provider comes back tidied when it works. */
  test(provider: ProviderConfig): Promise<AiTestReply>
  /** While something covers the settings over a page, the buttons don't work. */
  disabled: boolean
}) {
  const [saved, setSaved] = useState<ProviderConfig | null>(null)
  const [preset, setPreset] = useState<"openai" | "custom">("openai")
  const [baseUrl, setBaseUrl] = useState("")
  const [model, setModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void storage.get().then((stored) => {
      setSaved(stored)
      if (!stored) return
      setPreset(stored.preset)
      setBaseUrl(stored.preset === "custom" ? stored.baseUrl : "")
      setModel(stored.model)
    })
  }, [storage])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (disabled) return
    if (preset === "custom" && !baseUrl.trim()) return setError("Enter the provider's base URL")
    if (!model.trim()) return setError("Enter the model, for example gpt-4.1-mini")
    // The saved key only goes back to the address it was saved for.
    const sameAddress = saved?.preset === preset && (preset === "openai" || saved.baseUrl === baseUrl.trim().replace(/\/+$/, ""))
    if (!apiKey.trim() && saved && !sameAddress) return setError("Enter the API key again for a new provider address")
    const key = apiKey.trim() || saved?.apiKey || ""
    // A local server (Ollama, say) takes no key; OpenAI always does.
    if (!key && preset === "openai") return setError("Enter the API key")
    setError(null)
    setBusy(true)
    try {
      const reply = await test({ preset, baseUrl: preset === "custom" ? baseUrl.trim() : "", model: model.trim(), apiKey: key })
      if (!reply.ok) return setError(reply.error)
      await storage.set(reply.provider)
      setSaved(reply.provider)
      setApiKey("")
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    await storage.clear()
    setSaved(null)
    setApiKey("")
  }

  return (
    <form onSubmit={(event) => void save(event)} className={card}>
      <h2 className="text-sm font-semibold">Write with AI (personal key)</h2>
      <p className="text-sm text-muted-foreground">
        Used instead of your workspace's key. It stays in this browser and goes only to your AI provider. Any OpenAI-compatible server works,
        including one on localhost.
      </p>
      <RadioGroup aria-label="AI provider" value={preset} onChange={(value) => setPreset(value as "openai" | "custom")} className="flex flex-col gap-2">
        <RadioField value="openai">
          <Radio>OpenAI</Radio>
        </RadioField>
        <RadioField value="custom">
          <Radio>OpenAI-compatible</Radio>
        </RadioField>
      </RadioGroup>
      {preset === "custom" && (
        <TextField value={baseUrl} onChange={setBaseUrl}>
          <Label>Base URL</Label>
          <Input placeholder="http://localhost:11434/v1" className="font-mono" />
        </TextField>
      )}
      <TextField value={model} onChange={setModel}>
        <Label>Model</Label>
        <Input placeholder="gpt-4.1-mini" className="font-mono" />
      </TextField>
      <TextField type="password" value={apiKey} onChange={setApiKey}>
        <Label>API key</Label>
        <Input
          placeholder={saved?.apiKey ? "Leave empty to keep the saved key" : preset === "custom" ? "Optional for a local server" : "sk-…"}
          className="font-mono"
          autoComplete="off"
        />
      </TextField>
      {saved?.apiKey && (
        <p className="text-sm">
          Saved key: <span className="font-mono">{keyHint(saved.apiKey)}</span>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" type="submit" isPending={busy} isDisabled={disabled}>
          Test and save
        </Button>
        {saved && (
          <Button size="sm" intent="outline" isDisabled={disabled} onPress={() => void remove()}>
            Remove
          </Button>
        )}
      </div>
    </form>
  )
}
