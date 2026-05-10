import re

with open('src/features/projection-map/components/ProjectionMapView.module.css', 'r') as f:
    content = f.read()

# Update lassoBtn / dataset btn to be more flat and borderless
content = re.sub(
r"""\.lassoBtn,
\.lassoActive \{
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  cursor: pointer;
  background: #fff;
  border: 1px solid #e4e8f0;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgb\(15 23 42 / 6%\);
  transition: all 120ms;
\}""",
r""".lassoBtn,
.lassoActive {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.8);
  border: none;
  border-radius: 4px;
  transition: all 120ms;
}""", content)

content = re.sub(
r"""\.lassoBtn:hover \{
  color: #2563eb;
  background: #f8fafc;
  border-color: #cbd5e1;
\}

\.lassoActive \{
  color: #fff;
  background: #2563eb;
  border-color: #2563eb;
  box-shadow: 0 4px 12px rgb\(37 99 235 / 30%\);
\}""",
r""".lassoBtn:hover {
  color: #2563eb;
  background: rgba(255, 255, 255, 0.95);
}

.lassoActive {
  color: #2563eb;
  background: #e0e7ff;
}""", content)

content = re.sub(
r"""\.datasetToggles \{
  display: flex;
  gap: 4px;
  padding: 3px;
  background: rgba\(255, 255, 255, 0\.95\);
  border: 1px solid #e4e8f0;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgb\(15 23 42 / 6%\);
\}""",
r""".datasetToggles {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: rgba(255, 255, 255, 0.8);
  border: none;
  border-radius: 4px;
}""", content)

content = re.sub(
r"""\.datasetBtn,
\.datasetActive \{
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
  transition: all 120ms;
\}""",
r""".datasetBtn,
.datasetActive {
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 3px;
  transition: all 120ms;
}""", content)

with open('src/features/projection-map/components/ProjectionMapView.module.css', 'w') as f:
    f.write(content)
