import { Random } from '../core/random';
import type { Village } from '../core/types';
import type { Language } from '../i18n';

// RimWorld-inspired colony-name patterns, with our own localized word banks:
// https://github.com/Ludeon/RimWorld-ru/blob/master/Core/DefInjected/RulePackDef/RulePacks_Namers_Factions.xml
const syllables = ['ар', 'бел', 'вен', 'гар', 'дел', 'дор', 'зен', 'кал', 'кер', 'лан', 'лин', 'мар', 'мер', 'нор', 'ран', 'рен', 'рим', 'сар', 'сел', 'тал', 'тер', 'тор', 'фал', 'хел', 'шар', 'эл', 'эр', 'яр'];
const endings = ['вилль', 'таун', 'хёрст', 'бурн', 'дейл', 'хоуп', 'несс', 'мир', 'вик', 'стон', 'вуд', 'форд'];
const fixedNames = ['Новый Эдем', 'Последний приют', 'Тихая гавань', 'Дальний рубеж', 'Белый пепел', 'Красная скала', 'Звёздная пыль', 'Новая заря', 'Сухой ручей', 'Седьмой причал', 'Падшая звезда', 'Забытый берег'];
const features = [
  { name: 'каньон', genitive: 'каньона', prepositional: 'каньоне', gender: 0 },
  { name: 'утёс', genitive: 'утёса', prepositional: 'утёсе', gender: 0 },
  { name: 'перевал', genitive: 'перевала', prepositional: 'перевале', gender: 0 },
  { name: 'берег', genitive: 'берега', prepositional: 'берегу', gender: 0 },
  { name: 'холм', genitive: 'холма', prepositional: 'холме', gender: 0 },
  { name: 'долина', genitive: 'долины', prepositional: 'долине', gender: 1 },
  { name: 'скала', genitive: 'скалы', prepositional: 'скале', gender: 1 },
  { name: 'река', genitive: 'реки', prepositional: 'реке', gender: 1 },
];
const adjectives = [['красный', 'красная'], ['серый', 'серая'], ['тихий', 'тихая'], ['дальний', 'дальняя'], ['забытый', 'забытая'], ['пепельный', 'пепельная'], ['северный', 'северная'], ['золотой', 'золотая']];
const concepts = ['надежды', 'свободы', 'рассвета', 'покоя', 'единства', 'изобилия', 'удачи', 'спасения'];
const people = ['странников', 'рудокопов', 'охотников', 'изгнанников', 'первопроходцев', 'поселенцев', 'ремесленников', 'земледельцев'];
const communities = ['форт', 'приют', 'посёлок', 'оплот', 'лагерь', 'убежище'];
const capitalize = (name: string): string => name[0].toUpperCase() + name.slice(1);

