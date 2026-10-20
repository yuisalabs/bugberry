import { describe, expect, test } from "bun:test"
import { applyWebmPatches, planWebmRepair } from "../src/storage/webm-repair"
import { blocks, CLUSTER, chromeOriginal, damaged, element, header, info, SEGMENT, tracks } from "./webm-fixtures"

const bytes = (values: number[]) => new Uint8Array(values)

function repaired(values: number[]): Uint8Array {
  const file = bytes(values)
  const plan = planWebmRepair(file, file.length)
  if (plan.status !== "repair") throw new Error(`expected a repair, got ${plan.status}`)
  return applyWebmPatches(file, plan.patches)
}

describe("planWebmRepair", () => {
  test("gives the Segment and the first Cluster their unknown size back", () => {
    const output = repaired(damaged())

    const segmentAt = header.length
    expect([...output.slice(segmentAt + 4, segmentAt + 7)]).toEqual([0x3f, 0xff, 0xff])
    const clusterAt = output.indexOf(0x1f)
    expect([...output.slice(clusterAt, clusterAt + 7)]).toEqual([...CLUSTER, 0x3f, 0xff, 0xff])
  })

  test("changes only those size fields: same length, every other byte as it was", () => {
    const input = bytes(damaged())
    const output = repaired(damaged())

    expect(output.length).toBe(input.length)
    const changed = [...output.keys()].filter((index) => output[index] !== input[index])
    expect(changed.length).toBeLessThanOrEqual(6)
  })

  test("leaves a file that is already repaired alone", () => {
    const once = repaired(damaged())

    expect(planWebmRepair(once, once.length).status).toBe("ok")
  })

  test("leaves Chrome's own unknown-size layout alone", () => {
    const file = bytes(chromeOriginal())

    expect(planWebmRepair(file, file.length).status).toBe("ok")
  })

  test("leaves properly sized clusters alone", () => {
    const sized = [...element(CLUSTER, blocks(0)), ...element(CLUSTER, blocks(1))]
    const file = bytes([...header, ...element(SEGMENT, [...info(), ...tracks, ...sized])])

    expect(planWebmRepair(file, file.length).status).toBe("ok")
  })

  test("does not touch a file another program wrote", () => {
    const file = bytes(damaged("Lavf61.7.100"))

    expect(planWebmRepair(file, file.length).status).toBe("unrecognized")
  })

  test("does not touch a file whose Segment does not end where the file ends", () => {
    const file = bytes(damaged())

    expect(planWebmRepair(file, file.length + 100).status).toBe("unrecognized")
  })

  test("does not touch something that is not WebM", () => {
    const file = new TextEncoder().encode("not a video at all")

    expect(planWebmRepair(file, file.length).status).toBe("unrecognized")
  })
})
