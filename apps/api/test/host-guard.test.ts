import { describe, expect, test } from "bun:test"
import { createHostGuard } from "../src/lib/net/host-guard"

const resolvingTo = (...addresses: string[]) => async () => addresses
const guard = (lookup = resolvingTo("140.82.112.3")) => createHostGuard({ allowPrivate: false, lookup })

describe("host guard", () => {
  test("refuses private, loopback and link-local addresses", async () => {
    for (const url of [
      "https://10.1.2.3/api",
      "http://127.0.0.1:3000/",
      "http://169.254.169.254/latest/meta-data",
      "https://192.168.1.1/",
      "https://172.20.0.4/",
      "https://100.64.1.1/",
      "http://[::1]/",
      "https://[fd00::1]/",
      "https://[fe80::1]/",
      "https://[::ffff:10.0.0.1]/",
      "https://0.0.0.0/",
    ]) {
      await expect(guard()(url)).rejects.toThrow("private network")
    }
  })

  test("refuses a public-looking name that resolves to a private address", async () => {
    await expect(guard(resolvingTo("10.0.0.5"))("https://gitlab.kantor.com/")).rejects.toThrow("private network")
    await expect(guard(resolvingTo("140.82.112.3", "127.0.0.1"))("https://mixed.kantor.com/")).rejects.toThrow("private network")
  })

  test("allows public addresses", async () => {
    await expect(guard()("https://gitlab.com/api/v4")).resolves.toBeUndefined()
    await expect(guard()("https://140.82.112.3/")).resolves.toBeUndefined()
  })

  test("a name that does not resolve is reported plainly", async () => {
    const failing = createHostGuard({ allowPrivate: false, lookup: async () => Promise.reject(new Error("ENOTFOUND")) })
    await expect(failing("https://nowhere.kantor.test/")).rejects.toThrow("could not be found")
  })

  test("allows everything when the operator allows private hosts", async () => {
    const open = createHostGuard({ allowPrivate: true, lookup: resolvingTo("10.0.0.5") })
    await expect(open("https://gitlab.internal/")).resolves.toBeUndefined()
    await expect(open("http://127.0.0.1:8080/")).resolves.toBeUndefined()
  })
})
