import { describe, expect, test } from "bun:test"
import { cameraAccess, cameraDevices, cameraErrorText } from "../lib/camera"

const video = (deviceId: string, label: string) => ({ kind: "videoinput", deviceId, label })

describe("cameraAccess", () => {
  test("granted and denied pass through; anything else is ask", async () => {
    expect(await cameraAccess(async () => ({ state: "granted" }))).toBe("granted")
    expect(await cameraAccess(async () => ({ state: "denied" }))).toBe("denied")
    expect(await cameraAccess(async () => ({ state: "prompt" }))).toBe("prompt")
    expect(
      await cameraAccess(async () => {
        throw new TypeError("camera isn't a permission name here")
      }),
    ).toBe("prompt")
  })
})

describe("cameraDevices", () => {
  test("only named cameras, without Chrome's default entry or the USB id", () => {
    expect(
      cameraDevices([
        video("default", "Default"),
        video("c1", " Integrated Webcam (0bda:5520) "),
        video("c2", "OBS Virtual Camera"),
        video("c3", ""),
        { kind: "audioinput", deviceId: "m1", label: "Microphone" },
      ]),
    ).toEqual([
      { id: "c1", name: "Integrated Webcam" },
      { id: "c2", name: "OBS Virtual Camera" },
    ])
  })
})

describe("cameraErrorText", () => {
  const error = (name: string) => new DOMException("x", name)
  test("says what to do", () => {
    expect(cameraErrorText(error("NotAllowedError"), "denied")).toBe("Camera is blocked. Allow it for BugBerry in Chrome's site settings.")
    expect(cameraErrorText(error("NotAllowedError"), "granted")).toBe(
      "Your computer's privacy settings block the camera for Chrome. Allow it there, then try again.",
    )
    expect(cameraErrorText(error("NotAllowedError"), "prompt")).toBe("Chrome didn't get an answer. Try again and choose Allow.")
    expect(cameraErrorText(error("NotReadableError"), "granted")).toBe("The camera is in use by another app. Close it there, then try again.")
    expect(cameraErrorText(error("NotFoundError"), "granted")).toBe("No camera was found.")
    expect(cameraErrorText(new Error("?"), "granted")).toBe("The camera couldn't be started. Try again.")
  })
})
