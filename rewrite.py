import re

with open('src/features/projection-map/components/ProjectionMapView.tsx', 'r') as f:
    content = f.read()

# Add SVG inline icon definition if not exists
svg_icon = """const LassoIcon = () => (
  <svg className={styles.lassoIcon} viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
    <path d="M70.582857 461.421714c0 196.717714 168.850286 307.291429 379.702857 307.291429 16.274286 0 33.005714-0.859429 49.718857-1.718857 17.554286 7.296 38.582857 11.574857 62.134858 11.574857 64.292571 0 129.426286-17.993143 187.282285-48.859429 1.28 6.436571 1.718857 13.293714 1.718857 20.150857 0 51.419429-29.147429 101.558857-77.147428 132.004572-12.434286 8.996571-21.430857 17.993143-21.430857 33.426286 0 15.853714 12.873143 29.568 33.005714 29.568 9.435429 0 14.994286-2.56 23.149714-7.716572 66.011429-42.861714 106.715429-114.432 106.715429-188.580571 0-19.712-2.56-38.125714-7.716572-55.698286 86.125714-65.572571 145.718857-162.011429 145.718858-267.867429 0-203.995429-181.723429-345.856-398.994286-345.856-237.860571 0-483.876571 155.995429-483.876572 382.281143z m64.713143 0.438857c0-186.861714 214.272-317.988571 419.565714-317.988571 179.565714 0 334.281143 111.414857 334.281143 280.685714 0 81.005714-45.421714 156.013714-111.433143 209.590857-35.986286-47.579429-94.281143-77.568-161.572571-77.568-98.139429 0-172.288 51.419429-172.288 127.268572 0 7.296 0.859429 14.153143 2.578286 20.571428C275.437714 702.281143 135.314286 621.714286 135.314286 461.860571zM509.001143 681.691429c0-35.986286 50.139429-59.995429 112.274286-59.995429 42.861714 0 79.725714 18.432 103.314285 48.420571-50.157714 27.867429-107.154286 44.141714-162.450285 44.141715-30.848 0-53.138286-11.995429-53.138286-32.548572z" />
  </svg>
)

"""
if "const LassoIcon" not in content:
    content = content.replace("// ─── Component ───────────────────────────────────────────────────────────────", svg_icon + "\n// ─── Component ───────────────────────────────────────────────────────────────")

overlay_html = """
      <div className={styles.controlsOverlay}>
        <div className={styles.datasetToggles}>
          <button type="button" className={showVal ? styles.datasetActive : styles.datasetBtn} onClick={() => setShowVal(v => !v)}>val</button>
          <button type="button" className={showTrain ? styles.datasetActive : styles.datasetBtn} onClick={() => setShowTrain(v => !v)}>train</button>
        </div>
        <button type="button" className={lassoActive ? styles.lassoActive : styles.lassoBtn} onClick={() => setLassoActive(v => !v)} title="Lasso toggle">
          <LassoIcon />
        </button>
      </div>
"""

# inject overlay before <svg
if "controlsOverlay" not in content:
    content = content.replace("      <svg\n        ref={svgRef}", overlay_html + "\n      <svg\n        ref={svgRef}")

with open('src/features/projection-map/components/ProjectionMapView.tsx', 'w') as f:
    f.write(content)
