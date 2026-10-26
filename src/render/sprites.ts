import type { PixelSprite, Sprite, ToolIcon } from '../content/registry';
import type { StatusIcon } from './status-bubbles';
import { drawDragonSprite } from './dragons';
import { drawResidentSprite } from './residents';
import { drawHarborSprite, drawShipSprite } from './seafaring';
import { drawUfoSprite } from './ufos';
import type { RaceId } from '../core/races';
import { drawAnimal, drawWorkplace } from './village-life';
export const villageColor = (id: number): string => ['#e7b86e', '#78c6da', '#e28b89', '#b7a1df', '#aaca73', '#e3a8ce'][(id - 1) % 6];

const pixel = (ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void => {
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
};

const foliagePalettes = {
  meadow: [
    ['#305638', '#3d6c3e', '#50863f', '#6b9d45', '#87b24e', '#a2c35e', '#bed27b'],
    ['#2c553c', '#396e43', '#4b8945', '#659f49', '#84b552', '#a1c669', '#bdd784'],
    ['#365939', '#487440', '#5e8b43', '#78a148', '#95b653', '#b0c76b', '#c8d68a'],
    ['#294f3b', '#356441', '#467e47', '#5f954e', '#7ba958', '#98bd6c', '#b3ce88'],
  ],
  jungle: [['#234e36', '#2e663b', '#3d8140', '#579a46', '#78b14f', '#9ac86a', '#b6d983']],
  silver: [['#51777b', '#6a969a', '#83afb5', '#a1c6cd', '#bfdcde', '#daeae8', '#edf5e9']],
  lemon: [['#405b32', '#557339', '#708c3f', '#8ca349', '#a8b855', '#c2cd6e', '#d7dc91']],
  savanna: [
    ['#3e5833', '#536d37', '#6a853e', '#849d46', '#9eb250', '#b9c56b', '#d1d58a'],
    ['#345537', '#476d3d', '#608640', '#7b9d47', '#98b151', '#b4c367', '#ced285'],
  ],
  swamp: [['#2e5140', '#3d6948', '#52814e', '#6d995a', '#88ae69', '#a5c17d', '#bfd293']],
};

// Hand-placed leaf clusters: broad uneven domes, small light patches and a dark underside.
// Dots are transparent; digits select the biome's seven foliage shades.
const treeCrowns = [
  [
    '........344444334.......',
    '.....34455554444432.....',
    '....34455665444554443...',
    '...3445556554456655432..',
    '..333444433444566554422.',
    '..3345544333455565554332',
    '.22345545544333455433221',
    '.22345665444433344333221',
    '223455665445443222222211',
    '23334555444443222211111.',
    '23334444333332221111111.',
    '23334454333332111122222.',
    '.33334433333221122222222',
    '.22333332222113344443233',
    '..2222222222224455555422',
    '...22222222233445665542.',
    '....2222211222445665432.',
    '....1111122222334554333.',
    '.....12112222223344333..',
    '......321222222233332...',
    '.......2111122223333....',
    '........11111112222.....',
    '.........111111111......',
    '..........1111111.......',
  ],
  [
    '........34443...........',
    '......345555443.........',
    '....344566655443........',
    '...3455566654444433.....',
    '..345655544433455543....',
    '..3455544433345666543...',
    '.334444433223456655432..',
    '.2334433222234555544322.',
    '22334432211233444433221.',
    '233455432211223333222211',
    '234566543221122222222211',
    '234566654322122223333221',
    '.34565544322223345554321',
    '.33455433222234556654321',
    '..233433222223456655432.',
    '...23332211223455444322.',
    '....222211122334443322..',
    '....122211222233332221..',
    '.....1122222222222211...',
    '......11222222222211....',
    '.......112222222211.....',
    '.........11111111.......',
  ],
  [
    '.......344443...........',
    '....344555544433........',
    '..344556665444455443....',
    '.34555566554445666543...',
    '34566554444334566554432.',
    '345665444332234555443322',
    '345554433222233444332221',
    '.3444432221122333322221',
    '233333221111222222222221',
    '233444322112223444432221',
    '.34555432222234555543221',
    '.3456654322233456654322.',
    '..345554322223455544322.',
    '...3444332222234443322..',
    '....23332222222333221...',
    '.....222222222222211....',
    '......1222222222211.....',
    '........111111111.......',
  ],
  [
    '.........34443..........',
    '......344555543.........',
    '....344556655443........',
    '...345555665444433......',
    '..345665544433455543....',
    '..3456554433345666543...',
    '.234554432223456655432..',
    '.2334433222234555544322.',
    '22333332211223444433221.',
    '233444322111223333222211',
    '234555432211222222222211',
    '234566543222223344432221',
    '.34555443222234555543221',
    '.3344433222234566654322.',
    '..233332222223455544322.',
    '...2332211222234443322..',
    '....22221112222333221...',
    '.....122222222222211....',
    '......1122222222211.....',
    '.......11222222211......',
    '.........1111111........',
  ],
];
const broadleafSprites = new Map<string, HTMLCanvasElement>();

/** Pixel clusters and silhouette based on references/worldbox-trees-and-water.png. */
export function drawBroadleafTree(ctx: CanvasRenderingContext2D, variant = 0, kind: keyof typeof foliagePalettes = 'meadow'): void {
  const shape = variant % 4, key = `${kind}:${shape}`;
  let sprite = broadleafSprites.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas'); sprite.width = 36; sprite.height = 38;
    const painter = sprite.getContext('2d')!; painter.translate(17, 33);
    const r = (color: string, x: number, y: number, w: number, h: number): void => pixel(painter, color, x, y, w, h);
    const colors = foliagePalettes[kind][shape % foliagePalettes[kind].length];
    // The shadow falls to the right; the trunk has no horizontal pedestal.
    r('#25433120', 0, 0, 12, 3); r('#25433130', -2, -1, 10, 3); r('#25433118', 5, 2, 9, 2);
    const bark = kind === 'silver' ? ['#606764', '#8e9990', '#b7c2ad'] : ['#51483e', '#766351', '#968369'];
    r(bark[0], -2, -17, 5, 18); r(bark[1], -1, -16, 3, 16); r(bark[2], -1, -12, 1, 12);
    r('#65594d', 2, -10, 1, 9); r(bark[0], -3, 0, 3, 1);
    r(bark[0], -4, -17, 3, 6); r(bark[1], -3, -17, 1, 5);
    r(bark[0], 2, -18, 4, 4); r(bark[2], 2, -18, 2, 1);
    if (kind === 'swamp') {
      r('#625f52', -3, -3, 2, 5); r('#625f52', 3, -4, 2, 6);
      r('#8d8872', -3, -2, 1, 3); r('#8d8872', 3, -3, 1, 3);
    }
    const crown = treeCrowns[kind === 'savanna' ? (shape % 2 ? 0 : 2) : shape];
    const top = kind === 'savanna' ? -29 : shape === 2 ? -28 : -32;
    for (let y = 0; y < crown.length; y++) for (let x = 0; x < crown[y].length; x++) {
      const shade = Number(crown[y][x]);
      if (shade) r(colors[shade - 1], x - 12, top + y, 1, 1);
    }
    if (kind === 'lemon') for (const [x, y] of [[-7, -23], [5, -16], [-2, -28]]) {
      r('#ab8e3e', x, y, 2, 3); r('#f0d45e', x, y, 2, 2); r('#fff09e', x, y, 1, 1);
    }
    if (kind === 'swamp') for (const x of [-8, -4, 6, 9]) {
      const length = 3 + (shape + x + 8) % 3;
      r('#4b7351', x, -16, 1, length); r('#8aa574', x, -16, 1, 1);
    }
    broadleafSprites.set(key, sprite);
  }
  ctx.drawImage(sprite, -17, -33);
}

