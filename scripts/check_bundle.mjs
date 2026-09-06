#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const PROJECTION = 'src/features/projection-map/index.tsx'
const SCENE_VIEWER = 'src/features/scene-viewer/index.ts'
const SCENE_ROUTE = 'src/app/SceneViewerRoute.tsx'
const BUDGETS = { initial: 150, scene: 330, css: 12 }

// Only follow static imports. Dynamic routes are measured separately.
export function collectAssets(manifest, entryPoints) {
  const scripts = new Set()
  const styles = new Set()
  const visited = new Set()
  function visit(id) {
    if (visited.has(id)) return
    visited.add(id)
    const chunk = manifest[id]
    if (!chunk) throw new Error(`Bundle manifest entry is missing: ${id}`)
    if (chunk.file?.endsWith('.js')) scripts.add(chunk.file)
    if (chunk.file?.endsWith('.css')) styles.add(chunk.file)
    for (const css of chunk.css ?? []) styles.add(css)
    for (const dependency of chunk.imports ?? []) visit(dependency)
  }
  entryPoints.forEach(visit)
  return { scripts: [...scripts], styles: [...styles] }
}

export function bundleGroups(manifest) {
  const app = Object.keys(manifest).find(id => manifest[id].isEntry)
  if (!app) throw new Error('Bundle manifest has no application entry')
  const initial = collectAssets(manifest, [app, PROJECTION])
  const scene = collectAssets(manifest, [SCENE_ROUTE, SCENE_VIEWER])
  // Detect accidental eager loading even when Vite changes output filenames.
  for (const id of [SCENE_ROUTE, SCENE_VIEWER]) {
    if (initial.scripts.includes(manifest[id].file)) {
      throw new Error(`Projection eagerly imports scene-viewer module: ${id}`)
    }
  }
  return {
    initial: initial.scripts,
    scene: scene.scripts.filter(file => !initial.scripts.includes(file)),
    css: [...new Set(Object.keys(manifest).flatMap(id => collectAssets(manifest, [id]).styles))]
  }
}

export function assertBudget(name, assets, limitKiB) {
  const bytes = assets.reduce((sum, asset) => sum + asset.bytes, 0)
  if (bytes > limitKiB * 1024) {
    throw new Error(`${name}: ${(bytes / 1024).toFixed(1)} KiB gzip exceeds ${limitKiB} KiB`)
  }
  return bytes
}

export async function checkBundle(directory = path.resolve('dist')) {
  const manifest = JSON.parse(await readFile(path.join(directory, '.vite/manifest.json'), 'utf8'))
  for (const [name, files] of Object.entries(bundleGroups(manifest))) {
    const assets = await Promise.all(
      files.map(async file => ({
        file,
        bytes: gzipSync(await readFile(path.join(directory, file))).byteLength
      }))
    )
    const bytes = assertBudget(name, assets, BUDGETS[name])
    console.log(
      `${name}: ${(bytes / 1024).toFixed(1)} / ${BUDGETS[name]} KiB gzip (${files.length} files)`
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkBundle().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
