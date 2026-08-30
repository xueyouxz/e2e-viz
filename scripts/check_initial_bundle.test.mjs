import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertInitialBundleBudget,
  collectInitialProjectionAssets,
  findForbiddenInitialChunks
} from './check_initial_bundle.mjs'

test('finds scene-viewer-only chunks preloaded by the application shell', () => {
  const html = `
    <link rel="modulepreload" href="/assets/react-vendor-abc.js">
    <link rel="modulepreload" href="/assets/three-core-def.js">
    <link href="/assets/r3f-ghi.js" rel="modulepreload">
    <link href="/assets/SceneViewer-jkl.js" rel="modulepreload">
    <script type="module" src="/assets/index-main.js"></script>
  `

  assert.deepEqual(findForbiddenInitialChunks(html), [
    '/assets/three-core-def.js',
    '/assets/r3f-ghi.js',
    '/assets/SceneViewer-jkl.js'
  ])
})

test('collects only the static dependency graph needed by the projection route', () => {
  const manifest = {
    'src/main.tsx': {
      file: 'assets/index.js',
      isEntry: true,
      imports: ['_react.js', '_router.js'],
      dynamicImports: ['src/features/projection-map/index.tsx', 'src/pages/SceneViewerRoute.tsx']
    },
    'src/features/projection-map/index.tsx': {
      file: 'assets/ProjectionMapPage.js',
      imports: ['_react.js', '_projection-data.js']
    },
    'src/pages/SceneViewerRoute.tsx': {
      file: 'assets/SceneViewerRoute.js',
      imports: ['_scene-viewer.js']
    },
    '_react.js': { file: 'assets/react-vendor.js' },
    '_router.js': { file: 'assets/router.js', imports: ['_react.js'] },
    '_projection-data.js': { file: 'assets/useProjectionMapData.js' },
    '_scene-viewer.js': { file: 'assets/SceneViewer.js' }
  }

  assert.deepEqual(collectInitialProjectionAssets(manifest).sort(), [
    'assets/ProjectionMapPage.js',
    'assets/index.js',
    'assets/react-vendor.js',
    'assets/router.js',
    'assets/useProjectionMapData.js'
  ])
})

test('rejects a projection route graph over 150 KiB gzip', () => {
  assert.throws(
    () =>
      assertInitialBundleBudget(
        [
          { file: 'assets/index.js', gzipBytes: 80 * 1024 },
          { file: 'assets/ProjectionMapPage.js', gzipBytes: 71 * 1024 }
        ],
        150 * 1024
      ),
    /exceeds 150\.0 KiB gzip/
  )
})
