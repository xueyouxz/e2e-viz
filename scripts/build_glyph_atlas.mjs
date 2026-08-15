#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const GLYPH_DIRECTORY = path.join(REPO_ROOT, 'public', 'data', 'glyphs')
const PROJECTION_DATA = path.join(
  REPO_ROOT,
  'public',
  'data',
  'projection-map',
  'dimension_reduction.json'
)
const ATLAS_CONFIG_PATH = path.join(REPO_ROOT, 'glyph-atlas.config.json')
const ATLAS_CONFIG = JSON.parse(readFileSync(ATLAS_CONFIG_PATH, 'utf8'))

export function parseSceneIndex(fileName) {
  const match = /^scene-(\d{4})\.webp$/.exec(fileName)
  return match ? Number(match[1]) : null
}

export function atlasPlacement(sceneIndex, layout = ATLAS_CONFIG) {
  if (
    !Number.isSafeInteger(sceneIndex) ||
    sceneIndex < 0 ||
    sceneIndex >= layout.columns * layout.rows
  ) {
    return null
  }
  return {
    left: (sceneIndex % layout.columns) * layout.cellSize + layout.padding,
    top: Math.floor(sceneIndex / layout.columns) * layout.cellSize + layout.padding
  }
}

export function createAtlasPlan(fileNames, layout = ATLAS_CONFIG) {
  const plan = []
  const occupied = new Set()

  for (const fileName of fileNames) {
    const sceneIndex = parseSceneIndex(fileName)
    if (sceneIndex === null) continue
    const placement = atlasPlacement(sceneIndex, layout)
    if (!placement) throw new Error(`${fileName} does not fit in the glyph atlas layout`)
    if (occupied.has(sceneIndex)) throw new Error(`Duplicate glyph atlas slot: ${sceneIndex}`)
    occupied.add(sceneIndex)
    plan.push({ fileName, sceneIndex, ...placement })
  }

  return plan.sort((left, right) => left.sceneIndex - right.sceneIndex)
}

export function validateAtlasCoverage(plan, expectedSceneNames) {
  const available = new Set(plan.map(item => item.fileName.replace(/\.webp$/, '')))
  const missing = expectedSceneNames.filter(sceneName => !available.has(sceneName))
  if (missing.length > 0) {
    throw new Error(
      `Glyph atlas is missing ${missing.length} projection scenes: ${missing.join(', ')}`
    )
  }
}

export function assertAtlasMetadata(metadata, layout = ATLAS_CONFIG) {
  const expectedWidth = layout.columns * layout.cellSize
  const expectedHeight = layout.rows * layout.cellSize
  if (
    metadata.format !== 'webp' ||
    metadata.width !== expectedWidth ||
    metadata.height !== expectedHeight
  ) {
    throw new Error(
      `Invalid glyph atlas: expected WebP ${expectedWidth}×${expectedHeight}, got ${metadata.format ?? 'unknown'} ${metadata.width ?? '?'}×${metadata.height ?? '?'}`
    )
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export async function validateGlyphAtlasArtifact({
  glyphDirectory = GLYPH_DIRECTORY,
  projectionDataPath = PROJECTION_DATA,
  layout = ATLAS_CONFIG
} = {}) {
  const fileNames = await readdir(glyphDirectory)
  const plan = createAtlasPlan(fileNames, layout)
  if (plan.length === 0) throw new Error(`No scene glyphs found in ${glyphDirectory}`)

  const projectionData = JSON.parse(await readFile(projectionDataPath, 'utf8'))
  validateAtlasCoverage(
    plan,
    projectionData.scenes.map(scene => scene.scene_name)
  )

  const atlasPath = path.join(glyphDirectory, layout.fileName)
  const metadata = await sharp(atlasPath).metadata()
  assertAtlasMetadata(metadata, layout)

  const [atlasStats, projectionStats, configStats, sourceStats] = await Promise.all([
    stat(atlasPath),
    stat(projectionDataPath),
    stat(ATLAS_CONFIG_PATH),
    Promise.all(plan.map(item => stat(path.join(glyphDirectory, item.fileName))))
  ])
  const latestInputMtime = Math.max(
    projectionStats.mtimeMs,
    configStats.mtimeMs,
    ...sourceStats.map(item => item.mtimeMs)
  )
  if (atlasStats.size === 0 || atlasStats.mtimeMs < latestInputMtime) {
    throw new Error(`Glyph atlas is empty or stale: ${atlasPath}. Run pnpm build:glyph-atlas.`)
  }

  return {
    atlasPath,
    scenes: plan.length,
    bytes: atlasStats.size,
    width: metadata.width,
    height: metadata.height
  }
}

export async function buildGlyphAtlas({
  glyphDirectory = GLYPH_DIRECTORY,
  layout = ATLAS_CONFIG,
  concurrency = 16
} = {}) {
  const plan = createAtlasPlan(await readdir(glyphDirectory), layout)
  if (plan.length === 0) throw new Error(`No scene glyphs found in ${glyphDirectory}`)
  const projectionData = JSON.parse(await readFile(PROJECTION_DATA, 'utf8'))
  validateAtlasCoverage(
    plan,
    projectionData.scenes.map(scene => scene.scene_name)
  )

  const composites = await mapWithConcurrency(plan, concurrency, async item => ({
    input: await sharp(path.join(glyphDirectory, item.fileName))
      .resize(layout.sourceSize, layout.sourceSize, { fit: 'fill' })
      .png()
      .toBuffer(),
    left: item.left,
    top: item.top
  }))

  const outputPath = path.join(glyphDirectory, layout.fileName)
  const temporaryPath = `${outputPath}.tmp.webp`
  try {
    await sharp({
      create: {
        width: layout.columns * layout.cellSize,
        height: layout.rows * layout.cellSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite(composites)
      .webp({ quality: 90, alphaQuality: 100, effort: 5, smartSubsample: true })
      .toFile(temporaryPath)
    await rename(temporaryPath, outputPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }

  return {
    outputPath,
    scenes: plan.length,
    width: layout.columns * layout.cellSize,
    height: layout.rows * layout.cellSize
  }
}

export async function ensureGlyphAtlasArtifact() {
  if (!existsSync(GLYPH_DIRECTORY)) return { skipped: true }
  try {
    return { ...(await validateGlyphAtlasArtifact()), built: false, skipped: false }
  } catch {
    return { ...(await buildGlyphAtlas()), built: true, skipped: false }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const validateOnly = process.argv.includes('--validate')
  const ensureIfPresent = process.argv.includes('--ensure-if-present')
  const operation = ensureIfPresent
    ? ensureGlyphAtlasArtifact()
    : validateOnly
      ? validateGlyphAtlasArtifact()
      : buildGlyphAtlas()
  operation
    .then(result => {
      if (result.skipped) {
        console.log('Glyph atlas skipped: public/data/glyphs is not present')
        return
      }
      const outputPath = result.atlasPath ?? result.outputPath
      const verb = validateOnly || result.built === false ? 'validated' : 'built'
      console.log(
        `Glyph atlas ${verb}: ${result.scenes} scenes, ${result.width}×${result.height}px -> ${outputPath}`
      )
    })
    .catch(error => {
      console.error(error)
      process.exitCode = 1
    })
}
