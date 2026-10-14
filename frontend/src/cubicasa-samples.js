export const cubicasaSamples = [
  { id: '7813', name: 'CubeCasa 7813', note: 'Architectural drawing · PNG + paired SVG', folder: 'high_quality_architectural/7813' },
  { id: '13852', name: 'CubeCasa 13852', note: 'Floor plan · PNG + paired SVG', folder: 'high_quality/13852' },
  { id: '14175', name: 'CubeCasa 14175', note: 'Color drawing · PNG + paired SVG', folder: 'colorful/14175' },
].map(sample => ({ ...sample, image: `/samples/${sample.id}/drawing.png`, source: `/samples/${sample.id}/source.svg` }));