type NameBank = {
  syllables: string[]; endings: string[]; fixedNames: string[];
  features: typeof features; adjectives: string[][]; concepts: string[]; people: string[]; communities: string[];
};
const featureNames = (names: string[], feminine: number[] = []): typeof features => names.map((name, i) => ({
  name, genitive: name, prepositional: name, gender: feminine.includes(i) ? 1 : 0,
}));
// Keep indices and random draws aligned across languages so changing language never rerolls a name.
const banks: Record<Language, NameBank> = {
  ru: { syllables, endings, fixedNames, features, adjectives, concepts, people, communities },
  en: {
    syllables: ['ar', 'bel', 'ven', 'gar', 'del', 'dor', 'zen', 'kal', 'ker', 'lan', 'lin', 'mar', 'mer', 'nor', 'ran', 'ren', 'rim', 'sar', 'sel', 'tal', 'ter', 'tor', 'fal', 'hel', 'shar', 'el', 'er', 'yar'],
    endings: ['ville', 'town', 'hurst', 'burn', 'dale', 'hope', 'ness', 'mere', 'wick', 'stone', 'wood', 'ford'],
    fixedNames: ['New Eden', 'Last Refuge', 'Quiet Haven', 'Far Frontier', 'White Ash', 'Red Rock', 'Stardust', 'New Dawn', 'Dry Creek', 'Seventh Landing', 'Fallen Star', 'Forgotten Shore'],
    features: featureNames(['canyon', 'cliff', 'pass', 'shore', 'hill', 'valley', 'rock', 'river']),
    adjectives: ['red', 'grey', 'quiet', 'distant', 'forgotten', 'ashen', 'northern', 'golden'].map(word => [word, word]),
    concepts: ['hope', 'freedom', 'dawn', 'peace', 'unity', 'plenty', 'fortune', 'salvation'],
    people: ['wanderers', 'miners', 'hunters', 'exiles', 'pioneers', 'settlers', 'artisans', 'farmers'],
    communities: ['fort', 'haven', 'hamlet', 'stronghold', 'camp', 'refuge'],
  },
  'zh-CN': {
    syllables: ['阿尔', '贝尔', '文', '加尔', '德尔', '多尔', '泽恩', '卡尔', '凯尔', '兰', '林', '马尔', '梅尔', '诺尔', '然', '伦', '里姆', '萨尔', '塞尔', '塔尔', '特尔', '托尔', '法尔', '赫尔', '沙尔', '艾尔', '埃尔', '雅尔'],
    endings: ['维尔', '镇', '赫斯特', '伯恩', '谷', '霍普', '尼斯', '米尔', '维克', '斯通', '伍德', '福德'],
    fixedNames: ['新伊甸', '最后的庇护所', '宁静港湾', '遥远边疆', '白灰', '红岩', '星尘', '新曙光', '干溪', '第七码头', '落星', '遗忘之岸'],
    features: featureNames(['峡谷', '悬崖', '山口', '海岸', '山丘', '河谷', '岩石', '河流']),
    adjectives: ['赤色', '灰色', '宁静', '遥远', '遗忘', '灰烬', '北方', '金色'].map(word => [word, word]),
    concepts: ['希望', '自由', '黎明', '和平', '团结', '丰饶', '幸运', '救赎'],
    people: ['流浪者', '矿工', '猎人', '流亡者', '开拓者', '定居者', '工匠', '农夫'],
    communities: ['堡垒', '港湾', '村庄', '要塞', '营地', '避难所'],
  },
  ja: {
    syllables: ['アル', 'ベル', 'ヴェン', 'ガル', 'デル', 'ドル', 'ゼン', 'カル', 'ケル', 'ラン', 'リン', 'マル', 'メル', 'ノル', 'ラーン', 'レン', 'リム', 'サル', 'セル', 'タル', 'テル', 'トル', 'ファル', 'ヘル', 'シャル', 'エル', 'エール', 'ヤル'],
    endings: ['ヴィル', 'タウン', 'ハースト', 'バーン', 'デール', 'ホープ', 'ネス', 'ミア', 'ウィック', 'ストーン', 'ウッド', 'フォード'],
    fixedNames: ['新たなエデン', '最後の避難所', '静かな港', '遥かな辺境', '白い灰', '赤い岩', '星屑', '新たな夜明け', '枯れた小川', '第七の船着場', '落ちた星', '忘れられた岸'],
    features: featureNames(['峡谷', '断崖', '峠', '海岸', '丘', '谷', '岩', '川']),
    adjectives: ['赤い', '灰色の', '静かな', '遥かな', '忘れられた', '灰の', '北の', '黄金の'].map(word => [word, word]),
    concepts: ['希望', '自由', '夜明け', '平和', '団結', '豊穣', '幸運', '救済'],
    people: ['旅人', '鉱夫', '狩人', '追放者', '開拓者', '入植者', '職人', '農民'],
    communities: ['砦', '安息地', '集落', '要塞', '野営地', '避難所'],
  },
  es: {
    syllables: ['ar', 'bel', 'ven', 'gar', 'del', 'dor', 'zen', 'cal', 'quer', 'lan', 'lin', 'mar', 'mer', 'nor', 'ran', 'ren', 'rim', 'sar', 'sel', 'tal', 'ter', 'tor', 'fal', 'hel', 'shar', 'el', 'er', 'yar'],
    endings: ['villa', 'pueblo', 'hurst', 'burn', 'valle', 'hope', 'nes', 'mar', 'vic', 'piedra', 'bosque', 'vado'],
    fixedNames: ['Nuevo Edén', 'Último refugio', 'Puerto tranquilo', 'Frontera lejana', 'Ceniza blanca', 'Roca roja', 'Polvo de estrellas', 'Nuevo amanecer', 'Arroyo seco', 'Séptimo embarcadero', 'Estrella caída', 'Costa olvidada'],
    features: featureNames(['cañón', 'acantilado', 'paso', 'costa', 'colina', 'valle', 'roca', 'río'], [3, 4, 6]),
    adjectives: [['rojo', 'roja'], ['gris', 'gris'], ['tranquilo', 'tranquila'], ['lejano', 'lejana'], ['olvidado', 'olvidada'], ['ceniciento', 'cenicienta'], ['norteño', 'norteña'], ['dorado', 'dorada']],
    concepts: ['la esperanza', 'la libertad', 'el alba', 'la paz', 'la unidad', 'la abundancia', 'la fortuna', 'la salvación'],
    people: ['los viajeros', 'los mineros', 'los cazadores', 'los exiliados', 'los pioneros', 'los colonos', 'los artesanos', 'los granjeros'],
    communities: ['fuerte', 'puerto', 'aldea', 'bastión', 'campamento', 'refugio'],
  },
};
const nameLanguages = Object.keys(banks) as Language[];
type LocalizedName = Record<Language, string>;

