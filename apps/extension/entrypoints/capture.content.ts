import { startCapture } from "@bugberry/capture"

/** Records console, errors, network and actions from the moment the page starts loading. */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "MAIN",
  allFrames: false,
  main() {
    startCapture()
  },
})