const pixelSprites = new WeakMap<PixelSprite, HTMLCanvasElement>();
function drawPixels(ctx: CanvasRenderingContext2D, sprite: PixelSprite): void {
  let canvas = pixelSprites.get(sprite);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, ...sprite.pixels.map(row => row.length));
    canvas.height = Math.max(1, sprite.pixels.length);
    const painter = canvas.getContext('2d')!;
    for (let y = 0; y < sprite.pixels.length; y++) for (let x = 0; x < sprite.pixels[y].length; x++) {
      const color = sprite.palette[sprite.pixels[y][x]];
      if (color) pixel(painter, color, x, y, 1, 1);
    }
    pixelSprites.set(sprite, canvas);
  }
  ctx.drawImage(canvas, -sprite.anchor.x, -sprite.anchor.y);
}

/** A 19×22 original pixel speech bubble, cached by the renderer. */
export function drawStatusBubble(ctx: CanvasRenderingContext2D, kind: StatusIcon): void {
  const r = (color: string, x: number, y: number, w: number, h: number): void => pixel(ctx, color, x, y, w, h);
  r('#69523b', 3, 2, 15, 17); r('#69523b', 2, 4, 17, 13); r('#69523b', 7, 18, 3, 4);
  r('#352f23', 3, 0, 13, 19); r('#352f23', 1, 2, 17, 15); r('#352f23', 6, 18, 3, 3);
  r('#fff6db', 3, 1, 13, 17); r('#fff6db', 2, 3, 15, 13); r('#fff6db', 7, 17, 2, 3);
  r('#e8d9b7', 3, 16, 13, 2);
  if (kind === 'heart') {
    r('#c94062', 5, 7, 9, 4); r('#c94062', 6, 11, 7, 2); r('#c94062', 8, 13, 3, 2);
    r('#e85878', 4, 5, 4, 4); r('#e85878', 10, 5, 4, 4); r('#e85878', 5, 7, 8, 4); r('#e85878', 7, 11, 4, 2); r('#e85878', 8, 13, 2, 1);
    r('#ff9aad', 5, 6, 2, 1); r('#ff9aad', 11, 6, 2, 1);
  } else {
    for (let i = 0; i < 7; i++) { r('#52616b', 4 + i, 4 + i, 2, 2); r('#52616b', 12 - i, 4 + i, 2, 2); }
    for (let i = 0; i < 6; i++) { r('#a1b5b9', 4 + i, 4 + i, 1, 1); r('#c0cdd0', 12 - i, 4 + i, 1, 1); }
    r('#90653a', 3, 12, 2, 3); r('#90653a', 13, 12, 2, 3);
    r('#c79d56', 3, 10, 5, 2); r('#c79d56', 11, 10, 5, 2);
  }
}

