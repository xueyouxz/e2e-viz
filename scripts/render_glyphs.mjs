/**
 * Offline glyph pre-renderer
 *
 * Reads the merged vector-map JSON files, renders each scene's map geometry
 * into a WebP image, and saves them to public/data/glyphs/.
 *
 * Output
 *   public/data/glyphs/<scene-name>.webp   264×264 px (6× DPR)
 *
 * Usage
 *   node scripts/render_glyphs.mjs              # render all scenes
 *   node scripts/render_glyphs.mjs --force      # re-render even if file exists
 *   node scripts/render_glyphs.mjs --concurrency 20
 */

import { readFile, mkdir, stat } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = new URL('..', import.meta.url).pathname
const DATA_DIR = path.join(REPO_ROOT, 'public/data')
const OUTPUT_DIR = path.join(DATA_DIR, 'glyphs')

const GLYPH_LOGICAL = 44 // CSS logical pixels
const GLYPH_DPR = 6 // device pixel ratio
const GLYPH_PHYSICAL = GLYPH_LOGICAL * GLYPH_DPR // 264px on disk
const MAP_PADDING = 3
const DEFAULT_CONCURRENCY = 40

// Production glyph palette: slate-blue dividers, amber crossings and a light keyline.
const GLYPH_STYLE = {
  drivableFill: 'rgba(71,85,105,.28)',
  pedFill: 'rgba(217,144,56,.78)',
  pedStroke: 'rgba(147,83,24,.72)',
  dividerStroke: 'rgba(53,93,120,.92)',
  dividerWidth: 0.6,
  keyline: { color: 'rgba(255,255,255,.82)', width: 0.4 }
}

// ── Offline map geometry ────────────────────────

function getBounds(pts) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, maxX, minY, maxY }
}

function collectPoints(scene) {
  const pts = []
  const { drivable_area, ped_crossing, divider } = scene.layers
  for (const poly of [...drivable_area, ...ped_crossing])
    for (const ring of poly.coordinates) for (const pt of ring) pts.push(pt)
  for (const line of divider) for (const pt of line.coordinates) pts.push(pt)
  return pts
}

function makeMapScale(bounds, size) {
  const w = Math.max(bounds.maxX - bounds.minX, 1)
  const h = Math.max(bounds.maxY - bounds.minY, 1)
  const usable = size - MAP_PADDING * 2
  const k = Math.min(usable / w, usable / h)
  const ox = (size - w * k) / 2
  const oy = (size - h * k) / 2
  return {
    x: v => ox + (v - bounds.minX) * k,
    y: v => size - (oy + (v - bounds.minY) * k)
  }
}

function ringToPathData(ring, s) {
  const pts = ring.map(([x, y]) => `${s.x(x).toFixed(2)},${s.y(y).toFixed(2)}`)
  return `M ${pts.join(' L ')} Z`
}

function polygonToPathData(poly, s) {
  return poly.coordinates.map(ring => ringToPathData(ring, s)).join(' ')
}

function lineToPathData(line, s) {
  const pts = line.coordinates.map(([x, y]) => `${s.x(x).toFixed(2)},${s.y(y).toFixed(2)}`)
  return `M ${pts.join(' L ')}`
}

/**
 * Build an SVG string for a single scene glyph at GLYPH_LOGICAL size.
 * Returns null when the scene has no renderable geometry.
 */
