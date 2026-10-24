import { describe, expect, test } from "bun:test"
import {
  isOffscreenMessage,
  isPageFlush,
  isPageStart,
  isRecordingEndedNotice,
  isRecordStartRequest,
  isRecordStatusRequest,
  isBarRequest,
  isReviewAgainRequest,
  isScreenshotRequest, isRecorderReadyNotice, isPopupRecordingRequest, isCameraTicketRequest, isPageUiMessage, isPopupPromptRequest } from "../lib/messages"

describe("messages", () => {
  test("background requests are recognised by type and shape", () => {
    expect(isScreenshotRequest({ type: "bugberry:screenshot", tabId: 7, mode: "area" })).toBe(true)
    expect(isScreenshotRequest({ type: "bugberry:screenshot", tabId: 7, mode: "full" })).toBe(false)
    expect(isRecordStartRequest({ type: "bugberry:record-start", tabId: 7 })).toBe(true)
    expect(isRecordStartRequest({ type: "bugberry:record-start", tabId: "7" })).toBe(false)
    const options = { source: "screen", mic: true, systemAudio: false, countdown: true }
    expect(isRecordStartRequest({ type: "bugberry:record-start", tabId: 7, options })).toBe(true)
    expect(isRecordStartRequest({ type: "bugberry:record-start", tabId: 7, options: { ...options, source: "desktop" } })).toBe(false)
    expect(isRecordStartRequest({ type: "bugberry:record-start", tabId: 7, options: { ...options, mic: "yes" } })).toBe(false)
    for (const micDeviceId of [undefined, null, "abc"]) {
      expect(isRecordStartRequest({ type: "bugberry:record-start", tabId: 7, options: { ...options, micDeviceId } })).toBe(true)
    }
    expect(isRecordStartRequest({ type: "bugberry:record-start", tabId: 7, options: { ...options, micDeviceId: 5 } })).toBe(false)
    for (const camera of [undefined, null, { deviceId: null, shape: "circle" }, { deviceId: "cam1", shape: "rectangle" }]) {
      expect(isRecordStartRequest({ type: "bugberry:record-start", tabId: 7, options: { ...options, camera } })).toBe(true)
    }
    for (const camera of [{ deviceId: 1, shape: "circle" }, { deviceId: null, shape: "oval" }, "on"]) {
      expect(isRecordStartRequest({ type: "bugberry:record-start", tabId: 7, options: { ...options, camera } })).toBe(false)
    }
    expect(isRecordStatusRequest({ type: "bugberry:record-status" })).toBe(true)
    expect(isRecordingEndedNotice({ type: "bugberry:recording-ended", reason: "max-duration" })).toBe(true)
  })

  test("the camera bubble asks with its token, to read or to say it's ready", () => {
    expect(isCameraTicketRequest({ type: "bugberry:camera-ticket", token: "t", action: "read" })).toBe(true)
    expect(isCameraTicketRequest({ type: "bugberry:camera-ticket", token: "t", action: "ready" })).toBe(true)
    expect(isCameraTicketRequest({ type: "bugberry:camera-ticket", token: "t", action: "failed" })).toBe(true)
    expect(isCameraTicketRequest({ type: "bugberry:camera-ticket", token: 1, action: "read" })).toBe(false)
    expect(isCameraTicketRequest({ type: "bugberry:camera-ticket", token: "t", action: "start" })).toBe(false)
  })

  test("the page layer is told to show or take away the camera bubble", () => {
    expect(isPageUiMessage({ type: "bugberry:ui-camera", on: true, token: "t", shape: "circle" })).toBe(true)
    expect(isPageUiMessage({ type: "bugberry:ui-camera", on: false })).toBe(true)
    expect(isPageUiMessage({ type: "bugberry:ui-camera", on: true, token: 1, shape: "circle" })).toBe(false)
    expect(isPageUiMessage({ type: "bugberry:ui-camera", on: true, token: "t", shape: "oval" })).toBe(false)
  })

  test("the popup may ask for the camera over the page, like the microphone", () => {
    expect(isPopupPromptRequest({ type: "bugberry:popup-prompt", page: "camera", tabId: 1 })).toBe(true)
    expect(isPageUiMessage({ type: "bugberry:ui-prompt", page: "camera", token: "t" })).toBe(true)
  })

  test("a page flush carries its document id, events and incomplete names", () => {
    expect(isPageFlush({ type: "bugberry:page-flush", documentId: "d1", events: [], incomplete: [] })).toBe(true)
    expect(isPageFlush({ type: "bugberry:page-flush", documentId: 3, events: [], incomplete: [] })).toBe(false)
    expect(isPageFlush({ type: "bugberry:page-flush", documentId: "d1", events: "x", incomplete: [] })).toBe(false)
    expect(isPageStart({ type: "bugberry:page-start" })).toBe(true)
    expect(isPageStart({ type: "bugberry:record-status" })).toBe(false)
  })

  test("offscreen messages need their ids, a known source and a budget", () => {
    const tab = { kind: "tab", streamId: "s" }
    const screen = { kind: "display", surface: "monitor", systemAudio: true }
    const start = { type: "bugberry:offscreen-open", draftId: "d", mic: false, micDeviceId: null, maxBytes: 1000 }
    expect(isOffscreenMessage({ ...start, capture: tab })).toBe(true)
    expect(isOffscreenMessage({ ...start, capture: screen })).toBe(true)
    expect(isOffscreenMessage({ ...start, capture: { kind: "x" } })).toBe(false)
    expect(isOffscreenMessage({ ...start, capture: { kind: "display", surface: "tab", systemAudio: true } })).toBe(false)
    expect(isOffscreenMessage({ ...start, capture: tab, maxBytes: undefined })).toBe(false)
    expect(isOffscreenMessage({ ...start, capture: tab, micDeviceId: "abc" })).toBe(true)
    expect(isOffscreenMessage({ ...start, capture: tab, micDeviceId: undefined })).toBe(false)
    expect(isOffscreenMessage({ type: "bugberry:offscreen-start", draftId: "d", capture: tab, mic: false, maxBytes: 1 })).toBe(false)
    for (const type of ["begin", "pause", "resume", "restart", "discard", "stop"]) {
      expect(isOffscreenMessage({ type: `bugberry:offscreen-${type}` })).toBe(true)
    }
    expect(isOffscreenMessage({ type: "bugberry:offscreen-mic", on: true })).toBe(true)
    expect(isOffscreenMessage({ type: "bugberry:offscreen-mic" })).toBe(false)
    expect(isOffscreenMessage({ type: "bugberry:offscreen-stop" })).toBe(true)
    expect(isOffscreenMessage({ type: "bugberry:record-stop" })).toBe(false)
  })
})

