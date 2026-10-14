export const typeNames = { wall: 'Wall', slab: 'Slab', column: 'Column', window: 'Window', door: 'Door opening', roof: 'Roof' };
export const projects = [
  { name: 'Courtyard Residence', note: 'Residential · 5 floors · Inner courtyard', floors: 5, width: 12, depth: 10 },
  { name: 'A Modest Home', note: 'Residential · 2 floors · Open porch', floors: 2, width: 14, depth: 7 },
  { name: 'Layers of Light', note: 'Workspace · 3 floors · Daylight atrium', floors: 3, width: 9, depth: 12 },
];
const rectangle = (x, z, w, d) => [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
export function sampleModel(index = 0) {
  const project = projects[index] || projects[0];
  const components = [], { width: w, depth: d, floors } = project;
  const add = (type, floor, polygon, height, elevation) => components.push({
    id: `sample-${index}-${components.length}`, type, floor, polygon, height, elevation,
    source: `${project.name} / floor ${floor + 1} plan`, assumed: false,
  });
  const ring = (floor, y, type = 'slab') => {
    for (const r of [[-w / 2, -d / 2, w, 2.5], [-w / 2, d / 2 - 2.5, w, 2.5], [-w / 2, -d / 2 + 2.5, 2.5, d - 5], [w / 2 - 2.5, -d / 2 + 2.5, 2.5, d - 5]]) add(type, floor, rectangle(...r), .22, y);
  };
  for (let floor = 0; floor < floors; floor++) {
    const y = floor * 3.2;
    ring(floor, y);
    for (const x of [-w / 2 + .1, w / 2 - .4]) {
      for (const z of [-d / 2 + .1, 0, d / 2 - .4]) add('column', floor, rectangle(x, z, .3, .3), 3, y + .22);
    }
    for (const x of [-w / 2, w / 2 - .18]) add('wall', floor, rectangle(x, -d / 2, .18, d), 3, y + .22);
    for (const z of [-d / 2, d / 2 - .12]) {
      for (let panel = 0; panel < 6; panel++) {
        const x = -w / 2 + panel * w / 6;
        add(panel % 3 === (index + floor) % 3 ? 'wall' : 'window', floor, rectangle(x, z, w / 6 - .06, .12), 2.7, y + .42);
      }
    }
    for (const z of [-d / 2 + 2.5, d / 2 - 2.6]) add('wall', floor, rectangle(-w / 2 + 2.5, z, w - 5, .1), .8, y + .22);
  }
  ring(floors - 1, floors * 3.2, 'roof');
  return { name: project.name, sample: true, unit: 'm', floors, components, warnings: ['Demonstration model with design dimensions; not reconstructed from drawing.'] };
}

export function phaseAt(offset, step, reduced = false) {
  const p = Math.max(0, offset / Math.max(1, step)) % 3;
  const chapter = Math.floor(p), fraction = p - chapter;
  if (reduced) return { chapter, next: (chapter + 1) % 3, mix: 0 };
  const t = Math.min(1, Math.max(0, (fraction - .2) / .8));
  return { chapter, next: (chapter + 1) % 3, mix: t * t * (3 - 2 * t) };
}

export function parseDXF(text) {
  if (text.length > 5 * 1024 * 1024 || text.includes('\0')) throw new Error('Only ASCII DXF up to 5 MB is supported.');
  const lines = text.trim().split(/\r?\n/);
  if (lines.length % 2 || !text.includes('ENTITIES')) throw new Error('File is not a valid ASCII DXF.');
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    if (!/^\s*\d+\s*$/.test(lines[i])) throw new Error('Invalid DXF group code.');
    pairs.push([Number(lines[i]), lines[i + 1].trim()]);
  }
  const unitIndex = pairs.findIndex(([code, value]) => code === 9 && value === '$INSUNITS');
  const unit = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' }[pairs[unitIndex + 1]?.[1]] || '';
  const outlines = [];
  let inside = false, ignored = 0;
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 2 && pairs[i][1] === 'ENTITIES') { inside = true; continue; }
    if (!inside || pairs[i][0] !== 0) continue;
    const entity = pairs[i][1];
    if (entity === 'ENDSEC') { inside = false; continue; }
    let end = i + 1;
    while (end < pairs.length && pairs[end][0] !== 0) end++;
    const fields = pairs.slice(i + 1, end);
    const layer = fields.find(([code]) => code === 8)?.[1] || '0';
    const type = /wall|tuong|tường/i.test(layer) ? 'wall' : /column|cot|cột/i.test(layer) ? 'column' : /slab|san|sàn/i.test(layer) ? 'slab' : null;
    if (entity !== 'LWPOLYLINE' || !type) { ignored++; i = end - 1; continue; }
    const closed = Number(fields.find(([code]) => code === 70)?.[1]) & 1;
    if (!closed || fields.some(([code, value]) => [42, 38, 39].includes(code) && Number(value) !== 0)
      || fields.some(([code, value]) => [210, 220].includes(code) && Number(value) !== 0)
      || fields.some(([code, value]) => code === 230 && Number(value) !== 1)) { ignored++; i = end - 1; continue; }
    const polygon = [];
    for (let j = 0; j < fields.length; j++) {
      if (fields[j][0] === 10) {
        if (fields[j + 1]?.[0] !== 20) throw new Error('DXF boundary missing Y coordinate.');
        polygon.push([Number(fields[j][1]), Number(fields[j + 1][1])]);
      }
    }
    if (polygon.length > 1 && polygon[0].every((n, k) => n === polygon.at(-1)[k])) polygon.pop();
    const area = polygon.reduce((sum, [x, y], j) => {
      const next = polygon[(j + 1) % polygon.length]; return sum + x * next[1] - next[0] * y;
    }, 0);
    if (polygon.length < 3 || polygon.length > 200 || polygon.some(p => p.some(n => !Number.isFinite(n) || Math.abs(n) > 1e9)) || !Number.isFinite(area) || Math.abs(area) < 1e-8) throw new Error('Invalid boundary or geometric bounds exceeded.');
    // shortcut: only simple straight closed outlines; add topology repair when broader CAD support is introduced.
    for (let a = 0; a < polygon.length; a++) for (let b = a + 2; b < polygon.length; b++) {
      if (a === 0 && b === polygon.length - 1) continue;
      const p = polygon[a], q = polygon[(a + 1) % polygon.length], r = polygon[b], s = polygon[(b + 1) % polygon.length];
      const cross = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
      if (cross(p, q, r) * cross(p, q, s) <= 0 && cross(r, s, p) * cross(r, s, q) <= 0 && Math.max(Math.min(p[0], q[0]), Math.min(r[0], s[0])) <= Math.min(Math.max(p[0], q[0]), Math.max(r[0], s[0])) && Math.max(Math.min(p[1], q[1]), Math.min(r[1], s[1])) <= Math.min(Math.max(p[1], q[1]), Math.max(r[1], s[1]))) throw new Error('Boundary self-intersects; please fix in CAD and retry.');
    }
    outlines.push({ id: fields.find(([code]) => code === 5)?.[1] || `outline-${outlines.length}`, polygon, type, layer });
    if (outlines.length > 1000) throw new Error('Drawing exceeds limit of 1,000 boundaries.');
    i = end - 1;
  }
  if (!outlines.length) throw new Error('No closed straight LWPOLYLINE boundaries found on WALL, COLUMN, or SLAB layers.');
  return { unit, outlines, ignored };
}

