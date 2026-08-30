import type { ComponentType } from 'react'
import type { StreamRendererProps, StreamType } from './types'
import { CuboidRenderer } from './renderers/CuboidRenderer'
import { PathRenderer } from './renderers/PathRenderer'
import { PolygonRenderer } from './renderers/PolygonRenderer'
import { PointRenderer } from './renderers/PointRenderer'
import { ImageRenderer } from './renderers/ImageRenderer'

export const rendererRegistry: Partial<Record<StreamType, ComponentType<StreamRendererProps>>> = {
  cuboid: CuboidRenderer,
  polyline: PathRenderer,
  polygon: PolygonRenderer,
  point: PointRenderer,
  image: ImageRenderer
  // pose is intentionally omitted — handled separately as egoPose
}
