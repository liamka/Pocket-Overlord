import { Pixels, type Point } from './icon-pixels';
import { FANTASY_BIOMES } from '../core/natural-biomes';

const C = {
  ink: '#17262c', dark: '#263c43', steel: '#536c78', metal: '#90a8b1', silver: '#d4e4e3', white: '#fff6d5',
  brown: '#603c2a', wood: '#996039', tan: '#d3944b', sand: '#f2cb70',
  leafDark: '#215342', leaf: '#39864b', green: '#68b746', lime: '#b3e56c',
  blueDark: '#164967', blue: '#208cb7', cyan: '#58d0ed', ice: '#b9f4f0',
  redDark: '#832c2b', red: '#cf4330', orange: '#f87935', gold: '#ffbd35', light: '#ffea91',
};
type Paint = (p: Pixels) => void;

function spark(p: Pixels, x: number, y: number, color = C.light): void {
  p.rect(x - 2, y, 5, 1, color); p.rect(x, y - 2, 1, 5, color); p.dot(x + 1, y + 1, C.gold);
}
function water(p: Pixels, y = 37): void {
  p.ellipse(24,y,20,5,C.blueDark); p.ellipse(22,y-1,17,3,C.blue);
  p.line([[5,y-1],[13,y-1],[15,y-3],[22,y-3]],C.cyan);
  p.line([[28,y+2],[37,y+2],[40,y]],C.ice); p.rect(12,y+3,9,1,C.cyan);
}
function soil(p: Pixels, color = C.green): void {
  p.poly([[6,33],[24,28],[42,33],[38,39],[24,44],[10,39]],C.brown);
  p.poly([[8,34],[24,37],[24,42],[11,38]],C.wood);
  p.poly([[6,32],[24,27],[42,32],[24,38]],color);
  p.line([[7,33],[24,38],[40,33]],C.sand); p.rect(12,36,3,2,C.tan); p.rect(29,38,4,1,C.tan);
}
function leaves(p: Pixels, x: number, y: number, rx: number, ry: number, colors = [C.leafDark,C.leaf,C.green,C.lime]): void {
  p.ellipse(x,y,rx,ry,colors[0]); p.ellipse(x-1,y-2,rx-1,ry-1,colors[1]);
  p.ellipse(x-3,y-3,Math.max(2,rx-3),Math.max(2,ry-3),colors[2]);
  p.line([[x-rx+3,y-2],[x-rx+3,y-4],[x-2,y-4]],colors[3]);
}
function flame(p: Pixels, x: number, y: number, size = 1): void {
  const poly = (pts: Point[], color: string) => p.poly(pts.map(([a,b]) => [Math.round(x+a*size),Math.round(y+b*size)]),color);
  poly([[-10,0],[-13,-7],[-9,-12],[-11,-18],[-4,-13],[-1,-24],[4,-18],[3,-11],[10,-17],[9,-7],[12,-3],[6,1]],C.redDark);
  poly([[-9,0],[-11,-7],[-6,-13],[-5,-7],[0,-20],[3,-13],[2,-6],[8,-12],[7,-4],[9,0]],C.orange);
  poly([[-6,0],[-7,-5],[-2,-12],[0,-6],[4,-10],[3,-3],[6,0]],C.gold);
  poly([[-3,0],[-3,-4],[0,-9],[1,-3],[3,0]],C.white);
}
function arrow(p: Pixels, down = false): void {
  const pts: Point[] = [[34,3],[25,12],[30,12],[30,23],[38,23],[38,12],[43,12]];
  const flip = (a: readonly Point[]) => down ? a.map(([x,y]) => [x,27-y] as Point) : a;
  p.poly(flip(pts),C.ink);
  p.poly(flip([[34,5],[27,11],[32,11],[32,21],[36,21],[36,11],[41,11]]),down?C.cyan:C.gold);
  p.line(flip([[29,10],[34,6],[34,19]]),down?C.ice:C.white);
}