export function drawingBounds(components) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const c of components) for (const [x, z] of c.polygon) {
    minX = Math.min(minX, x); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z);
  }
  return { minX, minZ, width: maxX - minX, depth: maxZ - minZ };
}

export function reconstructDrawing(parsed, { unit, height, name = 'DXF Drawing' }) {
  const scale = { mm: .001, cm: .01, m: 1, in: .0254, ft: .3048 }[unit];
  if (!scale || !Number.isFinite(height) || height < .1 || height > 100) throw new Error('Please confirm unit and height between 0.1 and 100 m.');
  const components = parsed.outlines.map((o, i) => ({ id: `dxf-${i}-${o.id}`, type: o.type, floor: 0, polygon: o.polygon.map(p => p.map(n => n * scale)), height: o.type === 'slab' ? .2 : height, elevation: 0, source: `${name} / ${o.layer} / ${o.id}`, assumed: true }));
  const bounds = drawingBounds(components);
  if (bounds.width > 10000 || bounds.depth > 10000) throw new Error('Dimensions exceed 10 km. Please verify drawing unit.');
  return { name, sample: false, unit: 'm', floors: 1, components, warnings: [`${parsed.ignored} entities were not reconstructed. Only outlines are extruded; doors, roofs, stairs, or multiple floors not recognized.`, 'Height is confirmed by you; slab thickness 0.2 m is an editable assumption.'] };
}
