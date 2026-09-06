import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { buildGlyphSVG } from './render_glyphs.mjs'

const scene = {
  layers: {
    drivable_area: [
      {
        coordinates: [
          [
            [0, 0],
            [100, 0],
            [100, 40],
            [0, 40],
            [0, 0]
          ]
        ]
      }
    ],
    ped_crossing: [
      {
        coordinates: [
          [
            [40, 0],
            [50, 0],
            [50, 40],
            [40, 40],
            [40, 0]
          ]
        ]
      }
    ],
    divider: [
      {
        coordinates: [
          [0, 10],
          [100, 10]
        ]
      },
      {
        coordinates: [
          [0, 11],
          [100, 11]
        ]
      }
    ]
  }
}

test('rendering preserves normalized geometry, orientation and production palette', () => {
  const svg = buildGlyphSVG(scene)
  assert.match(svg, /viewBox="0 0 44 44"/)
  assert.match(svg, /rotate\(180 22 22\)/)
  assert.match(svg, /stroke="rgba\(53,93,120,\.92\)"/)
  assert.match(svg, /fill="rgba\(217,144,56,\.78\)"/)
  assert.ok(!svg.includes('<rect'))
  assert.deepEqual(
    new Set([...svg.matchAll(/<path d="([^"]+)"/g)].map(match => match[1])),
    new Set([
      'M 3.00,29.60 L 41.00,29.60 L 41.00,14.40 L 3.00,14.40 L 3.00,29.60 Z',
      'M 18.20,29.60 L 22.00,29.60 L 22.00,14.40 L 18.20,14.40 L 18.20,29.60 Z',
      'M 3.00,25.80 L 41.00,25.80',
      'M 3.00,25.42 L 41.00,25.42'
    ])
  )
  assert.equal(
    buildGlyphSVG({ layers: { drivable_area: [], ped_crossing: [], divider: [] } }),
    null
  )
})

test('glyphs leave a transparent atlas gutter', async () => {
  const resized = await sharp(Buffer.from(buildGlyphSVG(scene)), { density: 72 * 6 })
    .resize(100, 100)
    .png()
    .toBuffer()
  const { data, info } = await sharp(resized)
    .extend({ top: 2, bottom: 2, left: 2, right: 2, background: '#0000' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  for (let i = 0; i < 104; i++) {
    for (const [x, y] of [
      [0, i],
      [103, i],
      [i, 0],
      [i, 103]
    ]) {
      assert.equal(data[(y * info.width + x) * info.channels + 3], 0, `edge ${x},${y}`)
    }
  }
})

test('keylines cannot paint over a previously rendered neighboring divider', () => {
  const svg = buildGlyphSVG(scene)
  assert.ok(
    svg.lastIndexOf('stroke="rgba(255,255,255,.82)"') < svg.indexOf('stroke="rgba(53,93,120,.92)"')
  )
})