const raise: Paint = p => {
  water(p,38);
  p.poly([[7,25],[15,19],[33,22],[36,29],[32,37],[20,40],[10,35]],C.brown);
  p.poly([[9,25],[19,28],[20,38],[12,34]],C.tan);
  p.poly([[20,27],[34,26],[31,35],[24,38]],C.wood);
  p.line([[12,29],[17,30],[17,33]],C.sand); p.rect(23,31,4,2,C.tan); p.rect(28,27,3,2,C.tan);
  p.poly([[6,24],[11,19],[15,18],[18,13],[24,13],[28,18],[33,19],[35,24],[29,28],[18,29]],C.sand);
  p.poly([[8,22],[13,18],[17,18],[19,13],[23,13],[27,19],[31,19],[33,23],[26,26],[16,26]],C.leaf);
  p.poly([[9,21],[17,19],[19,14],[23,14],[26,20],[19,24],[12,24]],C.green);
  p.line([[11,21],[16,20],[19,15],[22,15]],C.lime); p.rect(21,22,4,1,C.lime);
  p.line([[6,36],[11,38],[16,38]],C.ice); arrow(p);
};
const lower: Paint = p => {
  water(p,37);
  p.poly([[4,25],[12,20],[22,23],[24,32],[18,39],[8,35]],C.wood);
  p.poly([[5,24],[12,20],[22,23],[20,27],[13,29]],C.green);
  p.line([[5,24],[11,22],[16,23]],C.lime); p.line([[8,27],[13,29],[19,27]],C.sand);
  p.poly([[30,25],[39,22],[44,27],[41,35],[34,38],[31,32]],C.brown);
  p.poly([[31,25],[39,23],[43,27],[37,29]],C.green); p.line([[34,25],[39,24]],C.lime);
  p.poly([[22,24],[30,27],[30,36],[25,40],[18,37],[20,32]],C.blue);
  p.line([[22,29],[24,32],[24,35]],C.cyan,2); p.line([[14,36],[18,37],[20,37]],C.ice);
  p.rect(38,35,5,1,C.ice); p.rect(8,18,2,3,C.cyan); p.rect(42,18,2,3,C.cyan); arrow(p,true);
};