function candidate(rng: Random, language: Language): string {
  const { syllables, endings, fixedNames, features, adjectives, concepts, people, communities } = banks[language];
  const pick = <T>(values: readonly T[]): T => values[Math.floor(rng.next() * values.length)];
  const word = (): string => {
    const pattern = Math.floor(rng.next() * 9);
    if (pattern < 2) return pick(syllables) + pick(syllables);
    if (pattern < 4) return pick(syllables) + pick(syllables) + pick(syllables);
    if (pattern < 6) return pick(syllables) + pick(endings);
    if (pattern < 8) return pick(syllables) + pick(syllables) + pick(endings);
    return pick(features).name + pick(endings);
  };
  const possessive = (place: string, owner: string, group: boolean): string => {
    if (language === 'ru') return `${place} ${owner}`;
    if (language === 'es') return `${place} de ${owner}`.replace('de el ', 'del ');
    if (language === 'ja') return `${owner}の${place}`;
    if (language === 'zh-CN') return `${owner}${place}`;
    return `${owner}${group ? "'" : ''} ${place}`;
  };
  const pattern = Math.floor(rng.next() * 20);
  if (pattern < 9) return word();
  if (pattern < 13) return pick(fixedNames);
  const feature = pick(features);
  if (pattern < 16) {
    const adjective = pick(adjectives)[feature.gender];
    if (language === 'es') return `${feature.name} ${adjective}`;
    return `${adjective}${language === 'ja' || language === 'zh-CN' ? '' : ' '}${feature.name}`;
  }
  if (pattern === 16) {
    const prefix = rng.next() < 0.5 ? word() : pick(communities), on = rng.next() < 0.5;
    if (language === 'ru') return on ? `${prefix}-на-${feature.prepositional}` : `${prefix}-у-${feature.genitive}`;
    if (language === 'en') return `${prefix}-${on ? 'on' : 'by'}-the-${feature.name}`;
    if (language === 'es') return `${prefix} junto ${feature.gender ? 'a la' : 'al'} ${feature.name}`;
    if (language === 'ja') return `${feature.name}の${prefix}`;
    return `${feature.name}旁的${prefix}`;
  }
  if (pattern === 17) return possessive(feature.name, pick(concepts), false);
  if (pattern === 18) return possessive(feature.name, pick(people), true);
  return possessive(pick(communities), pick(people), true);
}
function nextName(rng: Random, language: Language): string {
  const name = capitalize(candidate(rng, language));
  return language === 'en' ? name.replace(/\b[a-z]/g, letter => letter.toUpperCase()).replace(/-(On|By)-The-/g, match => match.toLowerCase()) : name;
}

