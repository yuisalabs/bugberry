import { Link } from "@bugberry/ui/link"
import type { ReactNode } from "react"
import { BugBerryLogo } from "../components/BugBerryLogo"

const CONTACT = "yuisalabs@gmail.com"
const UPDATED = "20 October 2026"

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

const list = "flex list-disc flex-col gap-1 pl-5"

/** The policy itself; the Chrome Web Store and addons.mozilla.org link here. */
export function PrivacyPolicy() {
  return (
    <article className="flex flex-col gap-6 text-sm/6 text-muted-foreground">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-bold text-foreground">Privacy Policy</h1>
        <p>Last updated {UPDATED}</p>
      </header>

      <p>
        BugBerry turns a bug on a web page into a report: a screenshot or a recording, with what the page logged and
        what you did before it happened. This policy covers the BugBerry browser extension (Chrome, Opera and
        Firefox) and the BugBerry service at bugberry.yuisalabs.com.
      </p>

      <Section title="What the browser extension collects">
        <p>When you start a report, the extension collects from the tab you report on:</p>
        <ul className={list}>
          <li>A screenshot or a recording of the tab, screen or window you choose, with your microphone if you turn it on.</li>
          <li>The page's address and title, and the pages you open while recording.</li>
          <li>The page's console messages and errors, and its network requests (address, method, status, timing, headers and bodies).</li>
          <li>Your steps on the page: clicks, scrolling, and text typed into fields.</li>
          <li>Your browser, operating system, screen size, language and time zone.</li>
          <li>Your city, only if you turn on "include city" for a report.</li>
          <li>The title, description, notes and drawings you add.</li>
        </ul>
        <p>
          Passwords, card numbers, tokens, cookies and authorization headers are masked before anything is stored.
          Fields a website marks as private are masked too.
        </p>
        <p>
          The page's logs are kept in the page while you browse so a report can show what led to the bug, and they stay
          in your browser. Data leaves your browser only when you send a report, and only to the BugBerry server the
          extension is set to. Drafts you have not sent stay in your browser until you send or delete them.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          When you sign in we keep your name, email address and profile picture from the sign-in provider you choose,
          or your email address if you sign in with a code. A cookie keeps you signed in.
        </p>
      </Section>

      <Section title="How it is used">
        <p>
          Reports are shown to the members of the workspace you send them to, to people you share a report link with,
          and in issue trackers your workspace connects (such as GitHub). Your data is used only to create, show and
          share bug reports.
        </p>
        <p>We do not sell your data, use it for advertising or profiling, or use it to decide credit or lending.</p>
      </Section>

      <Section title="Who else handles it">
        <ul className={list}>
          <li>Our hosting and file storage, where reports are kept.</li>
          <li>Our email provider, to send sign-in codes and invitations.</li>
          <li>The sign-in provider you choose, and the issue trackers your workspace connects.</li>
        </ul>
        <p>
          If your extension sends to a BugBerry server run by your company or someone else, that server keeps your
          reports and its owner's policy applies to them.
        </p>
      </Section>

      <Section title="How long it is kept">
        <p>
          Reports are kept until someone in the workspace deletes them. Uploads that never finished are deleted
          automatically. To delete your account and its data, write to us.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions or requests:{" "}
          <Link href={`mailto:${CONTACT}`} className="font-semibold text-primary hover:underline">
            {CONTACT}
          </Link>
        </p>
      </Section>
    </article>
  )
}

/** Public: readable without signing in. */
export function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-muted px-4 py-16">
      <div className="flex w-full max-w-2xl flex-col gap-8 rounded-2xl border border-border bg-background p-8">
        <BugBerryLogo />
        <PrivacyPolicy />
      </div>
    </div>
  )
}
