import assert from 'node:assert/strict'
import test from 'node:test'
import { assertBudget, bundleGroups, collectAssets } from './check_bundle.mjs'

function manifest() {
  return {
    'src/app/main.tsx': {
      isEntry: true,
      file: 'assets/index-shell.js',
      imports: ['react'],
      dynamicImports: ['src/features/projection-map/index.tsx']
    },
    react: { file: 'assets/shared.js', css: ['assets/shared.css'] },
    'src/features/projection-map/index.tsx': {
      file: 'assets/index-map.js',
      imports: ['react'],
      dynamicImports: ['src/features/scene-viewer/index.ts']
    },
    'src/app/SceneViewerRoute.tsx': {
      file: 'assets/route.js',
      imports: ['src/features/scene-viewer/index.ts']
    },
    'src/features/scene-viewer/index.ts': {
      file: 'assets/index-scene.js',
      imports: ['react'],
      css: ['assets/scene.css']
    }
  }
}

test('separates renamed lazy modules and counts shared assets only once', () => {
  assert.deepEqual(bundleGroups(manifest()), {
    initial: ['assets/index-shell.js', 'assets/shared.js', 'assets/index-map.js'],
    scene: ['assets/route.js', 'assets/index-scene.js'],
    css: ['assets/shared.css', 'assets/scene.css']
  })
})

test('rejects eager scene imports without relying on chunk filename prefixes', () => {
  const data = manifest()
  data['src/features/projection-map/index.tsx'].imports.push('src/features/scene-viewer/index.ts')
  assert.throws(() => bundleGroups(data), /eagerly imports/)
})

test('reports missing manifest entries instead of silently measuring zero bytes', () => {
  const data = manifest()
  delete data['src/features/scene-viewer/index.ts']
  assert.throws(() => bundleGroups(data), /manifest entry is missing/)
})

test('terminates on cyclic imports and deduplicates styles', () => {
  assert.deepEqual(
    collectAssets(
      {
        a: { file: 'a.js', imports: ['b'], css: ['a.css'] },
        b: { file: 'b.js', imports: ['a'], css: ['a.css'] }
      },
      ['a']
    ),
    { scripts: ['a.js', 'b.js'], styles: ['a.css'] }
  )
})

test('enforces the configured byte budget including its exact boundary', () => {
  assert.equal(assertBudget('initial', [{ bytes: 150 * 1024 }], 150), 150 * 1024)
  assert.throws(() => assertBudget('initial', [{ bytes: 150 * 1024 + 1 }], 150), /exceeds 150 KiB/)
})