/** Names use their own seeded stream so a naming change cannot alter people's lives. */
export function settlementName(seed: number, id: number, existing: Iterable<string>, language: Language = 'en'): string {
  const rng = new Random(seed ^ Math.imul(id, 0x9e3779b9));
  const used = new Set(existing);
  let name = '';
  for (let attempt = 0; attempt < 64; attempt++) {
    name = nextName(rng, language);
    if (!used.has(name)) return name;
  }
  // Bounded retries even if an imported world's names exhaust common combinations.
  let suffix = 2;
  while (used.has(`${name} ${suffix}`)) suffix++;
  return `${name} ${suffix}`;
}

const nameCache = new WeakMap<Village, { seed: number; id: number; source: string; names: LocalizedName }>();
/** Recognize saved generated names, including the original Russian generator, without changing a save. */
function savedNames(seed: number, village: Village): LocalizedName {
  const cached = nameCache.get(village);
  if (cached?.seed === seed && cached.id === village.id && cached.source === village.name) return cached.names;
  const rng = new Random(seed ^ Math.imul(village.id, 0x9e3779b9));
  let names = Object.fromEntries(nameLanguages.map(language => [language, village.name])) as LocalizedName;
  const numbered = /^(.*) ([2-9]|[1-9]\d+)$/.exec(village.name);
  for (let attempt = 0; attempt < 64; attempt++) {
    const state = rng.state;
    const variants = Object.fromEntries(nameLanguages.map(language => [language, nextName(new Random(state), language)])) as LocalizedName;
    nextName(rng, 'en');
    if (Object.values(variants).includes(village.name)) { names = variants; break; }
    if (attempt === 63 && numbered && Object.values(variants).includes(numbered[1])) {
      names = Object.fromEntries(nameLanguages.map(language => [language, `${variants[language]} ${numbered[2]}`])) as LocalizedName;
    }
  }
  nameCache.set(village, { seed, id: village.id, source: village.name, names });
  return names;
}

export const localizedSettlementName = (seed: number, village: Village, language: Language): string => savedNames(seed, village)[language];

const textCache = new WeakMap<Village[], { seed: number; language: Language; sources: { id: number; name: string }[]; localize: (text: string) => string }>();
const legacyName = (id: number): string => {
  const names = ['Берёзовка', 'Заречье', 'Сосновый бор', 'Луговое', 'Дубрава', 'Рассвет', 'Озерки', 'Ясная поляна'];
  return names[(id - 1) % names.length] + (id > names.length ? ` ${Math.ceil(id / names.length)}` : '');
};
/** One matcher per displayed society; longest names win and replacements never cascade. */
export function settlementTextLocalizer(seed: number, villages: Village[], language: Language): (text: string) => string {
  const cached = textCache.get(villages);
  if (cached?.seed === seed && cached.language === language && cached.sources.length === villages.length
    && cached.sources.every((source, i) => source.id === villages[i].id && source.name === villages[i].name)) return cached.localize;
  const replacements = new Map<string, string>();
  const currentNames = new Set(villages.map(v => v.name));
  for (const village of villages) {
    const variants = savedNames(seed, village), localized = variants[language];
    replacements.set(village.name, localized);
    // Old eight-name saves were already upgraded by World; their chronicles still contain the old labels.
    const oldName = legacyName(village.id);
    if (variants.en !== variants.ru && !currentNames.has(oldName)) replacements.set(oldName, localized);
  }
  if (!replacements.size) return text => text;
  const names = [...replacements.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  const localize = (text: string): string => text.replace(pattern, name => replacements.get(name)!);
  textCache.set(villages, { seed, language, sources: villages.map(({ id, name }) => ({ id, name })), localize });
  return localize;
}

/** Replace only names made by the old eight-name cycle; saved custom names stay intact. */
export function refreshLegacySettlementNames(seed: number, villages: Village[]): void {
  const used = new Set(villages.map(v => v.name));
  for (const village of [...villages].sort((a, b) => a.id - b.id)) {
    const oldName = legacyName(village.id);
    if (village.name !== oldName) continue;
    village.name = settlementName(seed, village.id, used);
    used.add(village.name);
  }
}
