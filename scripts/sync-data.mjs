#!/usr/bin/env node
/**
 * Interactive data sync: local public/data/ → remote /srv/e2e-viz/data/
 *
 * SSH credentials are read from environment variables (DATA_SYNC_HOST,
 * DATA_SYNC_USER). If absent the script prompts for them interactively.
 * Persist them in a local .env.local file to skip the prompts next time:
 *
 *   DATA_SYNC_HOST=1.2.3.4
 *   DATA_SYNC_USER=root
 */

import * as p from '@clack/prompts'
import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

// ── Paths ─────────────────────────────────────────────────────────────────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL_DATA = join(ROOT, 'public', 'data')
const REMOTE_BASE = '/srv/e2e-viz/data'

// ── Config ────────────────────────────────────────────────────────────────────

const DIRS = [
  {
    value: 'all',
    label: '全部数据',
    subpath: '',
    hint: 'glyphs + scenes + projection-map + vector-maps',
  },
  {
    value: 'scenes',
    label: 'Scene 数据',
    subpath: 'scenes',
    hint: '.glb 场景文件',
  },
  {
    value: 'glyphs',
    label: 'Glyph 图像',
    subpath: 'glyphs',
    hint: '.webp 场景缩略图',
  },
  {
    value: 'projection-map',
    label: 'Projection Map',
    subpath: 'projection-map',
    hint: 'JSON 索引与嵌入坐标',
  },
  {
    value: 'vector-maps',
    label: 'Vector Maps',
    subpath: 'vector-maps',
    hint: '向量地图数据',
  },
]

const MODES = [
  {
    value: 'incremental',
    label: '增量更新',
    hint: '仅上传新增和修改的文件，不删除远端多余文件',
    extraFlags: [],
    dryRun: false,
  },
  {
    value: 'full',
    label: '全量替换',
    hint: '上传所有文件，并删除远端有而本地无的文件',
    extraFlags: ['--delete'],
    dryRun: false,
  },
  {
    value: 'preview-incremental',
    label: '预览（增量）',
    hint: '模拟增量同步，不实际传输，查看哪些文件会变动',
    extraFlags: [],
    dryRun: true,
  },
  {
    value: 'preview-full',
    label: '预览（全量）',
    hint: '模拟全量替换，不实际传输，查看哪些文件会被删除',
    extraFlags: ['--delete'],
    dryRun: true,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = join(ROOT, '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/)
    if (match) process.env[match[1]] = match[2].trim()
  }
}

function runRsync(args) {
  return new Promise((resolve) => {
    const proc = spawn('rsync', args, { stdio: 'inherit' })
    proc.on('close', resolve)
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.error('\nrsync 未找到，请先安装：brew install rsync')
        process.exit(1)
      }
      throw err
    })
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  loadEnvLocal()

  console.log()
  p.intro(' e2e-viz · 数据同步工具 ')

  // ── SSH 连接信息 ────────────────────────────────────────────────────────────

  let host = process.env.DATA_SYNC_HOST
  let user = process.env.DATA_SYNC_USER

  if (!host || !user) {
    p.note(
      '未检测到环境变量。在项目根目录创建 .env.local 可跳过此步骤：\n\n  DATA_SYNC_HOST=1.2.3.4\n  DATA_SYNC_USER=root',
      '提示',
    )
  }

  if (!host) {
    host = await p.text({
      message: '服务器地址（IP 或域名）',
      placeholder: '1.2.3.4',
      validate: (v) => (v.trim() ? undefined : '不能为空'),
    })
    if (p.isCancel(host)) return p.cancel('已取消')
  }

  if (!user) {
    user = await p.text({
      message: 'SSH 用户名',
      initialValue: 'root',
      validate: (v) => (v.trim() ? undefined : '不能为空'),
    })
    if (p.isCancel(user)) return p.cancel('已取消')
  }

  // ── 选择目录 ────────────────────────────────────────────────────────────────

  const dirValue = await p.select({
    message: '同步哪个数据目录？',
    options: DIRS.map(({ value, label, hint }) => ({ value, label, hint })),
  })
  if (p.isCancel(dirValue)) return p.cancel('已取消')

  // ── 选择同步方式 ────────────────────────────────────────────────────────────

  const modeValue = await p.select({
    message: '选择同步方式',
    options: MODES.map(({ value, label, hint }) => ({ value, label, hint })),
  })
  if (p.isCancel(modeValue)) return p.cancel('已取消')

  // ── 构建 rsync 参数 ─────────────────────────────────────────────────────────

  const dir = DIRS.find((d) => d.value === dirValue)
  const mode = MODES.find((m) => m.value === modeValue)

  const localSrc = dir.subpath ? join(LOCAL_DATA, dir.subpath) + '/' : LOCAL_DATA + '/'
  const remoteDst = dir.subpath
    ? `${user}@${host}:${REMOTE_BASE}/${dir.subpath}/`
    : `${user}@${host}:${REMOTE_BASE}/`

  const sshKey = process.env.DATA_SYNC_SSH_KEY
  const rsyncFlags = [
    '--archive',
    '--verbose',
    '--compress',
    '--human-readable',
    '--exclude=.DS_Store',
    ...(sshKey ? ['-e', `ssh -i ${sshKey}`] : []),
    ...(mode.dryRun ? ['--dry-run'] : []),
    ...mode.extraFlags,
  ]

  // ── 展示同步计划 ────────────────────────────────────────────────────────────

  p.note(
    [
      `本地路径   ${localSrc}`,
      `远端路径   ${remoteDst}`,
      `同步方式   ${mode.label}`,
      `rsync 参数 ${rsyncFlags.join(' ')}`,
      ...(mode.dryRun ? ['\n（预览模式，不会实际传输任何文件）'] : []),
    ].join('\n'),
    '同步计划',
  )

  // ── 确认执行 ────────────────────────────────────────────────────────────────

  if (!mode.dryRun) {
    const ok = await p.confirm({ message: '确认执行同步？' })
    if (p.isCancel(ok) || !ok) return p.cancel('已取消')
  }

  console.log()

  // ── 执行 rsync ──────────────────────────────────────────────────────────────

  const code = await runRsync([...rsyncFlags, localSrc, remoteDst])

  console.log()
  if (code === 0) {
    p.outro(
      mode.dryRun ? '预览完成，以上为模拟结果，未实际传输任何文件。' : '数据同步完成。',
    )
  } else {
    const hint =
      code === 127
        ? '远端服务器未安装 rsync，请先执行：yum install -y rsync'
        : code === 255
          ? 'SSH 连接失败，请检查服务器地址、用户名及 SSH 公钥配置'
          : '请检查上方 rsync 输出'
    p.outro(`同步失败（退出码 ${code}）：${hint}`)
    process.exit(code)
  }
}

main()
