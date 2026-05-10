interface ObjectColorConfig {
  color: string
  strokeOpacity: number
}

const OBJECT_CLASS_COLORS: Record<number, ObjectColorConfig> = {
  0:  { color: '#6B7280', strokeOpacity: 0.8 }, // unknown
  1:  { color: '#DC2626', strokeOpacity: 0.8 }, // barrier
  2:  { color: '#D97706', strokeOpacity: 0.8 }, // bicycle
  3:  { color: '#7C3AED', strokeOpacity: 0.8 }, // bus
  4:  { color: '#4B8CF8', strokeOpacity: 0.8 }, // car
  5:  { color: '#EA580C', strokeOpacity: 0.8 }, // construction_vehicle
  6:  { color: '#0D9488', strokeOpacity: 0.8 }, // motorcycle
  7:  { color: '#16A34A', strokeOpacity: 0.8 }, // pedestrian
  8:  { color: '#E11D48', strokeOpacity: 0.8 }, // traffic_cone
  9:  { color: '#4F46E5', strokeOpacity: 0.8 }, // trailer
  10: { color: '#0284C7', strokeOpacity: 0.8 }, // truck
}

const FALLBACK: ObjectColorConfig = { color: '#9CA3AF', strokeOpacity: 0.64 }

export function getObjectColor(classId: number): ObjectColorConfig {
  return OBJECT_CLASS_COLORS[classId] ?? FALLBACK
}
