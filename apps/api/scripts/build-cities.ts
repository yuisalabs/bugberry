/**
 * Builds apps/api/geo/cities.tsv from GeoNames (https://www.geonames.org, CC BY 4.0):
 *   bun apps/api/scripts/build-cities.ts <cities15000.txt> <countryInfo.txt>
 * Each line is "name<TAB>country<TAB>latitude<TAB>longitude", coordinates to 2 decimals.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const [citiesPath, countriesPath] = process.argv.slice(2)
if (!citiesPath || !countriesPath) {
  console.error("usage: bun apps/api/scripts/build-cities.ts <cities15000.txt> <countryInfo.txt>")
  process.exit(1)
}

const countries = new Map<string, string>()
for (const line of readFileSync(countriesPath, "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue
  const columns = line.split("\t")
  if (columns[0] && columns[4]) countries.set(columns[0], columns[4])
}

const clean = (value: string) => value.replace(/[\t\r\n]/g, " ").trim()
const rows: string[] = []
for (const line of readFileSync(citiesPath, "utf8").split("\n")) {
  const columns = line.split("\t")
  const name = clean(columns[1] ?? "")
  const latitude = Number(columns[4])
  const longitude = Number(columns[5])
  const country = countries.get(columns[8] ?? "")
  if (!name || !country || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
  rows.push([name, clean(country), latitude.toFixed(2), longitude.toFixed(2)].join("\t"))
}

const output = fileURLToPath(new URL("../geo/cities.tsv", import.meta.url))
writeFileSync(output, `${rows.join("\n")}\n`)
console.log(`wrote ${rows.length} cities to ${output}`)
