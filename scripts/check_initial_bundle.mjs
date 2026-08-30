#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const FORBIDDEN_INITIAL_CHUNK_PREFIXES = ['three-core-', 'r3f-', 'zustand-', 'SceneViewer-']
const PROJECTION_ROUTE_MODULE = 'src/features/projection-map/index.tsx'
const INITIAL_GZIP_LIMIT_BYTES = 150 * 1024

export function findForbiddenInitialChunks(html) {
  const links = html.match(/<link\b[^>]*>/gi) ?? []
  const forbidden = []

  for (const link of links) {
    if (!/\brel=["']modulepreload["']/i.test(link)) continue
    const href = link.match(/\bhref=["']([^"']+)["']/i)?.[1]
    if (!href) continue
    const fileName = path.posix.basename(href)
    if (FORBIDDEN_INITIAL_CHUNK_PREFIXES.some(prefix => fileName.startsWith(prefix))) {
      forbidden.push(href)
    }
  }

  return forbidden
}

export function collectInitialProjectionAssets(manifest) {
  const assets = new Set()
  const visited = new Set()
  const applicationEntry = Object.entries(manifest).find(([, chunk]) => chunk.isEntry)?.[0]
  if (!applicationEntry) throw new Error('Initial bundle manifest has no application entry')

  function visit(moduleId) {
    if (visited.has(moduleId)) return
    visited.add(moduleId)

    const chunk = manifest[moduleId]
    if (!chunk) throw new Error(`Initial bundle manifest entry is missing: ${moduleId}`)
    if (chunk.file?.endsWith('.js')) assets.add(chunk.file)
    for (const dependency of chunk.imports ?? []) visit(dependency)
  }

  for (const moduleId of [applicationEntry, PROJECTION_ROUTE_MODULE]) visit(moduleId)
  return [...assets]
}

export function assertInitialBundleBudget(assets, limitBytes = INITIAL_GZIP_LIMIT_BYTES) {
  const totalBytes = assets.reduce((sum, asset) => sum + asset.gzipBytes, 0)
  if (totalBytes <= limitBytes) return

  const detail = assets
    .toSorted((left, right) => right.gzipBytes - left.gzipBytes)
    .map(asset => `${asset.file} (${(asset.gzipBytes / 1024).toFixed(1)} KiB)`)
    .join(', ')
  throw new Error(
    `Projection map initial JS is ${(totalBytes / 1024).toFixed(1)} KiB, ` +
      `which exceeds ${(limitBytes / 1024).toFixed(1)} KiB gzip: ${detail}`
  )
}

export async function checkInitialBundle(indexPath = path.resolve('dist/index.html')) {
  const distDirectory = path.dirname(indexPath)
  const forbidden = findForbiddenInitialChunks(await readFile(indexPath, 'utf8'))
  if (forbidden.length > 0) {
    throw new Error(`Projection map eagerly preloads scene-viewer chunks: ${forbidden.join(', ')}`)
  }

  const manifest = JSON.parse(
    await readFile(path.join(distDirectory, '.vite', 'manifest.json'), 'utf8')
  )
  const initialAssets = collectInitialProjectionAssets(manifest)
  const forbiddenGraphAssets = initialAssets.filter(asset =>
    FORBIDDEN_INITIAL_CHUNK_PREFIXES.some(prefix => path.posix.basename(asset).startsWith(prefix))
  )
  if (forbiddenGraphAssets.length > 0) {
    throw new Error(
      `Projection map initial graph contains scene-viewer chunks: ${forbiddenGraphAssets.join(', ')}`
    )
  }

  const measuredAssets = await Promise.all(
    initialAssets.map(async file => ({
      file,
      gzipBytes: gzipSync(await readFile(path.join(distDirectory, file))).byteLength
    }))
  )
  assertInitialBundleBudget(measuredAssets)

  const totalBytes = measuredAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0)
  console.log(
    `Projection map initial JS: ${(totalBytes / 1024).toFixed(1)} KiB gzip ` +
      `across ${measuredAssets.length} files`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkInitialBundle().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
