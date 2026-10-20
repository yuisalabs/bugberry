import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { RequestDetail } from "../src/components/debugger/RequestDetail"
import { normalizePayload } from "@bugberry/debugger-view"
import { networkRows, prettyBody } from "@bugberry/debugger-view"

describe("prettyBody", () => {
  test("JSON objects and arrays are indented by two spaces", () => {
    expect(prettyBody('{"id":"p1","tags":["a"],"n":2}')).toBe('{\n  "id": "p1",\n  "tags": [\n    "a"\n  ],\n  "n": 2\n}')
    expect(prettyBody('[{"id":1}]')).toBe('[\n  {\n    "id": 1\n  }\n]')
  })

  test("a JSON body cut short when it was recorded is still laid out, up to the cut", () => {
    expect(prettyBody('{"a":{"b":[1,{}],"c":"x, {y}"},"de…[truncated 120 chars]')).toBe(
      '{\n  "a": {\n    "b": [\n      1,\n      {}\n    ],\n    "c": "x, {y}"\n  },\n  "de…[truncated 120 chars]',
    )
    expect(prettyBody('[{"q":"say \\"hi\\""},2]…[truncated 5 chars]')).toBe('[\n  {\n    "q": "say \\"hi\\""\n  },\n  2\n]…[truncated 5 chars]')
  })

  test("anything else is left exactly as recorded", () => {
    // Plain text, a bare JSON value, broken JSON that was not cut, and form data.
    for (const body of ["hello", "42", '"text"', '{"id":"p1","na', "a=1&b=2"]) expect(prettyBody(body)).toBe(body)
  })
})

const row = () => {
  const { events } = normalizePayload({
    events: [
      {
        kind: "network",
        t: 1000,
        method: "POST",
        url: "https://app.kantor.test/api/projects",
        status: 200,
        requestBody: '{"name":"Test"}',
        responseBody: '[{"id":"p1","name":"Test"}]',
      },
    ],
  })
  const found = networkRows(events)[0]
  if (!found) throw new Error("no row")
  return found
}

describe("RequestDetail bodies", () => {
  test("the response is shown pretty-printed, one line per row", () => {
    render(<RequestDetail row={row()} base={1000} playback={null} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("tab", { name: "Response" }))
    expect(screen.getByText('"id": "p1",')).toBeTruthy()
    expect(screen.getByText('"name": "Test"')).toBeTruthy()
  })

  test("Copy puts the body on the clipboard, pretty-printed as shown", async () => {
    const writeText = mock(async (_text: string) => {})
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    render(<RequestDetail row={row()} base={1000} playback={null} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("tab", { name: "Payload" }))
    fireEvent.click(screen.getByRole("button", { name: "Copy payload" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{\n  "name": "Test"\n}'))
    fireEvent.click(screen.getByRole("tab", { name: "Response" }))
    fireEvent.click(screen.getByRole("button", { name: "Copy response" }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('[\n  {\n    "id": "p1",\n    "name": "Test"\n  }\n]'))
  })

  test("no Copy button when there is no body", () => {
    const empty = { ...row(), request: { ...row().request!, requestBody: null } }
    render(<RequestDetail row={empty} base={1000} playback={null} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("tab", { name: "Payload" }))
    expect(screen.getByText("This request sent no body.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Copy payload" })).toBeNull()
  })
})