export function buildGlyphSVG(scene) {
  const { drivableFill, pedFill, pedStroke, dividerStroke, dividerWidth, keyline } = GLYPH_STYLE
  const pts = collectPoints(scene)
  if (pts.length === 0) return null

  const bounds = getBounds(pts)
  if (!isFinite(bounds.minX)) return null

  const s = makeMapScale(bounds, GLYPH_LOGICAL)
  const half = GLYPH_LOGICAL / 2
  const { drivable_area, ped_crossing, divider } = scene.layers

  const paths = []
  const underlay = []

  for (const poly of drivable_area) {
    const d = polygonToPathData(poly, s)
    if (d) {
      underlay.push(
        `<path d="${d}" fill="none" stroke="${keyline.color}" ` +
          `stroke-width="${keyline.width}" stroke-linejoin="round"/>`
      )
      paths.push(`<path d="${d}" fill="${drivableFill}"/>`)
    }
  }
  for (const poly of ped_crossing) {
    const d = polygonToPathData(poly, s)
    if (d) paths.push(`<path d="${d}" fill="${pedFill}" stroke="${pedStroke}" stroke-width=".25"/>`)
  }
  const dividerUnderlay = []
  const dividerPaths = []
  for (const line of divider) {
    const d = lineToPathData(line, s)
    if (d) {
      dividerUnderlay.push(
        `<path d="${d}" fill="none" stroke="${keyline.color}" ` +
          `stroke-width="${dividerWidth + keyline.width * 2}" ` +
          `stroke-linecap="round" stroke-linejoin="round"/>`
      )
      dividerPaths.push(
        `<path d="${d}" fill="none" stroke="${dividerStroke}" ` +
          `stroke-width="${dividerWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
      )
    }
  }

  // Paint every separator above every keyline to preserve close parallel lines and junctions.
  paths.push(...dividerUnderlay, ...dividerPaths)

  if (paths.length === 0) return null

  // rotate(180) mirrors the map: SVG Y-axis is flipped relative to world coords.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${GLYPH_LOGICAL}" height="${GLYPH_LOGICAL}" ` +
    `viewBox="0 0 ${GLYPH_LOGICAL} ${GLYPH_LOGICAL}">` +
    `<g transform="rotate(180 ${half} ${half})">` +
    underlay.join('') +
    paths.join('') +
    `</g></svg>`
  )
}

// ── Rendering ────────────────────────────────────────────────────────────────

async function fileExists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function renderScene(sceneName, scene, force) {
  const outPath = path.join(OUTPUT_DIR, `${sceneName}.webp`)

  if (!force && (await fileExists(outPath))) return 'skipped'

  const svg = buildGlyphSVG(scene)
  if (!svg) return 'empty'

  await sharp(Buffer.from(svg), { density: 72 * GLYPH_DPR })
    .resize(GLYPH_PHYSICAL, GLYPH_PHYSICAL, { fit: 'fill' })
    .webp({ quality: 90, effort: 4 })
    .toFile(outPath)

  return 'rendered'
}

// ── Concurrency pool ─────────────────────────────────────────────────────────

async function runPool(items, concurrency, fn) {
  const results = new Array(items.length)
  const queue = items.map((item, i) => ({ item, i }))

  async function worker() {
    while (queue.length > 0) {
      const { item, i } = queue.shift()
      results[i] = await fn(item)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const concIdx = args.indexOf('--concurrency')
  const concurrency = concIdx !== -1 ? parseInt(args[concIdx + 1], 10) : DEFAULT_CONCURRENCY

  await mkdir(OUTPUT_DIR, { recursive: true })

  // Load both split files in parallel
  const [valData, trainData] = await Promise.all([
    readFile(path.join(DATA_DIR, 'vector-maps', 'vector_maps_val.json'), 'utf8').then(JSON.parse),
    readFile(path.join(DATA_DIR, 'vector-maps', 'vector_maps_train.json'), 'utf8').then(JSON.parse)
  ])

  const entries = Object.entries({ ...valData, ...trainData })

  console.log(`Scenes: ${entries.length}`)
  console.log(
    `Output: ${GLYPH_PHYSICAL}×${GLYPH_PHYSICAL}px WebP  (${GLYPH_DPR}× DPR, logical ${GLYPH_LOGICAL}px)`
  )
  console.log(
    `Mode:   ${force ? 'force re-render' : 'skip existing'}  |  concurrency ${concurrency}`
  )
  console.log()

  const t0 = Date.now()
  const counts = { rendered: 0, skipped: 0, empty: 0 }
  let done = 0

  await runPool(entries, concurrency, async ([name, scene]) => {
    const status = await renderScene(name, scene, force)
    counts[status]++
    done++
    if (done % 50 === 0 || done === entries.length) {
      const pct = ((done / entries.length) * 100).toFixed(0)
      const sec = ((Date.now() - t0) / 1000).toFixed(1)
      process.stdout.write(`\r  ${done}/${entries.length}  ${pct}%  ${sec}s`)
    }
  })

  process.stdout.write('\n\n')

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`rendered : ${counts.rendered}`)
  console.log(`skipped  : ${counts.skipped}`)
  console.log(`empty    : ${counts.empty}`)
  console.log(`time     : ${elapsed}s`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(err)
    process.exitCode = 1
  })
}
