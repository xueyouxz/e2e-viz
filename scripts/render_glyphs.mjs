/**
 * Offline glyph pre-renderer
 *
 * Reads the merged vector-map JSON files, renders each scene's map geometry
 * into a WebP image, and saves them to public/data/glyphs/.
 *
 * Output
 *   public/data/glyphs/<scene-name>.webp   88×88 px (2× DPR)
 *   public/data/glyphs/manifest.json       scene list + metadata
 *
 * Usage
 *   node scripts/render_glyphs.mjs              # render all scenes
 *   node scripts/render_glyphs.mjs --force      # re-render even if file exists
 *   node scripts/render_glyphs.mjs --concurrency 20
 */

import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import path from 'path'
import sharp from 'sharp'

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT      = new URL('..', import.meta.url).pathname
const DATA_DIR       = path.join(REPO_ROOT, 'public/data')
const OUTPUT_DIR     = path.join(DATA_DIR, 'glyphs')

const GLYPH_LOGICAL  = 44           // CSS logical pixels
const GLYPH_DPR      = 2            // device pixel ratio
const GLYPH_PHYSICAL = GLYPH_LOGICAL * GLYPH_DPR   // 88px on disk
const MAP_PADDING    = 4
const DEFAULT_CONCURRENCY = 40

// Colours from ProjectionMapView.module.css
const C_DRIVABLE_FILL  = 'rgba(116,132,151,.46)'
const C_PED_FILL       = 'rgba(232,151,45,.36)'
const C_PED_STROKE     = 'rgba(169,94,20,.38)'
const C_DIVIDER_STROKE = 'rgba(39,122,172,.68)'

// ── Geometry (mirrors buildMapGeometry in TypeScript) ────────────────────────

function getBounds(pts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  return { minX, maxX, minY, maxY }
}

function collectPoints(scene) {
  const pts = []
  const { drivable_area, ped_crossing, divider } = scene.layers
  for (const poly of [...drivable_area, ...ped_crossing])
    for (const ring of poly.coordinates)
      for (const pt of ring) pts.push(pt)
  for (const line of divider)
    for (const pt of line.coordinates) pts.push(pt)
  return pts
}

