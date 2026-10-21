import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"

/** Checks an address before the server calls it; throws HostGuardError when it may not. */
export type HostGuard = (url: string) => Promise<void>

export class HostGuardError extends Error {
  override name = "HostGuardError"
}

export const PRIVATE_HOST_MESSAGE =
  "The address points to a private network; ask your server admin to allow private integration hosts"

/** For tests with a fake fetch: allows every address. */
export const NO_GUARD: HostGuard = async () => {}

/** IPv4 ranges a shared server must not reach for someone else: private, loopback, link-local, carrier NAT and the like. */
const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]

function v4ToNumber(address: string): number {
  return address.split(".").reduce((value, part) => value * 256 + Number(part), 0)
}

function isPrivateV4(address: string): boolean {
  const value = v4ToNumber(address)
  return PRIVATE_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits)
    const start = v4ToNumber(base)
    return value >= start && value < start + size
  })
}

/** An IPv6 address as its eight 16-bit groups (an embedded IPv4 tail becomes the last two). */
function v6Groups(address: string): number[] {
  let text = address.toLowerCase()
  const v4Tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (v4Tail) {
    const value = v4ToNumber(v4Tail)
    text = `${text.slice(0, -v4Tail.length)}${Math.floor(value / 65536).toString(16)}:${(value % 65536).toString(16)}`
  }
  const [head = "", tail] = text.split("::")
  const left = head ? head.split(":") : []
  const right = tail ? tail.split(":") : []
  const missing = tail === undefined ? 0 : 8 - left.length - right.length
  return [...left, ...Array(missing).fill("0"), ...right].map((group) => Number.parseInt(group || "0", 16))
}

/** The IPv4 address held in two 16-bit groups. */
function v4From(high = 0, low = 0): string {
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

function isPrivateV6(address: string): boolean {
  const groups = v6Groups(address)
  const [first = 0, second = 0] = groups
  const zeros = (from: number, to: number) => groups.slice(from, to).every((group) => group === 0)
  // ::a.b.c.d (IPv4-compatible, which also covers :: and ::1) and ::ffff:a.b.c.d (IPv4-mapped).
  if (zeros(0, 6) || (zeros(0, 5) && groups[5] === 0xffff)) return isPrivateV4(v4From(groups[6], groups[7]))
  // 64:ff9b::a.b.c.d (NAT64) and 2002:aabb:ccdd:: (6to4) reach the IPv4 address inside them.
  if (first === 0x64 && second === 0xff9b && zeros(2, 6)) return isPrivateV4(v4From(groups[6], groups[7]))
  if (first === 0x2002) return isPrivateV4(v4From(groups[1], groups[2]))
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7, unique local
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10, link-local
  if ((first & 0xffc0) === 0xfec0) return true // fec0::/10, the old site-local
  if ((first & 0xff00) === 0xff00) return true // ff00::/8, multicast
  return false
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isPrivateV4(address)
  if (version === 6) return isPrivateV6(address)
  return true
}

/**
 * Refuses addresses on private networks unless the server's operator allows them (ALLOW_PRIVATE_INTEGRATION_HOSTS).
 * A hostname is looked up first, so a public-looking name that points inside is refused too. Checked before every
 * request and every redirect hop; the connection itself is not pinned to the checked address.
 */
export function createHostGuard(opts: { allowPrivate: boolean; lookup?: (host: string) => Promise<string[]> }): HostGuard {
  const lookup =
    opts.lookup ?? (async (host: string) => (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => entry.address))
  return async (url) => {
    if (opts.allowPrivate) return
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "")
    let addresses: string[]
    if (isIP(host)) {
      addresses = [host]
    } else {
      try {
        addresses = await lookup(host)
      } catch {
        throw new HostGuardError(`${host} could not be found`)
      }
    }
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new HostGuardError(PRIVATE_HOST_MESSAGE)
  }
}
