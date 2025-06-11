## CSS Features
- `--variablur-filter`: CSS filter string (e.g. `blur(20px)`)
- `--variablur-direction`: `top`, `bottom`, `left`, `right`
- `--variablur-offset`: Distance from edge for blur/fade effect (`px`, `%`, or `calc()`)
- `--variablur-layers`: Number of blur layers
- `--variablur-color`: Overlay color
- `--variablur-glass-refraction`: Glass refraction intensity (1.0 = no refraction, 2.0 = strong)
- `--variablur-glass-offset`: Glass effect displacement area size in pixels

## JS Features
- `attach(element)`: Attach variable blur to an element and its descendants (starts polling for that element)
- `detach(element)`: Remove variable blur from an element (stops polling for that element)
- `update(element)`: Manually update blur on an element
- `hasAnyVariablurCSS(element)`: Check if element uses variable blur CSS variables
- `startPolling()`: Start global polling for all attached elements
- `stopPolling()`: Stop global polling
- `calcBlurPerLayer`, `exponentialBlurLayers`: Math utilities for blur distribution
- `calculateRefractionMap(refraction, offset, width, height)`: Generate displacement maps for glass effects
- `createGlassSVGFilter(element)`: Create SVG filters for glass refraction effects
