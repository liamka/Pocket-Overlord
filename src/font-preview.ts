import './font-preview.css';
import { isLanguage, languages, loadLanguage, translate } from './i18n';
import type { Language } from './i18n';
import { version } from '../package.json';

const copy = {
  en: {
    title: "Find the world's voice.", eyebrow: '9 pixel fonts · Latin + Cyrillic',
    intro: 'Compare fonts, then select one to see it in the game panels.', back: 'Back to the game',
    sample: 'Your sample text', size: 'Sample size', sampleText: 'Create your own world',
    scripts: 'Pixel fonts with Latin and Cyrillic. Missing characters use the system font.',
    preview: 'Game preview', village: 'Oakwood', mapLabel: 'Map label · 10 px',
    help: "To use this font throughout the game, send its name or this page's link.",
    copy: 'Copy selection link', copied: 'Link copied', copyFailed: 'Copy the link from the address bar.',
    previewOnly: 'Selection changes this preview only.', current: 'Current game font',
    pixel: 'Pixel',
    loading: 'Loading…', ready: 'Loaded', failed: 'Font unavailable',
    loadingDetail: 'Loading the selected font…', failedDetail: 'Font unavailable. The preview is showing a fallback font.',
    options: 'Font options', language: 'Language',
  },
  ru: {
    title: 'Найди характер своего мира.', eyebrow: '9 пиксельных шрифтов · Латиница + кириллица',
    intro: 'Сравни шрифты и выбери вариант для предпросмотра на игровых панелях.', back: 'Вернуться в игру',
    sample: 'Твой текст для сравнения', size: 'Размер образца', sampleText: 'Создай свой мир',
    scripts: 'Пиксельные шрифты с латиницей и кириллицей. Недостающие символы берутся из системного шрифта.',
    preview: 'Предпросмотр в игре', village: 'Дубрава', mapLabel: 'Подпись на карте · 10 px',
    help: 'Чтобы заменить шрифт во всей игре, отправь его название или ссылку на эту страницу.',
    copy: 'Скопировать ссылку на выбор', copied: 'Ссылка скопирована', copyFailed: 'Скопируй ссылку из адресной строки.',
    previewOnly: 'Выбор меняет только этот предпросмотр.', current: 'Текущий шрифт игры',
    pixel: 'Пиксельный',
    loading: 'Загрузка…', ready: 'Загружен', failed: 'Шрифт недоступен',
    loadingDetail: 'Загружается выбранный шрифт…', failedDetail: 'Шрифт недоступен. В предпросмотре показан запасной шрифт.',
    options: 'Варианты шрифтов', language: 'Язык',
  },
  'zh-CN': {
    title: '找到世界的声音。', eyebrow: '9 种像素字体 · 拉丁字母 + 西里尔字母',
    intro: '比较字体，选择一种，在游戏面板中预览。', back: '返回游戏',
    sample: '输入示例文字', size: '示例字号', sampleText: '创造你的世界',
    scripts: '支持拉丁字母和西里尔字母的像素字体。缺少的字符使用系统字体。',
    preview: '游戏预览', village: '橡木村', mapLabel: '地图标签 · 10 px',
    help: '要在整个游戏中使用此字体，请发送字体名称或此页面的链接。',
    copy: '复制所选字体链接', copied: '链接已复制', copyFailed: '请从地址栏复制链接。',
    previewOnly: '选择仅更改此预览。', current: '当前游戏字体',
    pixel: '像素',
    loading: '加载中…', ready: '已加载', failed: '字体不可用',
    loadingDetail: '正在加载所选字体…', failedDetail: '字体不可用。预览正在显示备用字体。',
    options: '字体选项', language: '语言',
  },
  ja: {
    title: '世界に合う文字を探そう。', eyebrow: '9種類のピクセルフォント · ラテン文字 + キリル文字',
    intro: 'フォントを比較し、選んだ書体をゲームパネルで確認できます。', back: 'ゲームに戻る',
    sample: 'サンプルテキスト', size: 'サンプルのサイズ', sampleText: '自分だけの世界を作ろう',
    scripts: 'ラテン文字とキリル文字に対応するピクセルフォントです。未対応の文字にはシステムフォントを使用します。',
    preview: 'ゲーム内プレビュー', village: 'オーク村', mapLabel: '地図のラベル · 10 px',
    help: 'ゲーム全体に使いたいフォントの名前か、このページのリンクを送ってください。',
    copy: '選択したフォントのリンクをコピー', copied: 'リンクをコピーしました', copyFailed: 'アドレスバーからリンクをコピーしてください。',
    previewOnly: '選択はこのプレビューだけに反映されます。', current: '現在のゲームフォント',
    pixel: 'ピクセル',
    loading: '読み込み中…', ready: '読み込み済み', failed: 'フォントを利用できません',
    loadingDetail: '選択したフォントを読み込んでいます…', failedDetail: 'フォントを利用できません。代替フォントを表示しています。',
    options: 'フォント一覧', language: '言語',
  },
  es: {
    title: 'Encuentra la voz de tu mundo.', eyebrow: '9 fuentes de píxeles · Latín + cirílico',
    intro: 'Compara las fuentes y elige una para verla en los paneles del juego.', back: 'Volver al juego',
    sample: 'Tu texto de muestra', size: 'Tamaño de muestra', sampleText: 'Crea tu propio mundo',
    scripts: 'Fuentes de píxeles con caracteres latinos y cirílicos. Los caracteres que falten usan la fuente del sistema.',
    preview: 'Vista previa del juego', village: 'Robledal', mapLabel: 'Etiqueta del mapa · 10 px',
    help: 'Para usar esta fuente en todo el juego, envía su nombre o el enlace de esta página.',
    copy: 'Copiar enlace de selección', copied: 'Enlace copiado', copyFailed: 'Copia el enlace de la barra de direcciones.',
    previewOnly: 'La selección solo cambia esta vista previa.', current: 'Fuente actual del juego',
    pixel: 'Píxeles',
    loading: 'Cargando…', ready: 'Cargada', failed: 'Fuente no disponible',
    loadingDetail: 'Cargando la fuente seleccionada…', failedDetail: 'Fuente no disponible. Se muestra una fuente alternativa.',
    options: 'Opciones de fuentes', language: 'Idioma',
  },
} satisfies Record<Language, Record<string, string>>;
type CopyKey = keyof typeof copy.en;

