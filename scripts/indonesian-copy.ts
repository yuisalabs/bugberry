import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Indonesian words that never appear in BugBerry's English copy. Whole words, case-sensitive where
 * the English word could collide ("Status" stays allowed).
 */
const WORDS = [
  "laporan", "Laporan", "Kirim", "kirim", "Simpan", "simpan", "Hapus", "hapus", "Tidak", "tidak", "Belum", "belum",
  "Gagal", "gagal", "Memuat", "memuat", "Pengaturan", "Judul", "Prioritas", "Terbuka", "Ditutup", "Diproses", "Selesai",
  "Anggota", "Komentar", "komentar", "Pelapor", "Tanpa", "tanpa", "Masuk", "masuk", "Keluar", "Ubah", "Batal", "Salin",
  "Rekam", "rekam", "Rekaman", "rekaman", "lainnya", "Semua", "semua", "sudah", "Sudah", "dengan", "untuk", "atau",
  "yang", "Buka", "buka", "Hentikan", "Durasi", "Tutup", "sebentar", "Kritis", "Rendah", "Sedang", "Tinggi", "Publik",
  "Lanjutkan", "dulu", "bisa", "Jenis", "Urutan", "Terbaru", "halaman", "Halaman", "Anda", "kamu", "Kamu",
]
const PATTERN = new RegExp(String.raw`\b(${WORDS.join("|")})\b`)

/** Comments are for developers; only text that can reach a person is checked. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

function files(dir: string): string[] {
  if (!statSync(dir).isDirectory()) return [dir]
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path)
    return /\.(tsx?|html)$/.test(name) ? [path] : []
  })
}

/** "path:line: text" for every line that still carries Indonesian copy. */
export function indonesianCopy(dirs: string[]): string[] {
  return dirs.flatMap((dir) =>
    files(dir).flatMap((path) =>
      withoutComments(readFileSync(path, "utf8"))
        .split("\n")
        .flatMap((line, index) => (PATTERN.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [])),
    ),
  )
}
