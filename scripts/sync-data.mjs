#!/usr/bin/env node

import * as p from '@clack/prompts'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const localData = join(root, 'public', 'data')
const archive = process.env.NUSVIZ_ZIP || '/Users/xyxz/Data/nusviz-val.zip'
const bucket = process.env.OSS_BUCKET || 'e2e-viz-private'
const prefix = (process.env.OSS_PREFIX || 'e2e-viz/data/').replace(/^\/+/, '').replace(/\/*$/, '/')

function run(command, args, options = {}) {
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
  await run('ossutil', [
    'cp',
    '-r',
    source.endsWith('/') ? source : `${source}/`,
    destination,
    '--force',
    '--exclude',
    '.DS_Store'
  ])
}

async function main() {
  if (!existsSync(localData)) throw new Error(`Local data directory not found: ${localData}`)
  if (!existsSync(archive)) throw new Error(`Scene archive not found: ${archive}`)

  p.intro('e2e-viz · 上传数据到私有 OSS')
  p.note(
    [
      `项目数据  ${localData}`,
      `场景压缩包 ${archive}`,
      `OSS 目标   oss://${bucket}/${prefix}`,
      '',
      '需要先在本机完成 ossutil config，并使用独立的上传 RAM 用户。'
    ].join('\n')
  )

  const confirmed = await p.confirm({ message: '确认开始上传？' })
  if (p.isCancel(confirmed) || !confirmed) return p.cancel('已取消')

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'e2e-viz-oss-'))
  try {
    await run('unzip', ['-q', archive, '-d', temporaryDirectory])
    const extractedScenes = join(temporaryDirectory, 'nusviz')
    if (!existsSync(extractedScenes)) {
      throw new Error('The archive must contain a top-level nusviz directory')
    }

    await uploadDirectory(localData, `oss://${bucket}/${prefix}`)
    await uploadDirectory(extractedScenes, `oss://${bucket}/${prefix}scenes/`)
    p.outro('上传完成')
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

main().catch(error => {
  p.log.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
