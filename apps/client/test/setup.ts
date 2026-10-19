import { afterEach } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

// happy-dom replaces these with its own versions; Eden, fetch fakes and gzip decoding need Bun's.
const KEEP_NATIVE = [
  "fetch",
  "Request",
  "Response",
  "Headers",
  "Blob",
  "File",
  "FormData",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "CompressionStream",
  "DecompressionStream",
  "TextEncoder",
  "TextDecoder",
  "AbortController",
  "AbortSignal",
  "URL",
  "URLSearchParams",
  "crypto",
] as const

const native = KEEP_NATIVE.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
GlobalRegistrator.register({ url: "http://localhost:3000/" })
for (const [name, descriptor] of native) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor)
}
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Loaded after the DOM exists, so Testing Library binds `screen` to happy-dom's document.
const { cleanup } = await import("@testing-library/react")
afterEach(cleanup)
