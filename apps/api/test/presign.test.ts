import { describe, expect, test } from "bun:test"
import { presignUrl } from "../src/storage/presign"

describe("presignUrl (AWS Signature Version 4, query string)", () => {
  test("matches the example in the AWS S3 documentation", () => {
    const url = presignUrl({
      method: "GET",
      endpoint: "https://s3.amazonaws.com",
      bucket: "examplebucket",
      key: "test.txt",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      virtualHostedStyle: true,
      expiresIn: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    })
    const parsed = new URL(url)
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://examplebucket.s3.amazonaws.com/test.txt")
    expect(parsed.searchParams.get("X-Amz-Credential")).toBe("AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request")
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe("host")
    expect(parsed.searchParams.get("X-Amz-Signature")).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    )
  })

  test("signs extra headers, sorted, and uses path-style URLs when asked", () => {
    const url = new URL(
      presignUrl({
        method: "PUT",
        endpoint: "http://localhost:9000",
        bucket: "fdebag",
        key: "reports/r1/media.png",
        region: "us-east-1",
        accessKeyId: "AK",
        secretAccessKey: "SK",
        virtualHostedStyle: false,
        expiresIn: 600,
        headers: { "content-type": "image/png", "content-length": "3" },
        now: new Date("2026-10-16T00:00:00Z"),
      }),
    )
    expect(`${url.origin}${url.pathname}`).toBe("http://localhost:9000/fdebag/reports/r1/media.png")
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host")
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600")
  })

  test("signs the query parameters that pick an operation, and requests on the bucket itself", () => {
    const base = {
      endpoint: "http://localhost:9000",
      bucket: "fdebag",
      region: "us-east-1",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      expiresIn: 600,
      now: new Date("2026-10-16T00:00:00Z"),
    }
    const part = new URL(
      presignUrl({ ...base, method: "PUT", key: "reports/r1/media.webm", virtualHostedStyle: false, query: { partNumber: "2", uploadId: "a/b+c" } }),
    )
    expect(part.pathname).toBe("/fdebag/reports/r1/media.webm")
    expect([part.searchParams.get("partNumber"), part.searchParams.get("uploadId")]).toEqual(["2", "a/b+c"])
    // A different part number is a different signature: a link for one part can't be used for another.
    const other = new URL(
      presignUrl({ ...base, method: "PUT", key: "reports/r1/media.webm", virtualHostedStyle: false, query: { partNumber: "3", uploadId: "a/b+c" } }),
    )
    expect(other.searchParams.get("X-Amz-Signature")).not.toBe(part.searchParams.get("X-Amz-Signature"))

    const listing = presignUrl({ ...base, method: "GET", key: "", virtualHostedStyle: false, query: { uploads: "" } })
    expect(listing).toStartWith("http://localhost:9000/fdebag?X-Amz-Algorithm=")
    expect(listing).toContain("&uploads=&X-Amz-Signature=")
    const hosted = new URL(presignUrl({ ...base, method: "GET", key: "", virtualHostedStyle: true, query: { uploads: "" } }))
    expect(`${hosted.origin}${hosted.pathname}`).toBe("http://fdebag.localhost:9000/")
  })
})