function biome(kind: string): Paint { return p => {
  soil(p,kind==='desert'?C.sand:kind==='permafrost'?C.silver:kind==='savanna'?'#cdb755':kind==='swamp'?'#548b7a':C.green);
  if (kind==='grassland') {
    p.poly([[19,35],[21,19],[27,16],[27,33],[32,36]],C.brown);
    p.line([[23,32],[24,17]],C.tan,2); p.line([[24,26],[16,20]],C.wood,3);
    leaves(p,16,18,10,8); leaves(p,31,18,10,8); leaves(p,24,11,11,8);
    p.rect(10,32,2,2,C.white); p.dot(11,31,C.gold); p.rect(33,33,2,2,C.light);
  } else if (kind==='savanna') {
    p.line([[24,35],[25,24],[21,17],[14,14]],C.brown,3);
    p.line([[26,25],[32,18],[37,17]],C.brown,2); p.line([[25,34],[26,26]],C.tan);
    leaves(p,17,13,13,5,['#536333','#7c8b38','#b6ba4c','#e7dc79']);
    leaves(p,33,16,10,4,['#536333','#7c8b38','#b6ba4c','#e7dc79']);
    p.line([[11,32],[9,28],[10,33],[13,30]],C.sand); p.line([[34,34],[35,29],[36,33],[39,31]],C.sand);
  } else if (kind==='desert') {
    p.rect(21,12,8,24,C.leafDark); p.ellipse(25,12,4,4,C.leafDark);
    p.rect(22,11,5,24,C.leaf); p.rect(23,10,2,24,C.lime);
    p.line([[21,25],[14,25],[12,23],[12,17]],C.leafDark,4); p.line([[22,24],[15,24],[14,22],[14,16]],C.green,2);
    p.line([[28,21],[33,21],[35,18],[35,13]],C.leafDark,3); p.line([[28,20],[33,19],[34,16],[34,12]],C.green,2);
    for (const y of [16,22,29]) {p.dot(26,y,C.white);p.dot(21,y+2,C.sand);}
    p.rect(23,7,5,3,'#f27281'); p.rect(24,6,2,4,'#ffc0b2'); p.rect(34,33,5,2,C.tan);
  } else if (kind==='jungle') {
    p.poly([[19,35],[24,16],[29,13],[27,22],[24,35]],C.brown);
    p.line([[21,33],[24,25],[26,18]],C.tan,2);
    const fronds: Point[][]=[[[26,16],[14,9],[6,14],[15,13],[22,18]],[[26,14],[20,6],[11,7],[19,10]],[[25,14],[29,5],[37,6],[31,9]],[[27,15],[38,11],[44,16],[35,14]],[[27,16],[38,20],[39,28],[34,22]],[[24,16],[15,20],[11,27],[12,18]]];
    fronds.forEach((pts,i)=>p.poly(pts,i%2?C.green:C.leaf));
    p.line([[7,14],[14,10],[25,15],[30,7],[36,6]],C.lime);
    p.ellipse(26,17,3,3,C.tan); p.ellipse(29,18,2,2,C.brown);
    leaves(p,12,32,6,3); p.rect(34,31,2,3,C.orange);
  } else if (kind==='swamp') {
    p.ellipse(23,34,13,3,'#287b80'); p.line([[11,35],[18,36]],C.cyan);
    p.poly([[20,35],[23,22],[21,12],[26,9],[26,24],[30,35],[25,30],[24,37]],C.brown);
    p.line([[23,28],[15,19],[15,12]],C.wood,2); p.line([[25,24],[34,17],[36,11]],C.wood,2);
    leaves(p,17,12,10,5,['#254f48','#397562','#69a06e','#a3cc83']);
    leaves(p,31,10,10,5,['#254f48','#397562','#69a06e','#a3cc83']);
    for(const [x,y] of [[9,14],[14,15],[30,14],[37,13]]) p.line([[x,y],[x,y+9]],C.leaf,2);
    p.rect(35,33,2,3,C.sand);p.ellipse(36,31,4,2,'#ba7fc7');p.dot(35,30,C.white);
  } else {
    p.rect(22,26,5,10,C.wood);
    for (const [y,w] of [[29,15],[22,12],[15,8],[9,4]]) {
      p.poly([[24,y-9],[24-w,y+3],[24+w,y+3]],C.blueDark);
      p.poly([[24,y-9],[24-w,y],[24-3,y+1],[25,y-1],[24+w-2,y]],C.silver);
      p.poly([[24,y-9],[24-w+2,y-1],[22,y-2]],C.white);
    }
    p.line([[10,34],[18,36],[27,35]],C.white);spark(p,38,12,C.ice);
  }
}; }

