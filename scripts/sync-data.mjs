#!/usr/bin/env node

import * as p from '@clack/prompts'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateGlyphAtlasArtifact } from './build_glyph_atlas.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const localData = join(root, 'public', 'data')
const glyphAtlasConfig = JSON.parse(readFileSync(join(root, 'glyph-atlas.config.json'), 'utf8'))
const glyphAtlas = join(localData, 'glyphs', glyphAtlasConfig.fileName)
const archive = process.env.NUSVIZ_ZIP || '/Users/xyxz/Data/nusviz-val.zip'
const bucket = process.env.OSS_BUCKET || 'e2e-viz-private'
const prefix = (process.env.OSS_PREFIX || 'e2e-viz/data/').replace(/^\/+/, '').replace(/\/*$/, '/')
const DEFAULT_ENDPOINT = 'https://oss-cn-shanghai.aliyuncs.com'
const endpoint = resolveEndpoint(process.env.OSS_ENDPOINT)
const configFile = process.env.OSSUTIL_CONFIG_FILE || join(homedir(), '.ossutilconfig')
const checkpointDirectory = join(root, '.ossutil_checkpoint')
const outputDirectory = join(root, 'ossutil_output')

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

export function resolveEndpoint(value) {
  return value?.trim() || DEFAULT_ENDPOINT
}

export async function collectDirectoryStats(directory) {
  const result = { files: 0, bytes: 0 }
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await collectDirectoryStats(path)
      result.files += nested.files
      result.bytes += nested.bytes
    } else if (entry.isFile()) {
      result.files += 1
      result.bytes += (await stat(path)).size
    }
  }
  return result
}

export function buildOssutilOptions({ endpoint, configFile }) {
  return ['-e', endpoint, ...(configFile ? ['-c', configFile] : [])]
}

function ossutilOptions() {
  return buildOssutilOptions({
    endpoint,
    configFile: process.env.OSSUTIL_CONFIG_FILE
  })
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

async function uploadDirectory(source, destination) {
  await runCommand('ossutil', [
    'cp',
    '-r',
    source.endsWith('/') ? source : `${source}/`,
    destination,
    '--force',
    '--update',
    '--exclude',
    '.DS_Store',
    '--checkpoint-dir',
    checkpointDirectory,
    '--output-dir',
    outputDirectory,
    ...ossutilOptions()
  ])
}

async function preflight() {
  await runCommand('ossutil', [
    'ls',
    `oss://${bucket}/${prefix}`,
    '--short-format',
    '--limited-num',
    '1',
    ...ossutilOptions()
  ])
}

async function verifyRemoteGlyphAtlas() {
  await runCommand('ossutil', [
    'stat',
    `oss://${bucket}/${prefix}glyphs/${glyphAtlasConfig.fileName}`,
    ...ossutilOptions()
  ])
}

async function warnAboutConfigPermissions() {
  if (!existsSync(configFile)) return
  const mode = (await stat(configFile)).mode & 0o777
  if ((mode & 0o077) !== 0) {
    p.log.warn(`配置文件权限为 ${mode.toString(8)}，请执行：chmod 600 ${configFile}`)
  }
}

async function main() {
  if (!existsSync(localData)) throw new Error(`Local data directory not found: ${localData}`)
  if (!existsSync(glyphAtlas)) throw new Error(`Glyph atlas not found: ${glyphAtlas}`)
  await validateGlyphAtlasArtifact()
  if (!existsSync(archive)) throw new Error(`Scene archive not found: ${archive}`)

  p.intro('e2e-viz · 上传数据到私有 OSS')
  p.note(
    [
      `项目数据  ${localData}`,
      `场景压缩包 ${archive}`,
      `OSS 目标   oss://${bucket}/${prefix}`,
      `Endpoint   ${endpoint}`,
      '',
      '需要先在本机完成 ossutil config，并使用独立的上传 RAM 用户。'
    ].join('\n')
  )

  const confirmed = await p.confirm({ message: '确认开始上传？' })
  if (p.isCancel(confirmed) || !confirmed) return p.cancel('已取消')

  p.log.info('[1/5] 检查 OSS Endpoint、AccessKey 和目录权限')
  await warnAboutConfigPermissions()
  await preflight()
  p.log.success('OSS 连接和权限检查通过')

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'e2e-viz-oss-'))
  try {
    const unzipSpinner = p.spinner()
    unzipSpinner.start('[2/5] 解压场景数据（约 8.2 GB）')
    try {
      await runCommand('unzip', ['-q', archive, '-d', temporaryDirectory])
      unzipSpinner.stop('场景数据解压完成')
    } catch (error) {
      unzipSpinner.stop('场景数据解压失败')
      throw error
    }
    const extractedScenes = join(temporaryDirectory, 'nusviz')
    if (!existsSync(extractedScenes)) {
      throw new Error('The archive must contain a top-level nusviz directory')
    }

    p.log.info('[3/5] 统计待上传文件')
    const [projectStats, sceneStats] = await Promise.all([
      collectDirectoryStats(localData),
      collectDirectoryStats(extractedScenes)
    ])
    p.note(
      [
        `项目数据  ${projectStats.files} 个文件，${formatBytes(projectStats.bytes)}`,
        `场景数据  ${sceneStats.files} 个文件，${formatBytes(sceneStats.bytes)}`,
        `合计      ${projectStats.files + sceneStats.files} 个文件，${formatBytes(projectStats.bytes + sceneStats.bytes)}`,
        '',
        '上传阶段由 ossutil 实时显示文件数、字节数、百分比和平均速度。'
      ].join('\n'),
      '上传计划'
    )

    const startedAt = Date.now()
    p.log.info(
      `[4/5] 上传项目数据：${projectStats.files} 个文件，${formatBytes(projectStats.bytes)}`
    )
    await uploadDirectory(localData, `oss://${bucket}/${prefix}`)
    await verifyRemoteGlyphAtlas()
    p.log.success('项目数据上传完成')

    p.log.info(`[5/5] 上传场景数据：${sceneStats.files} 个文件，${formatBytes(sceneStats.bytes)}`)
    await uploadDirectory(extractedScenes, `oss://${bucket}/${prefix}scenes/`)
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000)
    p.outro(
      `上传完成，共 ${projectStats.files + sceneStats.files} 个文件，耗时 ${elapsedSeconds} 秒`
    )
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    p.log.error(error instanceof Error ? error.message : String(error))
    p.log.info(`批量上传错误报告目录：${outputDirectory}`)
    p.log.info('修复原始错误后重新运行 pnpm sync:data，将使用断点记录跳过已完成文件。')
    process.exitCode = 1
  })
}
