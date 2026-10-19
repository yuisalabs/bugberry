import { describe, expect, test } from "bun:test"
import { githubUserInfo, gitlabUserInfo, pickGithubEmail } from "../src/auth/identity"

const fakeFetch = (answers: Record<string, unknown>) => {
  const seen: string[] = []
  const fetcher = (async (url: string) => {
    seen.push(url)
    return Response.json(answers[url] ?? null, { status: url in answers ? 200 : 404 })
  }) as unknown as typeof fetch
  return { fetcher, seen }
}

describe("pickGithubEmail", () => {
  test("pickGithubEmail prefers a verified address in an allowed domain", () => {
    const emails = [
      { email: "dev@gmail.com", primary: true, verified: true },
      { email: "dev@kantor.com", primary: false, verified: true },
      { email: "old@kantor.com", primary: false, verified: false },
    ]
    expect(pickGithubEmail(emails, ["kantor.com"])).toEqual({ email: "dev@kantor.com", verified: true })
    expect(pickGithubEmail(emails, ["other.com"])).toEqual({ email: "dev@gmail.com", verified: true })
    expect(pickGithubEmail([{ email: "x@kantor.com", primary: true, verified: false }], ["kantor.com"])).toBeNull()
  })
})

describe("pickGithubEmail with open sign-up", () => {
  test("no domain list means the primary verified address", () => {
    const emails = [
      { email: "Work@Kantor.com", verified: true, primary: false },
      { email: "Me@Gmail.com", verified: true, primary: true },
    ]
    expect(pickGithubEmail(emails, [])).toEqual({ email: "me@gmail.com", verified: true })
  })
})

describe("githubUserInfo", () => {
  test("uses the profile and the email the rules pick", async () => {
    const { fetcher, seen } = fakeFetch({
      "https://api.github.com/user": { id: 7, login: "ana", name: "Ana", avatar_url: "https://a/x.png", email: "ana@gmail.com" },
      "https://api.github.com/user/emails": [
        { email: "ana@gmail.com", primary: true, verified: true },
        { email: "ana@kantor.com", primary: false, verified: true },
      ],
    })
    const info = await githubUserInfo({ accessToken: "t" }, ["kantor.com"], fetcher)
    expect(seen).toEqual(["https://api.github.com/user", "https://api.github.com/user/emails"])
    expect(info?.user).toEqual({ name: "Ana", email: "ana@kantor.com", image: "https://a/x.png", emailVerified: true })
    expect(info?.data.id).toBe("7")
  })

  test("an account without a verified email is reported as unverified, so sign-in can say why", async () => {
    const { fetcher } = fakeFetch({
      "https://api.github.com/user": { id: 7, login: "ana", name: null, avatar_url: null, email: null },
      "https://api.github.com/user/emails": [{ email: "ana@kantor.com", primary: true, verified: false }],
    })
    const info = await githubUserInfo({ accessToken: "t" }, ["kantor.com"], fetcher)
    expect(info?.user).toMatchObject({ email: "ana@kantor.com", emailVerified: false })
  })
})

describe("gitlabUserInfo", () => {
  test("gitlabUserInfo reads the OIDC userinfo of the configured GitLab", async () => {
    const { fetcher, seen } = fakeFetch({
      "https://gitlab.kantor.com/oauth/userinfo": {
        sub: "42",
        name: "Ana",
        email: "ana@kantor.com",
        email_verified: true,
        picture: "https://g/a.png",
      },
    })
    const info = await gitlabUserInfo({ accessToken: "t" }, "https://gitlab.kantor.com", fetcher)
    expect(seen).toEqual(["https://gitlab.kantor.com/oauth/userinfo"])
    expect(info?.user).toEqual({ name: "Ana", email: "ana@kantor.com", image: "https://g/a.png", emailVerified: true })
    expect(info?.data.id).toBe("42")
  })
})