function fantasyBiome(definition: typeof FANTASY_BIOMES[number]): Paint { return p => {
  soil(p, definition.colors[1]);
  const kind = definition.key;
  if (kind === 'crystal') {
    for (const [x, y, h] of [[14, 19, 16], [23, 5, 31], [33, 14, 20]]) {
      p.poly([[x,y],[x+5,y+6],[x+4,y+h],[x-4,y+h],[x-5,y+6]], '#466394');
      p.poly([[x,y],[x+3,y+6],[x+2,y+h-1],[x,y+h]], '#81c8e9');
      p.line([[x,y+2],[x,y+h-3]], '#d9fcf7');
    }
    spark(p, 35, 8, C.ice);
  } else if (kind === 'mushroom') {
    p.poly([[21,35],[20,18],[28,18],[27,32],[31,35]], '#a590ba');
    p.rect(22,20,3,14,'#eee0d7');
    p.ellipse(24,19,17,6,'#62477d'); p.ellipse(24,15,16,8,'#b571b3');
    p.ellipse(22,12,11,6,'#d19bce'); p.rect(15,12,4,3,C.white); p.rect(28,15,4,3,C.white);
    p.rect(34,29,3,7,'#eee0d7');p.ellipse(35,28,6,3,'#7fbfd1'); p.dot(33,27,C.ice);
  } else if (kind === 'corrupted' || kind === 'infernal') {
    const infernal = kind === 'infernal';
    p.line([[23,35],[25,23],[23,6]], '#393040', 5);
    p.line([[24,25],[13,17],[12,7]], '#393040', 3);
    p.line([[25,19],[35,15],[37,6]], '#393040', 3);
    p.line([[23,34],[26,24],[24,8]], infernal ? '#ad5f50' : '#9c88ad', 2);
    p.line([[17,35],[23,31],[29,34]], '#393040', 3);
    if (infernal) {
      flame(p,13,12,.3); flame(p,38,10,.3); p.rect(25,20,1,6,C.orange);
    } else {
      p.rect(23,19,2,2,'#bce1b4'); p.rect(27,19,2,2,'#bce1b4');
      p.line([[10,32],[15,34]],'#c9bbd1',2);
    }
  } else if (kind === 'candy') {
    p.rect(22,22,4,14,'#b97398'); p.rect(23,23,2,12,'#fff0d6');
    p.ellipse(24,16,12,12,'#ad5f95'); p.ellipse(23,15,10,10,'#edadd0');
    p.line([[28,9],[19,9],[17,13],[17,20],[26,22],[30,18],[29,14],[23,13],[22,17],[26,17]],'#fff0d6',2);
    p.line([[35,35],[35,26],[38,24],[41,26],[41,29]],'#fff0d6',3);
    p.rect(35,29,3,2,'#d77da4'); p.rect(40,26,2,2,'#d77da4');
  } else {
    const enchanted = kind === 'enchanted';
    p.line([[23,35],[25,17],[18,13]], enchanted ? '#8293a9' : C.wood, 4);
    p.line([[24,34],[26,21]], enchanted ? '#dfecdf' : C.tan, 2);
    const colors = enchanted ? ['#7893b5','#a3bfd8','#c7e4ea','#eef8ed'] : ['#6b793b','#99a94e','#c5cc68','#ebdf91'];
    leaves(p,16,18,10,8,colors); leaves(p,31,18,10,8,colors); leaves(p,24,10,11,8,colors);
    if (enchanted) { spark(p,9,8,'#fff1c8'); spark(p,37,27,'#f6daef'); }
    else for (const [x,y] of [[12,17],[26,10],[31,20],[22,23]]) {
      p.ellipse(x,y,3,3,'#b09a39'); p.ellipse(x,y-1,2,2,'#ffe16b');p.dot(x-1,y-2,'#fff3b7');
    }
  }
}; }

