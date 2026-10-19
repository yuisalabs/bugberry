export interface TestResult {
  id: string
  ok: boolean
  message: string
}

export interface IntegrationsUi {
  /** Integration id being edited, "new" for the create form, or null. */
  editing: string | null
  testResult: TestResult | null
}

export type IntegrationsUiAction =
  | { type: "edit"; id: string }
  | { type: "cancel" }
  | { type: "saved" }
  | ({ type: "tested" } & TestResult)

export const INITIAL_INTEGRATIONS_UI: IntegrationsUi = { editing: null, testResult: null }

export function integrationsUi(state: IntegrationsUi, action: IntegrationsUiAction): IntegrationsUi {
  switch (action.type) {
    case "edit":
      return { ...state, editing: action.id }
    case "cancel":
      return { ...state, editing: null }
    case "saved":
      // The token or settings may have changed, so an earlier test result no longer says anything.
      return { editing: null, testResult: null }
    case "tested":
      return { ...state, testResult: { id: action.id, ok: action.ok, message: action.message } }
  }
}
