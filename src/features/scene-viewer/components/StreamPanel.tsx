import { useCallback, useMemo, useState } from 'react'
import { useSceneStore } from '../context'
import type { StreamMeta } from '../types'
import styles from './StreamPanel.module.css'

// ── Tree types ────────────────────────────────────────────────────────────────

interface TreeFolder {
  kind: 'folder'
  name: string
  path: string
  children: TreeNode[]
}

interface TreeLeaf {
  kind: 'stream'
  name: string
  path: string
  meta: StreamMeta
}

type TreeNode = TreeFolder | TreeLeaf

// ── Tree builder ──────────────────────────────────────────────────────────────

function insertNode(
  siblings: TreeNode[],
  segments: string[],
  fullPath: string,
  meta: StreamMeta,
  parentPath: string,
): void {
  const [head, ...rest] = segments
  const nodePath = `${parentPath}/${head}`

  if (rest.length === 0) {
    siblings.push({ kind: 'stream', name: head, path: fullPath, meta })
    return
  }

  let folder = siblings.find((n): n is TreeFolder => n.kind === 'folder' && n.name === head)
  if (!folder) {
    folder = { kind: 'folder', name: head, path: nodePath, children: [] }
    siblings.push(folder)
  }
  insertNode(folder.children, rest, fullPath, meta, nodePath)
}

function buildTree(streamsMeta: Record<string, StreamMeta>): TreeNode[] {
  const roots: TreeNode[] = []
  for (const [path, meta] of Object.entries(streamsMeta)) {
    const segments = path.replace(/^\//, '').split('/')
    insertNode(roots, segments, path, meta, '')
  }
  return roots
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  point:    '#c8c8c8',
  polyline: '#f8a94b',
  polygon:  '#6ea8fe',
  cuboid:   '#4dd0e1',
  image:    '#fdd835',
  pose:     '#78909c',
}

function TypeIcon({ type }: { type: string }) {
  const color = TYPE_COLORS[type] ?? '#888'
  switch (type) {
    case 'point':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12">
          <circle cx="6" cy="6" r="3" fill={color} />
        </svg>
      )
    case 'polyline':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12">
          <polyline points="1,10 4,3 8,8 11,2" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'polygon':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12">
          <polygon points="6,1 11,4 11,8 6,11 1,8 1,4" stroke={color} strokeWidth="1.3" fill={color} fillOpacity="0.2" />
        </svg>
      )
    case 'cuboid':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="1" y="4" width="6" height="6" stroke={color} strokeWidth="1.2" fill="none" />
          <polyline points="1,4 4,1 11,1 11,7 7,10" stroke={color} strokeWidth="1.2" fill="none" />
          <line x1="4" y1="1" x2="4" y2="7" stroke={color} strokeWidth="1.2" />
          <line x1="7" y1="10" x2="7" y2="4" stroke={color} strokeWidth="1.2" />
        </svg>
      )
    case 'image':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="1" y="2" width="10" height="8" stroke={color} strokeWidth="1.2" fill="none" />
          <circle cx="4" cy="5" r="1" fill={color} />
          <polyline points="1,9 4,6 7,8 9,5 11,9" stroke={color} strokeWidth="1.2" fill="none" />
        </svg>
      )
    case 'pose':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12">
          <circle cx="6" cy="6" r="4" stroke={color} strokeWidth="1.2" fill="none" />
          <circle cx="6" cy="6" r="1.5" fill={color} />
        </svg>
      )
    default:
      return <span style={{ width: 12, display: 'inline-block' }} />
  }
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10"
      style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', flexShrink: 0 }}
    >
      <polyline points="3,2 7,5 3,8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function EyeIcon({ on }: { on: boolean }) {
  return on ? (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <ellipse cx="7" cy="7" rx="5.5" ry="3.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <circle cx="7" cy="7" r="2" fill="currentColor" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <ellipse cx="7" cy="7" rx="5.5" ry="3.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <circle cx="7" cy="7" r="2" fill="currentColor" opacity="0.2" />
      <line x1="2.5" y1="2.5" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M1,3.5 L1,10 L11,10 L11,5 L5.5,5 L4.5,3.5 Z" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  )
}