function portrait(race: string): Paint { return p => {
  const orc=race==='orc',elf=race==='elf',dwarf=race==='dwarf';
  const skin=orc?'#73ad52':'#e8ab72',shadow=orc?'#3d703e':'#ad6746',light=orc?'#b1d776':'#ffda9b';
  const cloth=elf?C.leaf:dwarf?C.steel:orc?C.brown:'#286fa0';
  p.poly([[6,43],[8,34],[16,30],[32,30],[40,35],[42,43]],C.ink);
  p.poly([[8,42],[10,35],[17,32],[31,32],[38,36],[40,42]],cloth);
  p.poly([[10,35],[16,33],[19,41],[10,41]],elf?C.green:dwarf?C.metal:orc?C.wood:C.blue);
  p.poly([[20,29],[28,29],[29,35],[24,39],[19,35]],shadow);
  p.ellipse(24,21,12,14,shadow); p.ellipse(22,20,10,13,skin);
  p.ellipse(19,17,6,7,light); p.rect(13,18,4,9,skin); p.rect(27,23,5,7,shadow);
  if (elf) {
    p.poly([[13,18],[3,13],[7,24],[15,26]],skin);p.line([[5,16],[10,21]],light);
    p.poly([[34,18],[44,13],[40,24],[33,26]],skin);p.line([[42,16],[37,21]],light);
    p.poly([[13,26],[10,14],[14,6],[24,3],[34,7],[37,17],[34,29],[31,12],[20,10],[15,14]],'#b99844');
    p.poly([[12,15],[14,7],[23,5],[31,7],[23,7],[18,12]],'#f9db7c');
    p.rect(15,14,18,3,C.leafDark);p.rect(17,14,14,1,C.lime); p.poly([[24,12],[27,15],[24,18],[21,15]],C.gold);p.dot(24,14,C.white);
  } else if(dwarf) {
    p.poly([[11,17],[12,9],[17,5],[30,5],[36,10],[37,19]],C.steel);
    p.poly([[13,16],[14,10],[18,7],[25,7],[25,16]],C.metal);
    p.line([[15,11],[18,8],[23,8]],C.silver);p.rect(10,16,28,4,C.dark);p.rect(11,16,26,2,C.metal);
    p.rect(22,5,5,15,C.tan);p.rect(23,6,2,13,C.light);p.dot(14,17,C.white);p.dot(33,17,C.white);
    p.poly([[12,26],[17,28],[23,26],[30,28],[36,25],[33,36],[28,43],[20,43],[15,36]],'#8f4527');
    p.poly([[14,28],[19,30],[23,28],[24,40],[21,41],[17,35]],'#d9823b');
    p.line([[17,30],[20,34],[21,38]],'#ffb95c',2);p.line([[29,30],[29,35],[26,39]],C.tan);
    p.rect(21,38,6,3,C.gold);p.rect(22,38,4,1,C.white);
  } else if(orc) {
    p.poly([[11,14],[13,7],[17,8],[20,4],[24,7],[30,5],[35,10],[36,15],[30,12],[24,13],[18,11]],'#273d33');
    p.poly([[12,18],[6,15],[7,23],[13,25]],skin);p.poly([[34,18],[41,15],[40,23],[35,25]],shadow);
    p.rect(15,18,7,3,C.leafDark);p.rect(27,18,7,3,C.leafDark);
    p.line([[17,29],[24,31],[31,29]],C.ink,2);
    p.poly([[15,32],[16,25],[20,31]],C.white);p.poly([[28,31],[33,25],[33,32]],C.white);
    p.rect(35,23,2,5,C.gold);p.dot(35,23,C.white);
    p.line([[11,36],[14,39],[17,36]],C.silver,2);
  } else {
    p.poly([[11,20],[10,13],[13,7],[20,4],[29,5],[35,10],[36,18],[32,22],[30,12],[24,13],[18,10],[15,16],[15,21]],'#673d29');
    p.poly([[13,14],[15,8],[22,6],[29,7],[24,8],[20,10],[17,10]],'#b77536');
    p.line([[15,9],[21,7],[25,7]],C.sand);
    p.line([[20,31],[24,32],[28,30]],'#8c5038');p.rect(24,36,3,5,C.gold);p.dot(24,36,C.white);
  }
  p.rect(17,21,4,3,C.ink);p.rect(28,21,4,3,C.ink);p.dot(18,21,elf?C.lime:C.white);p.dot(29,21,elf?C.lime:C.white);
  p.line([[24,22],[23,26],[26,26]],shadow);p.dot(23,24,light);
}; }

