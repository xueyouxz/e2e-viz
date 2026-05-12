import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useAppStore } from '@/app/appStore'
import { DARK_TOKENS, LIGHT_TOKENS, ThemeTokensContext } from './themeTokens'

export function ThemeTokensProvider({ children }: { children: ReactNode }) {
  const theme = useAppStore((s) => s.theme)
  const tokens = useMemo(() => (theme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS), [theme])
  return (
    <ThemeTokensContext.Provider value={tokens}>
      {children}
    </ThemeTokensContext.Provider>
  )
}
