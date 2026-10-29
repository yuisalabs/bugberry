import { describe, expect, test } from "bun:test"
import { INITIAL_INTEGRATIONS_UI, integrationsUi } from "../src/features/integrations/integrations-ui"

describe("integrationsUi", () => {
  test("a saved change clears the old connection test result", () => {
    let state = integrationsUi(INITIAL_INTEGRATIONS_UI, { type: "tested", id: "i1", ok: true, message: "Koneksi berhasil" })
    state = integrationsUi(state, { type: "edit", id: "i1" })
    expect(state).toEqual({ editing: "i1", testResult: { id: "i1", ok: true, message: "Koneksi berhasil" } })
    state = integrationsUi(state, { type: "saved" })
    expect(state).toEqual({ editing: null, testResult: null })
  })

  test("cancelling closes the form and keeps the last test result", () => {
    let state = integrationsUi(INITIAL_INTEGRATIONS_UI, { type: "tested", id: "i1", ok: false, message: "Invalid token" })
    state = integrationsUi(integrationsUi(state, { type: "edit", id: "new" }), { type: "cancel" })
    expect(state).toEqual({ editing: null, testResult: { id: "i1", ok: false, message: "Invalid token" } })
  })
})
