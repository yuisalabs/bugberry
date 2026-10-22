import { useQuery } from "@tanstack/react-query"
import { Link } from "@bugberry/ui/link"
import type { ReactNode } from "react"
import { queries } from "../lib/queries"
import { SiteChrome } from "./landing/SiteChrome"
import { usePageMeta } from "./landing/usePageMeta"

const CONTACT = "yuisalabs@gmail.com"
const UPDATED = "22 October 2026"

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-heading text-lg font-semibold text-[#1C1022]">{title}</h2>
      {children}
    </section>
  )
}

const list = "flex list-disc flex-col gap-1 pl-5"
const mail = (
  <Link href={`mailto:${CONTACT}`} className="font-semibold text-[#D61F69] hover:underline">
    {CONTACT}
  </Link>
)

/** The policy itself, with security and the terms of use; the Chrome Web Store and addons.mozilla.org link here. */
export function PrivacyPolicy() {
  return (
    <article className="flex flex-col gap-6 text-sm/6 text-[#635A6B]">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-bold text-[#1C1022]">Privacy Policy</h1>
        <p>Last updated {UPDATED}</p>
      </header>

      <p>
        BugBerry turns a bug on a web page into a report: a screenshot or a recording, with what the page logged and
        what you did before it happened. This policy covers the BugBerry browser extension (Chrome, Opera and
        Firefox) and the BugBerry service at bugberry.yuisalabs.com. The security and terms sections below apply to the
        same service.
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
          Before anything is stored, cookies, authorization headers and fields named like passwords, tokens or secrets
          are replaced with “[redacted]” in the network data and in objects the page logs. Text typed into fields shows
          as dots in the steps, and areas a website marks as private are left out of them.
        </p>
        <p>
          The screenshot and the recording show the screen as it was. Blur anything sensitive on a screenshot before
          you send it, or pause the recording while it is visible.
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

      <Section title="If you request a demo">
        <p>
          The demo form on bugberry.yuisalabs.com keeps your name, work email, company, issue tracker, team size, what
          you would like to see and whether you are interested in self-hosting. We use it only to set up and hold your
          demo, and it is emailed to our team for that. It is deleted whenever you ask us to.
        </p>
      </Section>

      <Section title="Security">
        <ul className={list}>
          <li>Everything between your browser, the extension and BugBerry travels over HTTPS.</li>
          <li>Tokens for the trackers and channels a workspace connects are stored encrypted.</li>
          <li>
            A report is seen by the members of its workspace, plus whoever its access level lets in through the share
            link: people with the same company email domain, or anyone. Only the reporter or a workspace admin can change
            it.
          </li>
          <li>
            AI agents connected through MCP sign in as their person and see exactly what that person sees. Personal
            tokens work with the MCP server only, and can be revoked at any time.
          </li>
          <li>If your company needs reports to stay on its own servers, BugBerry can be self-hosted.</li>
        </ul>
        <p>To report a vulnerability, write to {mail}. We reply within one business day.</p>
      </Section>

      <Section title="Terms of use">
        <p>By using BugBerry you agree to these terms.</p>
        <ul className={list}>
          <li>
            BugBerry is in early access. It is free, it is provided as is, and features may change. We will give at
            least 30 days' notice before paid plans start.
          </li>
          <li>
            Accounts on the BugBerry service have the limits shown on the pricing page, currently 1 workspace with 5
            screenshots and 5 video recordings.
          </li>
          <li>
            Record only pages you are allowed to, and do not send other people's personal data you have no right to
            share. Do not use BugBerry to attack, overload or get around the limits of the service.
          </li>
          <li>
            Your reports remain yours. You allow us to store and show them only to run the service for you and the
            people you share them with.
          </li>
          <li>
            You can stop using BugBerry and ask us to delete your account at any time. We may suspend accounts that
            break these terms.
          </li>
          <li>To the extent the law allows, we are not liable for indirect losses from using the service.</li>
        </ul>
      </Section>

      <Section title="Contact">
        <p>Questions or requests: {mail}</p>
      </Section>
    </article>
  )
}

/**
 * The policy in the public site's chrome. A self-hosted server (no public site) gets the minimal chrome, so the
 * page links only what that server has.
 */
export function PrivacyView({ signedIn, publicSite }: { signedIn: boolean; publicSite: boolean }) {
  return (
    <SiteChrome signedIn={signedIn} installUrl={null} minimal={!publicSite}>
      <div className="px-4 py-14 sm:px-6 md:py-20">
        <div className="mx-auto w-full max-w-2xl rounded-2xl bg-[#FFFFFF] p-6 outline outline-1 -outline-offset-1 outline-[#E6E1EC] sm:p-10">
          <PrivacyPolicy />
        </div>
      </div>
    </SiteChrome>
  )
}

/** Public: readable without signing in, on every server. */
export function PrivacyPage() {
  const me = useQuery({ ...queries.me(), retry: false, meta: { signedOutIsFine: true } })
  const config = useQuery(queries.clientConfig())
  usePageMeta("Privacy Policy", "What BugBerry collects, how it is kept safe, and the terms of using the service.")
  return <PrivacyView signedIn={me.isSuccess} publicSite={config.data?.publicSite === true} />
}
