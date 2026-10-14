export const cubicasaGallery = [
  { id: '7813', note: 'Architectural drawing · PNG + paired SVG', folder: 'high_quality_architectural/7813' },
  { id: '13852', note: 'Floor plan · PNG + paired SVG', folder: 'high_quality/13852' },
  { id: '14175', note: 'Color drawing · PNG + paired SVG', folder: 'colorful/14175' },
  ...[
    '1654', '5748', '1611', '8154', '6257', '1241', '1089', '4972', '6655', '282',
    '642', '9296', '7677', '3096', '638', '4820', '9031', '6387', '5741', '6320',
    '5742', '1331', '3691', '9935', '6552', '1660', '5996', '2039', '1846', '9066',
    '8690', '1425', '5640', '9361', '3886', '4801', '5698',
  ].map(id => ({ id, note: 'Architectural drawing · PNG + paired SVG', folder: `high_quality_architectural/${id}` })),
].map(sample => ({ ...sample, name: sample.id, image: `/samples/${sample.id}/drawing.png`, source: `/samples/${sample.id}/source.svg` }));

export const cubicasaSamples = cubicasaGallery.slice(0, 3);