test("the popup's recording requests name a known action", () => {
  for (const action of ["status", "pause", "resume", "restart", "discard", "stop"]) {
    expect(isPopupRecordingRequest({ type: "bugberry:popup-recording", action })).toBe(true)
  }
  expect(isPopupRecordingRequest({ type: "bugberry:popup-recording", action: "bogus" })).toBe(false)
  expect(isPopupRecordingRequest({ type: "bugberry:popup-recording" })).toBe(false)
})

test("the bar's and the drawing layer's requests name their recording", () => {
  const session = "d1"
  for (const type of ["bar-status", "record-pause", "record-resume", "record-restart", "record-discard", "bar-stop"]) {
    expect(isBarRequest({ type: `bugberry:${type}`, session })).toBe(true)
    expect(isBarRequest({ type: `bugberry:${type}` })).toBe(false)
  }
  expect(isBarRequest({ type: "bugberry:me-name" })).toBe(true)
  expect(isBarRequest({ type: "bugberry:record-mic", on: false, session })).toBe(true)
  expect(isBarRequest({ type: "bugberry:record-mic", on: "no", session })).toBe(false)
  expect(isBarRequest({ type: "bugberry:record-note", text: "Spins forever", session })).toBe(true)
  expect(isBarRequest({ type: "bugberry:record-note", session })).toBe(false)
})

test("Record again names its draft", () => {
  expect(isReviewAgainRequest({ type: "bugberry:review-again", draftId: "d1" })).toBe(true)
  expect(isReviewAgainRequest({ type: "bugberry:review-again" })).toBe(false)
})

test("the recorder window's ready notice", () => {
  expect(isRecorderReadyNotice({ type: "bugberry:recorder-ready" })).toBe(true)
  expect(isRecorderReadyNotice({ type: "bugberry:recorder-gone" })).toBe(false)
  expect(isRecorderReadyNotice(null)).toBe(false)
})