const fonts = [
  { name: 'Monocraft', id: 'monocraft', category: 'pixel' },
  { name: 'DotGothic16', id: 'dotgothic16', category: 'pixel' },
  { name: 'Galmuri11', id: 'galmuri11', category: 'pixel' },
  { name: 'Galmuri9', id: 'galmuri9', category: 'pixel' },
  { name: 'GalmuriMono11', id: 'galmuri-mono11', category: 'pixel' },
  { name: 'Ark Pixel 12', id: 'ark-pixel-12', category: 'pixel' },
  { name: 'Ark Pixel 10', id: 'ark-pixel-10', category: 'current' },
  { name: 'Rubik Pixels', id: 'rubik-pixels', category: 'pixel' },
  { name: 'Pixelify Sans', id: 'pixelify-sans', category: 'pixel' },
] as const;
type Font = typeof fonts[number];
type FontState = 'loading' | 'ready' | 'error';
const states = new Map<string, FontState>(fonts.map(font => [font.id, 'loading']));
const query = new URLSearchParams(location.search);
const requestedLanguage = query.get('lang');
let language = isLanguage(requestedLanguage) ? requestedLanguage : loadLanguage();
let selected: Font = fonts.find(font => font.id === query.get('font')) ?? fonts.find(font => font.category === 'current')!;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const t = (key: CopyKey) => copy[language][key];
const sampleInput = $<HTMLInputElement>('sample-text');
const sizeInput = $<HTMLInputElement>('sample-size');
const languageSelect = $<HTMLSelectElement>('language');
let customSample = false;

languageSelect.innerHTML = languages.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
$('game-version').textContent = `ver ${version}`;
$('font-grid').innerHTML = fonts.map((font, index) => `
  <button type="button" class="font-card" data-font="${font.id}" data-state="loading" aria-pressed="false" style="--specimen-font: '${font.name}'">
    <span class="card-heading"><span class="card-number">${String(index + 1).padStart(2, '0')}</span><span class="card-name" translate="no">${font.name}</span><span class="card-marker" aria-hidden="true"></span></span>
    <span class="card-sample font-sample"></span>
    <span class="card-detail font-sample"></span>
    <span class="card-alphabet font-sample" translate="no">Aa Bb Cc · Аа Бб Ёё Жж<br />0123456789 · 1× 4× 100%</span>
    <span class="card-footer"><span data-category="${font.category}"></span><span class="font-status"></span></span>
  </button>`).join('');
