import { create } from 'zustand'

export type Theme = 'dark' | 'light'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('app-theme')
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem('app-theme', theme)
}

interface AppState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useAppStore = create<AppState>((set) => {
  const initial = getInitialTheme()
  applyTheme(initial)
  return {
    theme: initial,
    setTheme: (theme) => {
      applyTheme(theme)
      set({ theme })
    },
    toggleTheme: () =>
      set((state) => {
        const next: Theme = state.theme === 'dark' ? 'light' : 'dark'
        applyTheme(next)
        return { theme: next }
      }),
  }
})
