import type { Visibility } from "@bugberry/shared"
import { useState } from "react"
import type { BugberryApi, Project } from "../../lib/server/api"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage } from "../../lib/server/browser-settings"
import { loadSettings, type Settings } from "../../lib/server/settings"
import type { SentDetails, TrackerChoice } from "./SentPanel"

/** The review's state after sending, and what the sent panel changes on the server. */
export function useSentReport(projects: Project[], apiOf: (settings: Settings) => BugberryApi) {
  // After sending: the report as the server has it, and the trackers it can go to.
  const [sentDetails, setSentDetails] = useState<SentDetails | null>(null)
  const [trackers, setTrackers] = useState<TrackerChoice[] | null>(null)
  const [trackerNote, setTrackerNote] = useState<string | null>(null)
  // A report sent without a project has no trackers until one is picked in the sent panel.
  const [needsProject, setNeedsProject] = useState(false)

  /** What the created report looks like on the server, and where else it can go; the review works without either. */
  const loadSent = async (reportId: string) => {
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    if (!settings) return
    const api = apiOf(settings)
    const report = await api.getReport(reportId).catch(() => null)
    if (report) {
      setSentDetails({
        number: report.number,
        title: report.title,
        status: report.status,
        priority: report.priority,
        visibility: report.visibility,
        projectName: projects.find((project) => project.id === report.projectId)?.name ?? null,
        assigneeName: report.assignee?.name ?? null,
      })
    }
    const offered = await api.reportTrackers(reportId).catch(() => null)
    if (!offered) return
    const sentTo = new Map(offered.links.map((link) => [link.integrationId, link]))
    const choices = offered.integrations.map((integration): TrackerChoice => {
      const link = sentTo.get(integration.id)
      return { id: integration.id, provider: integration.provider, label: integration.label, state: link?.externalUrl ? { url: link.externalUrl } : "idle" }
    })
    setTrackers(choices)
    setNeedsProject(offered.needsProject)
    setTrackerNote(null)
  }

  /** Moves the sent report into a project, then offers that project's trackers. */
  const moveToProject = async (reportId: string, projectId: string) => {
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    if (!settings) return
    try {
      await apiOf(settings).updateReport(reportId, { projectId })
    } catch (cause) {
      setTrackerNote(cause instanceof Error ? cause.message : "Couldn't move the report to the project.")
      return
    }
    await loadSent(reportId)
  }

  const changeVisibility = async (reportId: string, visibility: Visibility) => {
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    if (!settings) return
    const before = sentDetails
    setSentDetails((current) => current && { ...current, visibility })
    // Back as it was when the server refuses: the link must not claim more (or less) than is true.
    await apiOf(settings)
      .updateReport(reportId, { visibility })
      .catch(() => setSentDetails(before))
  }

  const sendToTracker = async (reportId: string, integrationId: string) => {
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    if (!settings) return
    const mark = (state: TrackerChoice["state"]) =>
      setTrackers((current) => current?.map((tracker) => (tracker.id === integrationId ? { ...tracker, state } : tracker)) ?? null)
    mark("sending")
    try {
      const link = (await apiOf(settings).sendToTracker(reportId, integrationId)) as { externalUrl?: string | null; error?: string | null }
      mark(link.error ? { error: link.error } : { url: link.externalUrl ?? null })
    } catch (cause) {
      mark({ error: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  return { sentDetails, trackers, trackerNote, needsProject, loadSent, moveToProject, changeVisibility, sendToTracker }
}
