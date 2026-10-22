/** The demo form's choices, shared by the form (client) and its check (API). */
export const DEMO_TRACKERS = ["GitHub", "GitLab", "Jira", "Linear", "Plane", "ActiveCollab", "Other", "None yet"] as const
export type DemoTracker = (typeof DEMO_TRACKERS)[number]

export const DEMO_TEAM_SIZES = ["1–10", "11–50", "51–200", "200+"] as const
export type DemoTeamSize = (typeof DEMO_TEAM_SIZES)[number]

/** A "Book your demo" request. `website` is a field people never see: bots fill it in. */
export interface DemoRequestInput {
  firstName: string
  lastName: string
  email: string
  company: string
  tracker: DemoTracker
  teamSize: DemoTeamSize
  message: string
  selfHosting: boolean
  website?: string
}