const cards = [...document.querySelectorAll<HTMLButtonElement>('.font-card')];

function updateSample() {
  document.querySelectorAll<HTMLElement>('.card-sample').forEach(node => {
    node.textContent = sampleInput.value.trim() ? sampleInput.value : t('sampleText');
  });
}

function updateStatus() {
  cards.forEach(card => {
    const state = states.get(card.dataset.font!)!;
    card.dataset.state = state;
    card.querySelector('.font-status')!.textContent = t(state === 'error' ? 'failed' : state);
  });
  const state = states.get(selected.id);
  $('preview-status').textContent = state === 'loading' ? t('loadingDetail') : state === 'error' ? t('failedDetail') : selected.name;
}

function updateLink() {
  const url = new URL(location.href);
  url.searchParams.set('font', selected.id);
  url.searchParams.set('lang', language);
  history.replaceState(null, '', url);
}

function selectFont(font: Font, scroll = false) {
  selected = font;
  document.documentElement.style.setProperty('--chosen-font', `'${font.name}'`);
  $('preview-title').textContent = font.name;
  $('selected-number').textContent = `${String(fonts.indexOf(font) + 1).padStart(2, '0')} / ${fonts.length}`;
  cards.forEach(card => card.setAttribute('aria-pressed', String(card.dataset.font === font.id)));
  $('copy-choice').textContent = t('copy');
  updateStatus();
  updateLink();
  if (scroll && matchMedia('(max-width: 720px)').matches) {
    document.querySelector('.preview')!.scrollIntoView({ block: 'start' });
  }
}

function localize() {
  document.documentElement.lang = language;
  document.title = `${t('preview')} · ${t('options')} | Pocket World`;
  languageSelect.value = language;
  languageSelect.setAttribute('aria-label', t('language'));
  $('catalogue').setAttribute('aria-label', t('options'));
  document.querySelectorAll<HTMLElement>('[data-copy]').forEach(node => {
    node.textContent = t(node.dataset.copy as CopyKey);
  });
  document.querySelectorAll<HTMLElement>('[data-game]').forEach(node => {
    node.textContent = translate(node.dataset.game!, language, JSON.parse(node.dataset.values ?? '{}'));
  });
  cards.forEach(card => {
    const category = card.querySelector<HTMLElement>('[data-category]')!;
    category.textContent = t(category.dataset.category as CopyKey);
    card.querySelector('.card-detail')!.textContent = `${translate('Day {day}', language, { day: 1 })} · ${translate('Year {year}', language, { year: 1 })}`;
    card.setAttribute('aria-label', `${card.querySelector('.card-name')!.textContent} — ${t('preview')}`);
  });
  if (!customSample) sampleInput.value = t('sampleText');
  updateSample();
  updateStatus();
}

cards.forEach(card => card.addEventListener('click', () => selectFont(fonts.find(font => font.id === card.dataset.font)!, true)));
sampleInput.addEventListener('input', () => { customSample = sampleInput.value.length > 0; updateSample(); });
sizeInput.addEventListener('input', () => {
  document.documentElement.style.setProperty('--sample-size', `${sizeInput.value}px`);
  $('size-value').textContent = `${sizeInput.value} px`;
});
languageSelect.addEventListener('change', () => {
  if (!isLanguage(languageSelect.value)) return;
  language = languageSelect.value;
  localize();
  updateLink();
});
$('copy-choice').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $('copy-choice').textContent = t('copied');
  } catch {
    $('preview-status').textContent = t('copyFailed');
  }
});

localize();
selectFont(selected);

async function loadFonts() {
  const stylesheet = $<HTMLLinkElement>('specimen-fonts');
  if (!stylesheet.sheet) {
    await new Promise<void>(resolve => {
      const timeout = window.setTimeout(resolve, 15000);
      const finish = () => { clearTimeout(timeout); resolve(); };
      stylesheet.addEventListener('load', finish, { once: true });
      stylesheet.addEventListener('error', finish, { once: true });
    });
  }
  await Promise.all(fonts.map(async font => {
    try {
      const loaded = await Promise.all([
        document.fonts.load(`16px "${font.name}"`, 'Pocket World'),
        document.fonts.load(`16px "${font.name}"`, 'День Ёё Жж'),
      ]);
      states.set(font.id, loaded.every(faces => faces.length > 0) ? 'ready' : 'error');
    } catch {
      states.set(font.id, 'error');
    }
    updateStatus();
  }));
}
void loadFonts();