function makeMapScale(bounds, size) {
  const w      = Math.max(bounds.maxX - bounds.minX, 1)
  const h      = Math.max(bounds.maxY - bounds.minY, 1)
  const usable = size - MAP_PADDING * 2
  const k      = Math.min(usable / w, usable / h)
  const ox     = (size - w * k) / 2
  const oy     = (size - h * k) / 2
  return {
    x: v => ox + (v - bounds.minX) * k,
    y: v => size - (oy + (v - bounds.minY) * k),
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
function buildGlyphSVG(scene) {
  const pts = collectPoints(scene)
  if (pts.length === 0) return null

  const bounds = getBounds(pts)
  if (!isFinite(bounds.minX)) return null

  const s    = makeMapScale(bounds, GLYPH_LOGICAL)
  const half = GLYPH_LOGICAL / 2
  const { drivable_area, ped_crossing, divider } = scene.layers

  const paths = []

  for (const poly of drivable_area) {
    const d = polygonToPathData(poly, s)
    if (d) paths.push(`<path d="${d}" fill="${C_DRIVABLE_FILL}"/>`)
  }
  for (const poly of ped_crossing) {
    const d = polygonToPathData(poly, s)
    if (d) paths.push(
      `<path d="${d}" fill="${C_PED_FILL}" stroke="${C_PED_STROKE}" stroke-width=".25"/>`
    )
  }
  for (const line of divider) {
    const d = lineToPathData(line, s)
    if (d) paths.push(
      `<path d="${d}" fill="none" stroke="${C_DIVIDER_STROKE}" ` +
      `stroke-width=".45" stroke-linecap="round" stroke-linejoin="round"/>`
    )
  }

  if (paths.length === 0) return null

  // rotate(180) mirrors the map: SVG Y-axis is flipped relative to world coords.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${GLYPH_LOGICAL}" height="${GLYPH_LOGICAL}" ` +
    `viewBox="0 0 ${GLYPH_LOGICAL} ${GLYPH_LOGICAL}">` +
    `<g transform="rotate(180 ${half} ${half})">` +
    paths.join('') +
    `</g></svg>`
  )
}

// ── Rendering ────────────────────────────────────────────────────────────────

async function fileExists(p) {
  try { await stat(p); return true } catch { return false }
}

async function renderScene(sceneName, scene, force) {
  const outPath = path.join(OUTPUT_DIR, `${sceneName}.webp`)

  if (!force && await fileExists(outPath)) return 'skipped'

  const svg = buildGlyphSVG(scene)
  if (!svg) return 'empty'

  await sharp(Buffer.from(svg))
    .resize(GLYPH_PHYSICAL, GLYPH_PHYSICAL, { fit: 'fill' })
    .webp({ quality: 90, effort: 4 })
    .toFile(outPath)

  return 'rendered'
}

// ── Concurrency pool ─────────────────────────────────────────────────────────

async function runPool(items, concurrency, fn) {
  const results = new Array(items.length)
  const queue   = items.map((item, i) => ({ item, i }))

  async function worker() {
    while (queue.length > 0) {
      const { item, i } = queue.shift()
      results[i] = await fn(item)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  )
  return results
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args        = process.argv.slice(2)
  const force       = args.includes('--force')
  const concIdx     = args.indexOf('--concurrency')
  const concurrency = concIdx !== -1 ? parseInt(args[concIdx + 1], 10) : DEFAULT_CONCURRENCY

  await mkdir(OUTPUT_DIR, { recursive: true })

  // Load both split files in parallel
  const [valData, trainData] = await Promise.all([
    readFile(path.join(DATA_DIR, 'vector-maps', 'vector_maps_val.json'),   'utf8').then(JSON.parse),
    readFile(path.join(DATA_DIR, 'vector-maps', 'vector_maps_train.json'), 'utf8').then(JSON.parse),
  ])

  const entries = Object.entries({ ...valData, ...trainData })

  console.log(`Scenes: ${entries.length}`)
  console.log(`Output: ${GLYPH_PHYSICAL}×${GLYPH_PHYSICAL}px WebP  (${GLYPH_DPR}× DPR, logical ${GLYPH_LOGICAL}px)`)
  console.log(`Mode:   ${force ? 'force re-render' : 'skip existing'}  |  concurrency ${concurrency}`)
  console.log()

  const t0      = Date.now()
  const counts  = { rendered: 0, skipped: 0, empty: 0 }
  let   done    = 0

  const results = await runPool(entries, concurrency, async ([name, scene]) => {
    const status = await renderScene(name, scene, force)
    counts[status]++
    done++
    if (done % 50 === 0 || done === entries.length) {
      const pct = ((done / entries.length) * 100).toFixed(0)
      const sec = ((Date.now() - t0) / 1000).toFixed(1)
      process.stdout.write(`\r  ${done}/${entries.length}  ${pct}%  ${sec}s`)
    }
    return status === 'rendered' || status === 'skipped' ? name : null
  })

  process.stdout.write('\n\n')

  const renderedScenes = results.filter(Boolean).sort()

  // Manifest consumed by the runtime image loader
  const manifest = {
    format:      'webp',
    logicalSize:  GLYPH_LOGICAL,
    physicalSize: GLYPH_PHYSICAL,
    dpr:          GLYPH_DPR,
    basePath:    '/data/glyphs/',
    count:        renderedScenes.length,
    scenes:       renderedScenes,
  }

  await writeFile(
    path.join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`rendered : ${counts.rendered}`)
  console.log(`skipped  : ${counts.skipped}`)
  console.log(`empty    : ${counts.empty}`)
  console.log(`time     : ${elapsed}s`)
  console.log(`manifest : ${OUTPUT_DIR}/manifest.json  (${renderedScenes.length} scenes)`)
}

main().catch(err => { console.error(err); process.exit(1) })
