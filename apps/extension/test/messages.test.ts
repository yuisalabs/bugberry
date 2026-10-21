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
  isScreenshotRequest, isRecorderReadyNotice, isPopupRecordingRequest } from "../lib/messages"

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
    expect(isRecordStatusRequest({ type: "bugberry:record-status" })).toBe(true)
    expect(isRecordingEndedNotice({ type: "bugberry:recording-ended", reason: "max-duration" })).toBe(true)
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