/** Original sprites, drawn in local pixel coordinates around their ground point. */
export function drawSprite(ctx: CanvasRenderingContext2D, sprite: Sprite, variant = 0, time = 0, child = false, growth = 0, color?: string, race: RaceId = 'human'): void {
  if (typeof sprite !== 'string') { drawPixels(ctx, sprite); return; }
  const r = (color: string, x: number, y: number, w: number, h: number): void => pixel(ctx, color, x, y, w, h);
  if (sprite === 'sheep' || sprite === 'dog' || sprite === 'wolf') {
    drawAnimal(ctx, { kind: sprite, age: child ? 0 : 20, heading: 0, stride: time * 5, moving: true, hunger: 0 }, color);
  } else if (sprite === 'market' || sprite === 'mill' || sprite === 'bakery' || sprite === 'workshop') {
    drawWorkplace(ctx, sprite, time, color);
  } else if (sprite === 'ship') {
    drawShipSprite(ctx, time);
  } else if (sprite === 'harbor') {
    drawHarborSprite(ctx, time);
  } else if (sprite === 'dragon') {
    drawDragonSprite(ctx, time);
  } else if (sprite === 'ufo') {
    drawUfoSprite(ctx, time);
  } else if (sprite === 'tree') {
    drawBroadleafTree(ctx, variant);
  } else if (sprite === 'person') {
    drawResidentSprite(ctx, { time, variant, child, color, race });
  } else if (sprite === 'house') {
    if (race !== 'human') {
      r('#37534455', -9, 0, 24, 6);
      if (race === 'elf') {
        r('#705c3c', -8, -10, 17, 14); r('#ccb98b', -6, -10, 13, 13);
        r('#56783d', -12, -13, 25, 4); r('#6c974b', -9, -17, 19, 5);
        r('#83af5b', -6, -21, 13, 5); r('#a8c877', -3, -25, 7, 5); r('#c3dd8d', 0, -28, 2, 4);
        r('#405c36', -10, -12, 4, 3); r('#405c36', 7, -12, 4, 3);
        r('#6e583c', -2, -6, 5, 10); r('#b8d0b6', -6, -7, 3, 4); r('#b8d0b6', 4, -7, 3, 4);
        r(color ?? '#c9ba6f', -1, -17, 3, 4);
      } else if (race === 'orc') {
        r('#624734', -10, -8, 21, 12); r('#99794c', -8, -8, 17, 11);
        r('#513c2a', -12, -10, 25, 3); r('#8b6942', -10, -14, 21, 4); r('#ad8751', -6, -18, 13, 5);
        r('#c9ac6b', -3, -21, 7, 4); r('#705137', -8, -12, 2, 15); r('#705137', 7, -12, 2, 15);
        r('#eadbb0', -10, -18, 2, 8); r('#eadbb0', 9, -18, 2, 8); r('#eadbb0', -12, -20, 2, 4); r('#eadbb0', 11, -20, 2, 4);
        r('#392f25', -3, -5, 7, 9); r(color ?? '#a75e43', -2, -14, 5, 4);
      } else {
        r('#515e62', -11, -10, 23, 15); r('#9da4a0', -10, -9, 21, 13);
        r('#697577', -12, -14, 25, 5); r('#9aa4a1', -9, -18, 19, 4); r('#c4c9b8', -7, -19, 15, 2);
        r('#65706d', -11, -1, 23, 1); r('#65706d', -10, -6, 21, 1);
        for (const x of [-7, 1, 8]) r('#65706d', x, -9, 1, 4);
        r('#c6b78d', -4, -7, 9, 11); r('#393e3a', -2, -6, 5, 10); r('#c2a263', 0, -5, 1, 7);
        r('#edc36f', -8, -5, 2, 3); r('#edc36f', 7, -5, 2, 3);
        r(color ?? '#b78d51', -3, -15, 7, 3); r('#d5cab0', -12, 4, 25, 2);
      }
      return;
    }
    const roof = color ?? ['#b57153', '#ad7655', '#8a8180'][variant % 3];
    r('#37534455', -8, 0, 22, 6);
    r('#a38b69', -9, -8, 19, 13); r('#e4d3a9', -8, -8, 17, 11);
    r('#c1ad83', 5, -8, 4, 11); r('#f2e1b6', -8, -8, 2, 10);
    r('#805b46', -11, -11, 23, 3); r(roof, -10, -14, 21, 4);
    r(roof, -7, -17, 15, 4); r(roof, -4, -20, 9, 4); r('#d79b6b', -4, -20, 9, 2);
    r('#895641', -7, -14, 15, 1); r('#895641', -3, -17, 11, 1);
    r('#71634f', 5, -22, 3, 7); r('#bfb294', 4, -23, 5, 2);
    r('#755a41', -2, -4, 5, 9); r('#a38b62', -1, -3, 1, 7); r('#e5cd85', 1, 0, 1, 1);
    r('#687f79', -6, -5, 3, 4); r('#b9d0b4', -6, -5, 3, 1);
    r('#c8b998', -10, 4, 21, 2);
  } else if (sprite === 'farm') {
    r('#8b6944', -12, -9, 25, 19); r('#a18051', -11, -8, 23, 17);
    for (let y = -6; y <= 6; y += 5) {
      r('#6e553b', -10, y + 1, 21, 2);
      for (let x = -8; x <= 8; x += 4) {
        const height = 1 + Math.floor(growth * 6);
        r(growth > 0.7 ? '#e4c565' : '#79a455', x, y - height, 1, height + 1);
        if (growth > 0.35) { r(growth > 0.7 ? '#f4d980' : '#a4bd60', x - 1, y - height, 3, 2); }
      }
    }
    r('#c5a36a', -13, -9, 2, 5); r('#c5a36a', 12, 6, 2, 5);
  } else if (sprite === 'caravan') {
    const walk = Math.sin(time * 9) > 0 ? 1 : 0;
    r('#344e4755', -10, 2, 25, 3);
    r('#503c2c', -10, -5, 18, 7); r('#b58c55', -9, -5, 16, 5); r('#d3ac70', -9, -5, 16, 2);
    for (const x of [-7, 4]) { r('#343b35', x - 2, 0, 5, 5); r('#bdb18b', x, 1 + walk, 1, 2); }
    if (growth > 0) {
      r('#b3a075', -8, -10, 6, 5); r('#e4ca8e', -7, -11, 4, 5); r('#776143', -6, -12, 2, 2);
      r('#d5b06e', -1, -8, 7, 3); r('#efd28f', 0, -9, 5, 3);
    }
    r('#765c3f', -10, -19, 1, 14); r(color ?? '#d8bd80', -9, -19, 7, 4);
    r('#8c704c', 7, -3, 6, 1);
    r('#414d50', 12, -1, 2, 4 - walk); r('#414d50', 15, -1, 2, 3 + walk);
    r(color ?? '#b8aa81', 12, -6, 5, 5); r('#d9ad80', 10, -4, 2, 2);
    r(race === 'orc' ? '#8bb456' : '#e6bf91', 12, -10, 5, 4); r('#826645', 11, -11, 7, 2); r('#bd9e66', 12, -13, 4, 2);
    if (race === 'elf') { r('#edcfaa', 10, -9, 2, 1); r('#edcfaa', 17, -9, 2, 1); }
    if (race === 'dwarf') r('#895032', 12, -7, 5, 3);
  } else if (sprite === 'dynamite') {
    r('#293e4355', -6, 1, 14, 3);
    for (const [x, y] of [[-6, -8], [-2, -10], [2, -8]]) {
      r('#642c29', x, y, 4, 11); r('#b84332', x, y + 1, 3, 9);
      r('#e57448', x, y + 1, 1, 8); r('#ecad73', x + 1, y, 2, 1);
      r('#7e352b', x + 1, y + 9, 2, 1);
    }
    r('#b89b60', -6, -6, 12, 2); r('#edcf8a', -5, -6, 10, 1);
    r('#b89b60', -6, -1, 12, 2); r('#edcf8a', -5, -1, 10, 1);
    r('#f0d5a1', -2, -4, 4, 2); r('#7b4837', -1, -4, 2, 1);
  } else if (sprite === 'rocket') {
    r('#364e52', -4, -11, 9, 18); r('#bdccc2', -3, -11, 7, 17);
    r('#f0eed2', -3, -10, 2, 15); r('#879e99', 3, -9, 1, 14);
    r('#9b4334', -3, -14, 7, 4); r('#cf6748', -2, -16, 5, 4); r('#ffba78', -1, -17, 2, 3);
    r('#556d6e', -3, -7, 7, 1); r('#798c82', -3, 0, 7, 1);
    r('#d99252', -3, -5, 7, 2); r('#ebc37a', -3, -5, 2, 2);
    r('#344e56', -1, -9, 3, 2); r('#84c2c4', 0, -9, 2, 1);
    r('#8e4438', -6, 2, 3, 7); r('#d37a53', -5, 2, 2, 5);
    r('#8e4438', 4, 2, 3, 7); r('#e19561', 4, 2, 1, 5);
    r('#394d50', -3, 6, 7, 3); r('#788e87', -2, 6, 5, 1);
    r('#e1b66b', -1, 8, 3, 1);
  } else if (sprite === 'crate') {
    r('#a1804f', -5, -9, 10, 10); r('#d2b779', -4, -8, 8, 2); r('#735739', -1, -7, 2, 8);
  }
}