// ── Tree rows ─────────────────────────────────────────────────────────────────

interface StreamRowProps {
  leaf: TreeLeaf
  depth: number
  visible: boolean
  toggleable: boolean
  onToggle: (path: string) => void
}

function StreamRow({ leaf, depth, visible, toggleable, onToggle }: StreamRowProps) {
  return (
    <div className={styles.streamRow} style={{ paddingLeft: 8 + depth * 14 }}>
      <span className={styles.typeIcon}>
        <TypeIcon type={leaf.meta.type} />
      </span>
      <span className={`${styles.streamName}${!visible ? ` ${styles.dimmed}` : ''}`}>
        {leaf.name}
      </span>
      {toggleable && (
        <button
          className={`${styles.visBtn}${!visible ? ` ${styles.visBtnOff}` : ''}`}
          onClick={() => onToggle(leaf.path)}
          title={visible ? 'Hide layer' : 'Show layer'}
        >
          <EyeIcon on={visible} />
        </button>
      )}
    </div>
  )
}

interface FolderRowProps {
  folder: TreeFolder
  depth: number
  expanded: boolean
  onToggle: (path: string) => void
}

function FolderRow({ folder, depth, expanded, onToggle }: FolderRowProps) {
  return (
    <div
      className={styles.folderRow}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onToggle(folder.path)}
    >
      <ChevronIcon expanded={expanded} />
      <FolderIcon />
      <span className={styles.folderName}>{folder.name}</span>
    </div>
  )
}

interface NodeViewProps {
  node: TreeNode
  depth: number
  collapsed: Set<string>
  visibleStreams: Record<string, boolean>
  onToggleFolder: (path: string) => void
  onToggleStream: (path: string) => void
}

function NodeView({ node, depth, collapsed, visibleStreams, onToggleFolder, onToggleStream }: NodeViewProps) {
  if (node.kind === 'stream') {
    const toggleable = node.path in visibleStreams
    return (
      <StreamRow
        leaf={node}
        depth={depth}
        visible={visibleStreams[node.path] ?? true}
        toggleable={toggleable}
        onToggle={onToggleStream}
      />
    )
  }

  const expanded = !collapsed.has(node.path)
  return (
    <>
      <FolderRow folder={node} depth={depth} expanded={expanded} onToggle={onToggleFolder} />
      {expanded &&
        node.children.map((child) => (
          <NodeView
            key={child.path}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            visibleStreams={visibleStreams}
            onToggleFolder={onToggleFolder}
            onToggleStream={onToggleStream}
          />
        ))}
    </>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface StreamPanelProps {
  onClose: () => void
}

export function StreamPanel({ onClose }: StreamPanelProps) {
  const streamsMeta = useSceneStore((s) => s.streamsMeta)
  const visibleStreams = useSceneStore((s) => s.visibleStreams)
  const toggleStream = useSceneStore((s) => s.toggleStream)

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['/camera']))

  const tree = useMemo(() => buildTree(streamsMeta), [streamsMeta])
  const streamCount = Object.keys(streamsMeta).length

  const handleToggleFolder = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>
          Streams
          <span className={styles.count}>({streamCount})</span>
        </span>
        <button className={styles.closeBtn} onClick={onClose} title="Collapse panel">
          ×
        </button>
      </div>
      <div className={styles.tree}>
        {tree.map((node) => (
          <NodeView
            key={node.path}
            node={node}
            depth={0}
            collapsed={collapsed}
            visibleStreams={visibleStreams}
            onToggleFolder={handleToggleFolder}
            onToggleStream={toggleStream}
          />
        ))}
      </div>
    </div>
  )
}
