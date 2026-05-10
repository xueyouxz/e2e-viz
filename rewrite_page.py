import re

with open('src/features/projection-map/pages/ProjectionMapPage.tsx', 'r') as f:
    content = f.read()

# remove mode and lasso states
content = re.sub(r"  const \[mode, setMode\].*\n", "", content)
content = re.sub(r"  const \[lassoActive, setLassoActive\].*\n", "", content)

# remove handleModeChange
content = re.sub(r"  // Deactivate lasso when switching modes\.\n  const handleModeChange = useCallback\(\(next: MapDisplayMode\) => \{\n    setMode\(next\)\n    setLassoActive\(false\)\n  \}, \[\]\)\n", "", content)

# remove headerRight controls
header_right = r"""        <div className=\{styles\.headerRight\}>
          \{\/\* Lasso toggle \*\/\}
          <button
            type='button'
            className=\{lassoActive \? styles\.lassoActive : styles\.lassoBtn\}
            onClick=\{\(\) => setLassoActive\(v => !v\)\}
            title='Lasso select scenes'
          >
            <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
              <path d='M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z' strokeDasharray='3 2' />
              <path d='M9 12l2 2 4-4' />
            </svg>
            Lasso
          </button>

          \{\/\* Mode selector \*\/\}
          <div className=\{styles\.controls\} role='radiogroup' aria-label='Map display mode'>
            \{MODES\.map\(opt => \(
              <button
                key=\{opt\.id\}
                type='button'
                className=\{opt\.id === mode \? styles\.activeMode : styles\.modeButton\}
                aria-checked=\{opt\.id === mode\}
                role='radio'
                onClick=\{\(\) => handleModeChange\(opt\.id\)\}
              >
                \{opt\.label\}
              </button>
            \)\)\}
          </div>
        </div>"""
content = re.sub(header_right, "", content)

# remove mode and lasso props from ProjectionMapView
content = re.sub(r"            mode=\{mode\}\n", "", content)
content = re.sub(r"            lassoActive=\{lassoActive\}\n", "", content)

with open('src/features/projection-map/pages/ProjectionMapPage.tsx', 'w') as f:
    f.write(content)
