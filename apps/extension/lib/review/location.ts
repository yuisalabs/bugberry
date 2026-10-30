export interface Coordinates {
  latitude: number
  longitude: number
}

const PERMISSION_DENIED = 1
/** Two decimals is about a kilometre: enough for the city, never a street address. */
const round = (value: number) => Math.round(value * 100) / 100

/**
 * Asks the browser where the reporter is. Chrome shows its own location prompt the first time.
 * "denied" means the reporter refused; null means the position could not be found in time.
 */
export function currentCoordinates(
  geolocation: Pick<Geolocation, "getCurrentPosition">,
  timeoutMs = 10_000,
): Promise<Coordinates | "denied" | null> {
  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
        (position) => resolve({ latitude: round(position.coords.latitude), longitude: round(position.coords.longitude) }),
        (error) => resolve(error.code === PERMISSION_DENIED ? "denied" : null),
        { timeout: timeoutMs, maximumAge: 10 * 60 * 1000, enableHighAccuracy: false },
      )
    } catch {
      resolve(null)
    }
  })
}

/**
 * At send time: the coordinates to send, if any. A refusal also turns the switch off, so the reporter
 * sees why no city was added and is not asked again on the next report.
 */
export async function locationForSend(
  includeCity: boolean,
  ask: () => Promise<Coordinates | "denied" | null>,
): Promise<{ location: Coordinates | null; includeCity: boolean; note: string | null }> {
  if (!includeCity) return { location: null, includeCity: false, note: null }
  const answer = await ask()
  if (answer === "denied") return { location: null, includeCity: false, note: "Location permission was denied" }
  return { location: answer, includeCity: true, note: null }
}

/** The "Include my city" switch: turning it on asks for the browser's permission right away. */
export async function toggleCity(
  on: boolean,
  ask: () => Promise<Coordinates | "denied" | null>,
): Promise<{ includeCity: boolean; note: string | null }> {
  if (!on) return { includeCity: false, note: null }
  const answer = await ask()
  if (answer === "denied") return { includeCity: false, note: "Location permission was denied" }
  return { includeCity: true, note: null }
}
