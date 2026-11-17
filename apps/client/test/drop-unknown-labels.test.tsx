import { expect, mock, test } from "bun:test"
import { renderHook } from "@testing-library/react"
import { useDropUnknownLabels } from "../src/features/reports/list/ReportsBrowser"

const bug = { id: "a", name: "Bug", color: "red" as const }

test("a deleted label leaves the URL without a new history entry", () => {
  const setSearch = mock()
  renderHook(() => useDropUnknownLabels({ label: ["a", "gone"] }, [bug], setSearch))
  expect(setSearch).toHaveBeenCalledTimes(1)
  const [update, options] = setSearch.mock.calls[0] as [(prev: object) => { label?: string[] }, { replace?: boolean }]
  expect(options).toEqual({ replace: true })
  expect(update({ label: ["a", "gone"] }).label).toEqual(["a"])
})

test("nothing to drop: the URL stays as it is", () => {
  const setSearch = mock()
  renderHook(() => useDropUnknownLabels({ label: ["a"] }, [bug], setSearch))
  renderHook(() => useDropUnknownLabels({ label: ["a"] }, undefined, setSearch))
  expect(setSearch).not.toHaveBeenCalled()
})

test("while the labels are being fetched again, nothing is dropped", () => {
  const setSearch = mock()
  renderHook(() => useDropUnknownLabels({ label: ["a", "new"] }, [bug], setSearch, true))
  expect(setSearch).not.toHaveBeenCalled()
})
