import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export interface City {
  name: string
  country: string
  latitude: number
  longitude: number
}

/** A city further away than this is not where the reporter is (open sea, poles). */
const MAX_DISTANCE_KM = 100
const EARTH_RADIUS_KM = 6371
const CITIES_FILE = fileURLToPath(new URL("../../geo/cities.tsv", import.meta.url))

let bundled: City[] | null = null

/** GeoNames cities of 15,000 people or more (CC BY 4.0), built by scripts/build-cities.ts. Read once. */
function bundledCities(): City[] {
  bundled ??= readFileSync(CITIES_FILE, "utf8")
    .split("\n")
    .flatMap((line) => {
      const [name, country, latitude, longitude] = line.split("\t")
      const lat = Number(latitude)
      const lon = Number(longitude)
      return name && country && Number.isFinite(lat) && Number.isFinite(lon)
        ? [{ name, country, latitude: lat, longitude: lon }]
        : []
    })
  return bundled
}

const radians = (degrees: number) => (degrees * Math.PI) / 180

/** Equirectangular distance: plenty for "which city is closest" at these distances. */
function distanceKm(latitude: number, longitude: number, city: City): number {
  const x = radians(city.longitude - longitude) * Math.cos(radians((city.latitude + latitude) / 2))
  const y = radians(city.latitude - latitude)
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_KM
}

/** "Jakarta, Indonesia" for coordinates near Jakarta; null when no city is within 100 km. */
export function nearestCity(latitude: number, longitude: number, cities: readonly City[] = bundledCities()): string | null {
  let best: City | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const city of cities) {
    const distance = distanceKm(latitude, longitude, city)
    if (distance < bestDistance) {
      best = city
      bestDistance = distance
    }
  }
  return best && bestDistance <= MAX_DISTANCE_KM ? `${best.name}, ${best.country}` : null
}
