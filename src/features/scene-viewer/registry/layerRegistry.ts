import type { ComponentType } from 'react'
import type { StreamType, LayerRendererProps } from '../types'
import { CuboidRenderer } from '../renderers/CuboidRenderer'
import { PathRenderer } from '../renderers/PathRenderer'
import { PolygonRenderer } from '../renderers/PolygonRenderer'
import { PointRenderer } from '../renderers/PointRenderer'
import { ImageRenderer } from '../renderers/ImageRenderer'

export const layerRegistry: Partial<Record<StreamType, ComponentType<LayerRendererProps>>> = {
  cuboid: CuboidRenderer,
  polyline: PathRenderer,
  polygon: PolygonRenderer,
  point: PointRenderer,
  image: ImageRenderer,
  // pose is intentionally omitted — handled separately as egoPose
}
