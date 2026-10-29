import type { Config } from "./config"
import type { Db } from "./db/client"
import type { EmailSender } from "./email/sender"
import type { AccountFactory } from "./lib/integrations/accounts"
import type { NotifierFactory } from "./lib/notifiers/channels"
import type { TrackerFactory } from "./lib/trackers/providers"
import type { Auth } from "./modules/auth/better-auth"
import type { StorageDriver } from "./storage/types"

export interface AppDeps {
  config: Config
  db: Db
  storage: StorageDriver
  betterAuth: Auth
  /** Builds tracker clients; tests pass a fake, production uses real HTTP. */
  trackers?: TrackerFactory
  /** Checks connection accounts and lists their targets; tests pass a fake. */
  accounts?: AccountFactory
  /** Builds notification channel clients (Slack, Discord, Telegram, webhook); tests pass a fake. */
  notifiers?: NotifierFactory
  /** Sends invitation emails; tests pass a fake. Defaults to the configured driver. */
  email?: EmailSender | null
  /** Receives work started in the background (auto-send after finalize); tests use it to wait for it. */
  background?: (task: Promise<unknown>) => void
  /** Calls AI providers for Write with AI; tests pass a fake. */
  aiFetch?: typeof fetch
  /** Resolves AI provider hosts for the host guard; tests pass a fake. */
  aiLookup?: (host: string) => Promise<string[]>
}
