import type { StoredRecording } from "./session"

/** Sends a stopped recording through createUpload's link. Written in the next task; refused until then. */
export async function submitRecording(_recording: StoredRecording, _uploadLink: string, _opts: { server: string }): Promise<{ reportUrl: string }> {
  throw new Error("Sending recordings is not ready yet.")
}