export function drawToolIcon(canvas: HTMLCanvasElement, appearance?: ToolIcon): void {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.translate(32, 32);
  ctx.scale(2, 2);
  const r = (color: string, x: number, y: number, w: number, h: number): void => pixel(ctx, color, x, y, w, h);
  if (appearance && typeof appearance !== 'string') {
    drawPixels(ctx, appearance);
  } else if (appearance === 'dragon') {
    ctx.scale(0.4, 0.4); drawDragonSprite(ctx, 0.2, -Math.PI / 6);
  } else if (appearance === 'ship') {
    ctx.scale(0.65, 0.65); ctx.translate(0, 12); drawShipSprite(ctx, 0.3, -0.15, 'trade');
  } else if (appearance === 'harbor') {
    ctx.scale(0.5, 0.5); ctx.translate(-7, 13); drawHarborSprite(ctx, 0.3);
  } else if (appearance === 'ufo') {
    ctx.scale(0.75, 0.75); ctx.translate(0, 4); drawUfoSprite(ctx, 0.3, -0.12);
  } else if (appearance === 'human') {
    r('#172623', -10, -8, 20, 21); r('#315474', -10, 6, 20, 7);
    r('#4f92b4', -8, 6, 16, 5); r('#82bad0', -8, 6, 4, 5);
    r('#b77640', -7, -8, 15, 14); r('#e6ae6e', -6, -7, 12, 13);
    r('#f3cb8c', -6, -6, 9, 9); r('#86582d', -7, -10, 14, 4);
    r('#b67b3e', -5, -11, 10, 3); r('#86582d', -7, -7, 2, 5);
    r('#252c28', -3, -3, 2, 2); r('#252c28', 3, -3, 2, 2);
    r('#c88749', 0, 0, 2, 2); r('#86582d', -3, 3, 7, 2);
    r('#e5b576', -2, 5, 5, 3);
  } else if (appearance === 'elf') {
    r('#213d30', -9, 5, 18, 8); r('#6c9855', -7, 5, 14, 7); r('#b4c779', -2, 5, 4, 6);
    r('#ba9e62', -7, -10, 14, 16); r('#edcfaa', -5, -7, 10, 12);
    r('#edcfaa', -11, -6, 6, 2); r('#edcfaa', 5, -6, 6, 2); r('#edcfaa', -12, -8, 2, 2); r('#edcfaa', 10, -8, 2, 2);
    r('#e0d093', -6, -12, 12, 5); r('#618443', -5, -7, 10, 2); r('#c9df94', -1, -9, 2, 3);
    r('#354d37', -3, -3, 1, 2); r('#354d37', 2, -3, 1, 2); r('#b88763', -1, 2, 3, 1);
  } else if (appearance === 'orc') {
    r('#3b3e25', -11, 4, 22, 9); r('#86633d', -9, 5, 18, 7); r('#c2a473', -7, 8, 14, 2);
    r('#4c6c35', -9, -9, 18, 15); r('#8eb55c', -7, -8, 14, 14); r('#b0ca79', -6, -7, 6, 4);
    r('#304526', -8, -11, 16, 4); r('#34442a', -5, -3, 3, 2); r('#34442a', 2, -3, 3, 2);
    r('#486233', -4, 2, 8, 3); r('#f2e6ba', -5, 0, 2, 5); r('#f2e6ba', 3, 0, 2, 5);
  } else if (appearance === 'dwarf') {
    r('#41474b', -10, 5, 20, 8); r('#a97843', -8, 5, 16, 7);
    r('#e0b384', -7, -6, 14, 12); r('#aeb7b2', -9, -10, 18, 5); r('#65747a', -10, -6, 20, 3);
    r('#d1b777', -2, -11, 4, 8); r('#f1db9c', -1, -11, 1, 8);
    r('#44352a', -5, -1, 2, 2); r('#44352a', 3, -1, 2, 2);
    r('#8a502e', -8, 3, 16, 5); r('#ac7541', -6, 7, 12, 3); r('#c18a50', -3, 9, 6, 4);
    r('#e7c98c', -1, 9, 2, 3);
  } else if (appearance === 'rain') {
    r('#174a68', -12, -4, 24, 9); r('#79aec5', -11, -6, 22, 8);
    r('#c9e0d7', -10, -8, 19, 8); r('#edf1d9', -7, -11, 12, 8);
    r('#fbf8e9', -5, -12, 8, 3); r('#a6c9d0', 6, -5, 5, 5);
    for (const x of [-8, -1, 6]) {
      r('#167eac', x, 6, 3, 6); r('#56d1e9', x, 5, 2, 5); r('#b1f3ef', x, 5, 1, 2);
    }
  } else if (appearance === 'dynamite') {
    r('#252723', -11, -7, 22, 18);
    for (const [x, y] of [[-9, -5], [-2, -8], [5, -5]]) {
      r('#842c26', x, y, 6, 18); r('#ce4630', x, y, 4, 17); r('#f37743', x, y, 2, 17);
      r('#ecdcad', x, y + 4, 6, 3); r('#ecdcad', x, y + 12, 6, 2);
    }
    r('#c6a165', 1, -12, 1, 4); r('#f8c44f', 0, -14, 3, 3);
    r('#fff0a2', 1, -13, 1, 1); r('#dc7a30', -3, -14, 2, 1); r('#dc7a30', 5, -12, 2, 1);
  } else if (appearance === 'rocket') {
    r('#225063', -7, 5, 14, 4); r('#b8382d', -8, 2, 4, 9); r('#ef6043', 5, 2, 4, 9);
    r('#516568', -4, -8, 9, 18); r('#d6e1c9', -4, -8, 7, 17); r('#f3f3d7', -4, -7, 2, 15);
    r('#ae3e31', -3, -12, 7, 5); r('#eb6549', -2, -14, 5, 5); r('#ff9a62', 0, -15, 1, 3);
    r('#277a9e', -1, -5, 3, 4); r('#7cd3db', -1, -5, 2, 2);
    r('#d87826', -3, 10, 7, 3); r('#ffc34b', -2, 10, 5, 5); r('#fff2a3', -1, 10, 3, 3);
  } else {
    r('#e4d3a9', -5, -5, 10, 10); r('#7fa56b', -3, -3, 6, 6);
  }
  ctx.restore();
}
