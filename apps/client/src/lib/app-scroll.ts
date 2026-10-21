/**
 * The signed-in app's main column. From tablet width up it is the one thing that scrolls (the sidebar stays put),
 * so the router puts it back at the top on every new page, as it does the window on phones.
 */
export const APP_MAIN_ID = "app-main"

/**
 * Asked by the router after each navigation: may it put scroll positions back? Not while a sheet (the phone
 * drawer) is on screen. React Aria's Sheet slides by scrolling, and a position written into it while it closes
 * leaves it stuck half-way, its close button doing nothing. Then this puts the new page at the top itself.
 */
export function mayRestoreScroll(): boolean {
  if (!document.querySelector('[data-slot="sheet"]')) return true
  scrollTo({ top: 0, left: 0 })
  document.getElementById(APP_MAIN_ID)?.scrollTo({ top: 0, left: 0 })
  return false
}
