export const demoPresets = [
  { id: 'terrace', name: 'Terrace Villa', description: '01 · Charcoal terraces, a lower garage and a long garden stair.', dimensions: '12 × 10 m building · 3 levels · 10.2 m high' },
  { id: 'portal', name: 'Portal Villa', description: '02 · A projecting concrete frame, timber fins and a tall white wing.', dimensions: '11.5 × 9 m building · 2 storeys · 8.8 m high' },
  { id: 'gable', name: 'Gable Villa', description: '03 · A white pitched roof, triangular glazing and a broad balcony.', dimensions: '11 × 9 m building · 2 storeys + attic · 10.5 m high' },
];

const rect = (x, z, w, d) => [[x,z], [x+w,z], [x+w,z+d], [x,z+d]];
const finishes = { charcoal: '#42464a', white: '#eeeae2', stone: '#b5aa95', timber: '#9b704c', metal: '#262d31', glass: '#a0bab8', green: '#607957', light: '#ffcf85', paving: '#cfcbc1' };

export function demoPresetModel(id) {
  const preset = demoPresets.find(p => p.id === id);
  if (!preset) throw new Error('Unknown architectural preset.');
  const components = [];
  const box = (label, type, floor, x, z, w, d, height, elevation, finish = 'white') => {
    const component = { id: `${id}-${components.length}`, label, type, floor, polygon: rect(x,z,w,d), height, elevation,
      color: finishes[finish], finish, source: `${preset.name} / designed ${label.toLowerCase()}`, assumed: true };
    components.push(component); return component;
  };
  const slab = (label, floor, x,z,w,d,y, finish = 'white', thickness = .22) => box(label,'slab',floor,x,z,w,d,thickness,y-thickness,finish);
  const beam = (label, floor, x,z,w,d,h,y, finish = 'metal') => box(label,'column',floor,x,z,w,d,h,y,finish);
  const glass = (label, floor, x,z,w,h,y) => box(label,'window',floor,x,z,w,.045,h,y,'glass');
  const facade = (floor, x,z,w,h,y) => {
    glass('Facade glazing',floor,x,z,w,h,y);
    for (let i = 0; i <= Math.ceil(w/1.4); i++) beam('Glazing mullion',floor,x+i*w/Math.ceil(w/1.4)-.025,z-.025,.05,.10,h,y);
    for (const level of [y, y+h-.06]) beam('Glazing transom',floor,x,z-.025,w,.10,.06,level);
  };
  const balcony = (floor,x,z,w,d,y) => {
    glass('Balcony glazing',floor,x,z+d,w,1.05,y);
    for (const side of [x,x+w-.045]) box('Balcony side glazing','window',floor,side,z,.045,d,1.05,y,'glass');
    beam('Balcony handrail',floor,x,z+d-.01,w,.065,.045,y+1.05);
    for (const side of [x,x+w-.045]) beam('Balcony side rail',floor,side,z,.045,d,.045,y+1.05);
  };
  const stairs = (floor,x,z,w,count,rise,tread,base = 0) => {
    for (let i=0; i<count; i++) {
      box(`Step ${i+1}`,'slab',floor,x,z-i*tread,w,tread+.01,(i+1)*rise,base,'paving');
      beam('Step light',floor,x+.12,z-i*tread+tread-.025,w-.24,.025,.018,base+(i+1)*rise-.04,'light');
    }
  };
  const planter = (floor,x,z,w,d,y) => {
    box('Planter','wall',floor,x,z,w,d,.42,y,'charcoal');
    box('Planting bed','slab',floor,x+.10,z+.10,w-.20,d-.20,.26,y+.42,'green');
    for (let i=0; i<Math.floor(w/.55); i++) {
      const cx=x+.3+i*.55, cz=z+d/2, r=Math.min(.26,d*.37);
      const shrub=box('Garden planting','column',floor,cx-r,cz-r,r*2,r*2,.32+(i%3)*.12,y+.58,'green');
      shrub.polygon=Array.from({length:8},(_,j)=>[cx+Math.cos(j*Math.PI/4)*r,cz+Math.sin(j*Math.PI/4)*r]);
    }
  };
  const shell = (floor,x,z,w,d,h,y, finish='white') => {
    box('Rear wall','wall',floor,x,z,w,.20,h,y,finish);
    for (const side of [x,x+w-.20]) box('Side wall','wall',floor,side,z,.20,d,h,y,finish);
  };
  const soffit = (floor,x,z,w,d,y) => {
    slab('Timber soffit',floor,x,z,w,d,y,'timber',.055);
    beam('Warm soffit strip',floor,x+.15,z+d-.20,w-.30,.04,.025,y-.08,'light');
  };

  slab('Site plinth',0,-7.2,-6.2,14.4,16.8,0,'charcoal',.18);
  slab('Entry paving',0,-2,4.4,4,6.1,.03,'paving',.04);
  for (const x of [-6.7,4.9]) planter(0,x,6.3,1.8,3.1,0);

  if (id === 'terrace') {
    shell(0,-.7,-4.8,6.4,8.8,3.2,0,'charcoal');
    box('Garage door','door',0,.1,3.83,4.9,.12,2.55,.15,'metal');
    for (let i=1;i<13;i++) beam('Garage panel seam',0,.1,3.96,4.9,.012,.012,.15+i*.19,'charcoal');
    box('Garden retaining wall','wall',0,-5.7,-4.8,4.7,8.2,3.2,0,'charcoal');
    slab('Raised garden terrace',0,-5.7,-4.8,4.7,8.2,3.2,'paving');
    planter(0,-5.5,1.0,1.3,2.3,3.2);
    stairs(0,-4.0,9.25,2.6,18,3.2/18,.30);
    slab('Living terrace plate',1,-5.7,-4.8,11.4,9.6,3.2,'charcoal',.32);
    shell(1,-5.5,-4.6,10.7,7.5,3.45,3.2,'charcoal');
    facade(1,-3.1,2.93,7.3,3.1,3.4);
    box('Entrance portal','wall',1,-5.5,2.65,2.2,.30,3.45,3.2,'charcoal');
    box('Recessed entry door','door',1,-4.75,2.99,.95,.10,2.85,3.2,'timber');
    balcony(1,-.6,3.0,6.0,1.75,3.2);
    planter(1,-5.45,4.0,3.7,.6,3.2);
    slab('Upper terrace plate',2,-5.8,-4.9,11.6,9.5,6.75,'charcoal',.38);
    soffit(1,-5.5,2.9,10.9,1.6,6.37);
    shell(2,-5.3,-4.5,10.4,6.8,3.05,6.75,'charcoal');
    facade(2,-4.9,2.34,9.4,2.8,6.9);
    balcony(2,-5.3,2.5,10.4,1.9,6.75);
    planter(2,-5.15,2.65,1.4,.7,6.75); planter(2,3.5,2.65,1.3,.7,6.75);
    box('Left rooftop upstand','wall',2,-5.5,-4.7,.25,7.1,3.45,6.75,'charcoal');
    box('Offset left roof','roof',2,-5.6,-4.8,4.0,7.3,.30,9.9,'charcoal');
    box('Wide floating roof','roof',2,-1.8,-4.7,7.5,8.8,.35,9.75,'charcoal');
    soffit(2,-1.6,2.3,7.1,1.6,9.75);
  } else if (id === 'portal') {
    stairs(0,-1.5,6.5,3.2,5,.18,.42);
    slab('Ground floor plate',0,-5.0,-4.2,10.2,8.4,.9,'stone');
    shell(0,-5,-4.2,10.2,8.0,3.6,.9,'white');
    box('Stone support pier','wall',0,-5.0,2.9,2.8,.9,3.6,.9,'stone');
    facade(0,-1.5,3.78,6.2,3.25,1.05);
    box('Entry door','door',0,-1.25,3.9,1.15,.12,3.15,.9,'metal');
    slab('Cantilever balcony',1,-5.75,-4.0,7.0,9.0,4.5,'charcoal',.38);
    shell(1,-5.15,-3.8,6.0,7.1,3.55,4.5,'timber');
    facade(1,-4.7,3.36,5.2,3.0,4.7);
    balcony(1,-5.2,3.45,5.95,1.35,4.5);
    beam('Portal left jamb',1,-5.75,4.62,.26,.38,3.9,4.12,'charcoal');
    beam('Portal right jamb',1,.80,4.62,.45,.38,4.28,4.12,'charcoal');
    box('Portal crown','roof',1,-5.75,-4.0,7.0,9.0,.45,8.0,'charcoal');
    soffit(1,-5.4,3.35,6.2,1.3,8.0);
    for (let i=0;i<28;i++) {
      const x=-5.10+i*.21;
      if (x < -3.6 || x > -.65) beam('Timber facade fin',1,x,3.42,.08,.20,3.25,4.55,'timber');
    }
    shell(1,1.8,-4.0,3.6,6.8,3.55,4.5,'white');
    facade(1,2.1,2.84,2.9,3.1,4.7);
    slab('Right terrace',1,1.5,2.8,3.9,1.4,4.5,'white');
    balcony(1,1.65,2.9,3.6,1.1,4.5);
    beam('Tall white frame',0,5.4,-4.0,.35,8.2,7.9,.9,'white');
    box('Right roof canopy','roof',1,1.6,-4.2,4.2,8.1,.20,8.1,'metal');
    soffit(1,1.9,2.8,3.3,1.0,8.1);
    beam('Vertical entry light',0,5.15,3.97,.035,.03,6.7,1.2,'light');
    planter(0,-6.4,2.8,1.1,2.7,0); planter(1,2.0,3.1,1.1,.6,4.5);
  } else {
    stairs(0,-2,7.7,4.0,6,.15,.45);
    slab('Ground floor plate',0,-5.25,-4.2,10.5,8.4,.9,'white');
    shell(0,-5.25,-4.2,10.5,8.0,3.3,.9,'stone');
    for (const x of [-5.25,4.3]) box('Stone facade pier','wall',0,x,3.5,.95,.50,3.3,.9,'stone');
    facade(0,-4.3,3.82,8.6,3.0,1.02);
    slab('Wide balcony plate',1,-5.5,-4.3,11.0,9.0,4.2,'white',.30);
    soffit(0,-4.4,3.9,8.8,.65,3.9);
    shell(1,-4.95,-4.1,9.9,7.3,3.1,4.2,'white');
    facade(1,-4.5,3.24,9.0,2.85,4.35);
    balcony(1,-5.1,3.35,10.2,1.2,4.2);
    box('Balcony canopy','roof',1,-5.5,2.9,11.0,1.9,.18,7.15,'metal');
    soffit(1,-5.2,3.1,10.4,1.5,7.15);
    for (const x of [-5.1,5.0]) beam('Canopy post',1,x,4.5,.10,.10,2.95,4.2);
    slab('Attic plate',2,-4.9,-4.1,9.8,7.4,7.3,'timber',.16);
    const triangle=glass('Gable glazing',2,-4.65,3.25,9.3,2.85,7.3);
    triangle.profile=[[0,0],[9.3,0],[4.65,2.85]];
    for (const x of [-2.4,0,2.4]) beam('Gable mullion',2,x-.03,3.22,.06,.10,2.85*(1-Math.abs(x)/4.65),7.3);
    for (const [label,x,profile] of [
      ['Left pitched roof',-5.5,[[0,0],[5.5,3.0],[5.5,3.2],[0,.20]]],
      ['Right pitched roof',0,[[0,3.0],[5.5,0],[5.5,.20],[0,3.2]]],
    ]) {
      const roof=box(label,'roof',2,x,-4.7,5.5,9.1,3.2,7.3,'white'); roof.profile=profile;
    }
    const rear=box('Rear gable wall','wall',2,-4.65,-4.11,9.3,.20,2.85,7.3,'white');
    rear.profile=[[0,0],[9.3,0],[4.65,2.85]];
    for (const x of [-5.0,3.7]) planter(1,x,3.8,1.25,.55,4.2);
  }
  return { name: preset.name, demoPreset: id, sample: true, unit: 'm', floors: id === 'portal' ? 2 : 3,
    width: 14.4, depth: 16.8, components,
    warnings: [`${preset.description} ${preset.dimensions}. Designed demo with approximate dimensions; not reconstructed from the photograph. Planting and finishes are schematic; this is not a construction specification.`] };
}
