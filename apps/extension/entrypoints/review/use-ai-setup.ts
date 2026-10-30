import { useCallback, useEffect, useMemo, useState } from "react"
import { browserAiKeyStorage } from "../../lib/ai/browser-ai-key"
import { type AiSetup, ApiError, type BugberryApi } from "../../lib/server/api"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage } from "../../lib/server/browser-settings"
import { loadSettings, type Settings } from "../../lib/server/settings"
import { latestOnly } from "../../lib/shared/latest"

/** The selected workspace's AI settings; `setup` is null on an older server or when loading failed (`error`). */
export type AiLoad = { workspaceId: string; setup: AiSetup | null; error: string | null }

/** Write with AI: the selected workspace's setup (null on older servers), and whether this browser has its own key. */
export function useAiSetup(apiOf: (settings: Settings) => BugberryApi) {
  const [aiSetup, setAiSetup] = useState<AiLoad | null>(null)
  const [personalKey, setPersonalKey] = useState(false)
  const [serverUrl, setServerUrl] = useState<string | null>(null)

  // A slow answer for a workspace the reporter has since left must not land: its key and templates would be used.
  const takeAiSetup = useMemo(() => latestOnly<AiLoad | null>(setAiSetup), [])
  const loadAi = useCallback(
    (workspaceId: string | null) =>
      takeAiSetup(
        (async () => {
          const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
          setServerUrl(settings?.serverUrl ?? null)
          if (!settings || !workspaceId) return null
          try {
            return { workspaceId, setup: await apiOf(settings).aiSetup(workspaceId), error: null }
          } catch (cause) {
            // An older server has no AI routes (404): only a personal key works then. Anything else is an error.
            if (cause instanceof ApiError && cause.status === 404) return { workspaceId, setup: null, error: null }
            return { workspaceId, setup: null, error: "Couldn't load the AI settings." }
          }
        })(),
      ),
    [takeAiSetup],
  )

  useEffect(() => {
    void browserAiKeyStorage.get().then((key) => setPersonalKey(key !== null))
  }, [])

  return { aiSetup, personalKey, serverUrl, loadAi }
}
