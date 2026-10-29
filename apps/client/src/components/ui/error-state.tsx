import { Button } from "@bugberry/ui/button"
import { errorMessage } from "../../lib/query/unwrap"

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-danger-subtle-foreground/20 bg-danger-subtle p-4 text-sm text-danger-subtle-foreground"
    >
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <Button intent="outline" size="sm" onPress={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
