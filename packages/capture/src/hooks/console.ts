import { callSite, currentStack, type StackOf } from "../callsite"
import { CONSOLE_LEVELS, type ConsoleLevel, type Emit, type Uninstall } from "../events"
import { MAX_CONSOLE_ARGS, MAX_STACK_CHARS } from "../limits"
import { createPatcher, installOrUndo } from "../patch"
import { safely } from "../safe"
import { truncate } from "../sanitize"
import { stringifyArg } from "../serialize"

export type ConsoleLike = Record<ConsoleLevel, (...args: unknown[]) => void>

/** Each argument is already cut to MAX_ARG_CHARS; this caps how many there are. */
function describeArgs(args: unknown[]): string[] {
  const kept = args.slice(0, MAX_CONSOLE_ARGS).map(stringifyArg)
  const left = args.length - MAX_CONSOLE_ARGS
  return left > 0 ? [...kept, `…[${left} more arguments]`] : kept
}

export function installConsoleHook(target: ConsoleLike, emit: Emit, now: () => number, stackOf: StackOf = currentStack): Uninstall {
  const patcher = createPatcher()
  installOrUndo(() => {
    for (const level of CONSOLE_LEVELS) {
      const original = target[level]
      if (typeof original !== "function") continue
      patcher.replace(target, level, function (this: unknown, ...args: unknown[]) {
      safely(() => {
        const error = args.find((arg): arg is Error => arg instanceof Error)
        const source = callSite(stackOf())
        emit({
          kind: "console",
          t: now(),
          level,
          args: describeArgs(args),
          ...(error?.stack ? { stack: truncate(error.stack, MAX_STACK_CHARS) } : {}),
          ...(source ? { source } : {}),
        })
      })
      return original.apply(this, args)
      })
    }
  }, patcher.restore)

  return patcher.restore
}
