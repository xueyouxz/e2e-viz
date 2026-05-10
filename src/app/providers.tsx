import type { PropsWithChildren } from 'react'

// Zustand stores are module-level singletons — no context Provider needed.
export function AppProviders({ children }: PropsWithChildren) {
  return <>{children}</>
}
