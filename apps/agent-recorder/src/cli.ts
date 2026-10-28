#!/usr/bin/env node
import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { Page } from "playwright-core"
import { type BrowserSession, launchBrowser } from "./browser"
import { deleteDraft, readDraft, startTabRecording, stopTabRecording } from "./extension"
import { recordingCaps } from "./limits"
import { parseOptions } from "./options"
import { createRecorderServer } from "./server"
import { createRecorderSession, type RecorderBrowser } from "./session"
import { submitRecording } from "./upload"

const options = parseOptions(process.argv.slice(2), {
  platform: process.platform,
  home: homedir(),
  localAppData: process.env.LOCALAPPDATA,
  xdgDataHome: process.env.XDG_DATA_HOME,
})
/** The published package carries the recorder build of the extension next to dist/. */
const extensionDir = fileURLToPath(new URL("../extension", import.meta.url))

type Browser = RecorderBrowser<Page> & { session: BrowserSession }
const sessionOf = (browser: RecorderBrowser<Page>) => (browser as Browser).session

const session = createRecorderSession<Page>({
  cdpEndpoint: `http://127.0.0.1:${options.port}`,
  tempDir: mkdtempSync(join(tmpdir(), "bugberry-recorder-")),
  launch: async () => {
    const launched = await launchBrowser(options, extensionDir)
    let open = true
    launched.context.on("close", () => {
      open = false
    })
    return { session: launched, context: launched.context, isOpen: () => open, close: launched.close } satisfies Browser
  },
  caps: () => recordingCaps(options.server),
  start: (browser, page, caps) => startTabRecording(sessionOf(browser), page, caps),
  stop: (browser) => stopTabRecording(sessionOf(browser)),
  read: (browser, draftId) => readDraft(sessionOf(browser), draftId),
  remove: (browser, draftId) => deleteDraft(sessionOf(browser), draftId),
})

const server = createRecorderServer(session, (recording, uploadLink) => submitRecording(recording, uploadLink, { server: options.server }))
await server.connect(new StdioServerTransport())
