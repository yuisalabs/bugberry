import type { Config } from "./config"

/** Room for headers and multipart framing on top of the largest allowed upload body. */
const REQUEST_OVERHEAD_BYTES = 1024 * 1024

/** Options for `app.listen()`. Bun rejects bodies over 128 MiB unless told otherwise. */
export function serveOptions(config: Config) {
  return {
    port: config.port,
    maxRequestBodySize: config.maxUploadBytes + REQUEST_OVERHEAD_BYTES,
  }
}