const dynamite: Paint=p=>{
  for (const [x,y] of [[13,16],[21,11],[29,16]]) {
    p.rect(x,y,7,24,C.redDark);p.rect(x,y,5,23,C.red);p.rect(x+1,y,2,22,C.orange);
    p.ellipse(x+3,y,3,2,C.tan);p.rect(x+1,y,3,1,C.light);p.rect(x,y+22,6,2,C.redDark);
  }
  p.rect(12,21,25,4,C.wood);p.rect(12,21,25,2,C.silver);p.rect(12,30,25,4,C.wood);p.rect(12,30,25,2,C.silver);
  p.rect(20,21,5,13,C.metal);p.rect(21,22,3,11,C.white);p.rect(22,25,2,4,C.steel);
  p.line([[24,10],[25,7],[30,7],[32,4]],C.tan,2);spark(p,32,5);p.dot(37,9,C.orange);p.dot(27,2,C.gold);
  p.rotate(Math.PI/5);
};
const rocket: Paint=p=>{
  flame(p,24,45,.5);
  p.poly([[17,25],[12,31],[12,39],[19,35],[29,35],[36,39],[35,30],[30,25]],C.redDark);
  p.poly([[16,28],[13,33],[13,37],[19,33]],C.orange);p.poly([[30,28],[34,32],[34,36],[29,33]],C.red);
  p.poly([[18,15],[24,4],[30,15],[30,34],[26,38],[21,38],[18,34]],C.steel);
  p.rect(19,15,8,20,C.silver);p.rect(20,15,3,19,C.white);p.rect(27,17,2,17,C.metal);
  p.poly([[18,15],[24,4],[30,15]],C.red);p.line([[20,13],[24,6]],C.orange,2);
  p.rect(18,29,12,3,C.dark);p.rect(19,29,8,2,C.metal);p.rect(22,19,4,5,C.blueDark);p.rect(22,19,3,3,C.cyan);p.dot(22,19,C.white);
  p.rotate(Math.PI/4);
};
const storm: Paint=p=>{
  for(const x of [10,20,35]) {p.line([[x+2,28],[x,34]],C.blue,2);p.line([[x+1,28],[x,31]],C.ice);}
  p.ellipse(25,21,18,8,C.blueDark);p.ellipse(13,18,8,7,C.steel);p.ellipse(25,13,10,10,C.metal);p.ellipse(35,18,8,7,C.steel);
  p.ellipse(22,11,7,6,C.silver);p.ellipse(29,18,9,7,C.metal);p.line([[7,18],[9,14],[13,13]],C.silver,2);
  p.poly([[24,21],[34,21],[27,30],[33,30],[17,44],[22,33],[17,33]],C.orange);
  p.poly([[25,21],[31,21],[24,31],[29,31],[20,40],[24,31],[20,31]],C.light);p.line([[26,22],[22,29]],C.white,2);
};
const ship: Paint=p=>{
  water(p,40);
  p.poly([[5,30],[21,32],[42,28],[36,38],[16,41],[10,38]],C.brown);
  p.poly([[7,31],[22,34],[39,30],[35,35],[17,38],[11,36]],C.wood);
  p.line([[7,31],[21,33],[40,29]],C.sand,2);p.line([[15,37],[22,38],[34,35]],C.tan);
  p.rect(23,6,2,27,C.brown);p.rect(23,6,1,25,C.tan);
  p.poly([[21,9],[7,27],[21,28]],C.silver);p.poly([[20,10],[11,24],[20,25]],C.white);
  p.poly([[26,10],[37,25],[26,27]],C.tan);p.poly([[26,10],[34,23],[26,24]],C.sand);
  p.line([[22,8],[6,29]],C.steel);p.line([[25,8],[41,28]],C.steel);
  p.poly([[25,5],[35,7],[30,10],[25,10]],C.red);p.rect(25,5,5,1,C.orange);
  p.rect(17,34,2,2,C.ink);p.rect(27,33,2,2,C.ink);p.line([[10,40],[17,42],[25,42]],C.ice);
};
const harbor: Paint=p=>{
  water(p,39);
  for(const x of [9,20,34]) {p.rect(x,31,3,11,C.brown);p.rect(x,31,1,9,C.tan);}
  p.poly([[5,32],[28,27],[43,31],[22,37]],C.wood);p.line([[6,32],[23,35],[42,30]],C.sand);
  for(let x=9;x<35;x+=5)p.line([[x,32],[x+9,30]],C.brown);
  p.poly([[13,30],[15,11],[25,11],[28,29]],C.silver);p.poly([[22,11],[25,11],[28,29],[23,30]],C.steel);
  p.poly([[14,22],[26,22],[27,26],[14,26]],C.red);p.rect(15,13,10,4,C.red);p.rect(15,13,3,4,C.orange);
  p.rect(14,8,12,4,C.ink);p.rect(16,8,8,4,C.gold);p.rect(17,8,3,3,C.white);
  p.poly([[12,8],[20,3],[28,8]],C.red);p.line([[13,7],[20,3],[25,6]],C.orange);
  p.rect(18,25,4,6,C.blueDark);p.rect(18,25,1,5,C.blue);
  p.ellipse(36,24,2,2,C.silver);p.line([[36,25],[36,32],[31,29],[32,26]],C.metal,2);p.line([[36,32],[41,29],[40,26]],C.metal,2);p.line([[33,26],[39,26]],C.silver);
};
const ufo: Paint=p=>{
  p.poly([[18,27],[9,42],[24,39],[39,42],[30,27]],'#385f40');
  p.poly([[21,28],[17,39],[24,37],[31,39],[27,28]],'#81b956');
  p.ellipse(24,26,20,7,C.dark);p.ellipse(24,23,20,7,C.steel);p.ellipse(23,21,17,5,C.metal);
  p.line([[7,22],[11,19],[16,18]],C.silver,2);
  p.ellipse(24,17,11,9,C.leafDark);p.ellipse(24,16,9,8,C.green);p.ellipse(21,13,5,4,C.lime);
  p.line([[17,14],[19,10],[23,9]],C.ice,2);
  p.ellipse(24,18,3,4,'#527047');p.rect(22,17,1,2,C.ink);p.rect(25,17,1,2,C.ink);
  p.ellipse(24,23,11,3,C.steel);p.line([[14,22],[20,24],[31,23]],C.silver);
  for(const x of [11,22,33]){p.rect(x,26,4,2,C.gold);p.dot(x,26,C.white);}spark(p,38,10,C.ice);
};
const dragon: Paint=p=>{
  p.poly([[23,20],[12,6],[9,20],[3,17],[6,29],[14,26],[17,35],[27,31]],C.redDark);
  p.poly([[22,24],[12,10],[13,23],[7,21],[9,27],[15,24],[19,31]],C.red);p.line([[12,12],[20,26]],C.orange);
  p.poly([[20,38],[18,28],[22,18],[28,13],[37,15],[36,22],[43,25],[42,31],[33,32],[30,40]],C.redDark);
  p.poly([[21,37],[22,27],[25,20],[30,16],[35,17],[33,24],[40,26],[39,29],[31,29],[27,38]],C.red);
  p.poly([[21,37],[24,28],[28,26],[29,33],[26,39]],C.orange);
  p.poly([[25,18],[22,8],[28,12],[30,17]],C.sand);p.poly([[32,15],[35,7],[36,16]],C.white);
  p.rect(29,20,6,4,C.ink);p.rect(30,20,4,2,C.gold);p.dot(32,20,C.white);
  p.rect(35,27,6,2,C.ink);p.rect(35,27,2,2,C.white);p.dot(39,24,C.ink);
  p.line([[21,28],[22,25],[24,24]],C.gold);flame(p,39,39,.32);p.rect(38,31,2,4,C.gold);
};
const kaiju: Paint=p=>{
  p.poly([[11,36],[6,29],[11,28],[7,20],[13,20],[10,11],[17,14],[17,5],[24,10],[29,6],[32,13]],C.blue);
  p.line([[8,21],[14,23],[12,13],[19,17],[19,8],[24,13]],C.cyan,2);
  p.poly([[14,42],[13,29],[17,19],[25,13],[34,15],[37,23],[44,27],[41,34],[31,36],[28,43]],C.dark);
  p.poly([[16,41],[16,29],[20,20],[26,16],[32,17],[32,23],[40,27],[38,31],[28,32],[24,41]],C.steel);
  p.poly([[18,28],[21,22],[27,18],[30,18],[27,22],[22,26]],C.metal);
  p.poly([[26,23],[33,21],[33,26],[27,28]],C.ink);p.rect(28,24,4,2,C.red);p.dot(29,24,C.white);
  p.line([[30,32],[39,30]],C.ink,2);p.rect(32,32,2,2,C.silver);p.rect(37,31,2,2,C.silver);
  p.line([[20,31],[18,35],[20,37]],C.metal);p.rect(24,36,4,2,C.steel);p.line([[15,39],[13,36]],C.cyan,2);
};
const napalm: Paint=p=>{
  flame(p,16,42,.65);flame(p,33,41,.6);
  p.poly([[22,5],[26,5],[29,22],[43,30],[42,34],[28,30],[27,37],[33,41],[32,44],[24,41],[16,44],[15,41],[21,37],[20,30],[6,34],[5,30],[19,22]],C.dark);
  p.poly([[23,6],[25,6],[27,25],[40,31],[27,28],[25,37],[23,37],[22,28],[8,31],[21,24]],C.metal);
  p.line([[24,8],[24,36]],C.silver,2);p.rect(23,13,3,7,C.blueDark);p.rect(23,13,2,4,C.cyan);
  p.line([[9,30],[19,26]],C.steel,2);p.line([[29,26],[38,30]],C.steel,2);p.rect(13,29,3,5,C.red);p.rect(33,29,3,5,C.red);
  p.rotate(Math.PI/5);
};
const hammer: Paint=p=>{
  p.ellipse(24,38,18,6,C.redDark);p.ellipse(24,37,15,4,C.orange);p.ellipse(24,36,10,3,C.gold);
  p.poly([[21,12],[28,12],[28,32],[36,37],[14,37],[21,31]],C.orange);
  p.poly([[23,12],[26,12],[26,33],[31,36],[18,36],[23,32]],C.light);p.rect(24,13,1,23,C.white);
  p.poly([[8,7],[15,4],[20,12],[14,17]],C.steel);p.poly([[29,10],[35,5],[42,12],[35,17]],C.steel);
  p.line([[10,8],[15,6],[17,11],[13,14]],C.cyan,2);p.line([[33,10],[36,8],[40,12]],C.cyan,2);
  p.ellipse(24,11,6,7,C.tan);p.ellipse(24,10,4,5,C.gold);p.ellipse(23,9,2,3,C.white);
  p.line([[10,30],[13,34]],C.gold,2);p.line([[36,30],[33,34]],C.gold,2);spark(p,8,22);spark(p,40,23);
};
const bomb: Paint=p=>{
  p.poly([[16,5],[20,8],[28,8],[32,5],[31,15],[17,15]],C.steel);p.rect(19,9,10,5,C.metal);p.rect(21,9,2,5,C.silver);
  p.ellipse(24,27,13,15,C.dark);p.ellipse(23,26,11,14,C.steel);p.ellipse(20,23,6,10,C.metal);
  p.line([[15,21],[17,17],[21,16]],C.silver,2);
  p.rect(13,23,22,10,C.tan);p.rect(14,23,19,8,C.gold);p.rect(15,23,4,7,C.light);
  p.ellipse(24,27,2,2,C.ink);
  p.poly([[20,26],[18,23],[23,22],[23,25]],C.ink);p.poly([[26,25],[27,22],[31,25],[28,27]],C.ink);p.poly([[24,30],[27,29],[28,32],[22,32]],C.ink);
  p.line([[19,38],[23,40],[28,38]],C.metal);p.rotate(Math.PI/5);
};

const paintings: Readonly<Record<string, Paint>> = {
  'core:raise-land':raise,'core:lower-land':lower,
  ...Object.fromEntries(['grassland','savanna','desert','jungle','swamp','permafrost'].map(kind=>[`core:biome-${kind}`,biome(kind)])),
  ...Object.fromEntries(FANTASY_BIOMES.map(definition => [`core:biome-${definition.key}`, fantasyBiome(definition)])),
  ...Object.fromEntries(['human','elf','orc','dwarf'].map(race=>[`core:${race}`,portrait(race)])),
  'core:harbor':harbor,'core:ship':ship,'core:dynamite':dynamite,'core:rocket':rocket,'core:rain':storm,
  'core:dragon':dragon,'core:ufo':ufo,'core:kaiju':kaiju,'core:napalm':napalm,'core:hammer-of-dawn':hammer,'core:tsar-bomba':bomb,
};

/** Custom tools without built-in artwork keep their registered icons. */
export function paintToolIcon(canvas: HTMLCanvasElement, id: string): boolean {
  if (!Object.hasOwn(paintings, id)) return false;
  const pixels = new Pixels(); paintings[id](pixels); pixels.outline(); pixels.draw(canvas);
  return true;
}
