/**
 * A plain button for a destructive action (Remove, Revoke, Delete): red text and a red icon. Intent's button colours
 * its icon on its own (--btn-icon, and --btn-icon-active on hover), so the text colour alone left the icon grey.
 */
export const dangerText =
  "text-danger hover:bg-danger-subtle [--btn-icon:var(--color-danger)] [--btn-icon-active:var(--color-danger)]"
