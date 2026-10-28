import { getLocales } from 'expo-localization';
import { Platform, ViewStyle } from 'react-native';

export type Plat = 'twitch' | 'youtube' | 'kick';
/** `prep` é só a preposição ("da"); `in` já vem com o nome: "na Twitch", como em "Assistir na Twitch". */
export const PLAT: Record<Plat, { label: string; letter: string; color: string; ink: string; app: string; prep: string; in: string }> = {
  twitch: { label: 'Twitch', letter: 'T', color: '#7c3aed', ink: '#fff', app: 'app da Twitch', prep: 'da', in: 'na Twitch' },
  youtube: { label: 'YouTube', letter: 'Y', color: '#e11d2a', ink: '#fff', app: 'app do YouTube', prep: 'do', in: 'no YouTube' },
  kick: { label: 'Kick', letter: 'K', color: '#53fc18', ink: '#0b0b0b', app: 'app da Kick', prep: 'da', in: 'na Kick' },
};
export const PLATS = Object.keys(PLAT) as Plat[];

/** código ISO → [nome na própria língua, nome em português] */
const LANG_TABLE: [string, string, string][] = [
  ['pt', 'Português', 'Português'], ['en', 'English', 'Inglês'], ['es', 'Español', 'Espanhol'], ['fr', 'Français', 'Francês'],
  ['de', 'Deutsch', 'Alemão'], ['it', 'Italiano', 'Italiano'], ['ja', '日本語', 'Japonês'], ['ko', '한국어', 'Coreano'],
  ['zh', '中文', 'Chinês'], ['ru', 'Русский', 'Russo'], ['ar', 'العربية', 'Árabe'], ['hi', 'हिन्दी', 'Hindi'],
  ['tr', 'Türkçe', 'Turco'], ['pl', 'Polski', 'Polonês'], ['nl', 'Nederlands', 'Holandês'], ['sv', 'Svenska', 'Sueco'],
  ['no', 'Norsk', 'Norueguês'], ['da', 'Dansk', 'Dinamarquês'], ['fi', 'Suomi', 'Finlandês'], ['cs', 'Čeština', 'Tcheco'],
  ['sk', 'Slovenčina', 'Eslovaco'], ['hu', 'Magyar', 'Húngaro'], ['ro', 'Română', 'Romeno'], ['bg', 'Български', 'Búlgaro'],
  ['el', 'Ελληνικά', 'Grego'], ['uk', 'Українська', 'Ucraniano'], ['he', 'עברית', 'Hebraico'], ['th', 'ไทย', 'Tailandês'],
  ['vi', 'Tiếng Việt', 'Vietnamita'], ['id', 'Bahasa Indonesia', 'Indonésio'], ['ms', 'Bahasa Melayu', 'Malaio'], ['tl', 'Filipino', 'Filipino'],
  ['ca', 'Català', 'Catalão'], ['hr', 'Hrvatski', 'Croata'], ['sr', 'Српски', 'Sérvio'], ['sl', 'Slovenščina', 'Esloveno'],
  ['lt', 'Lietuvių', 'Lituano'], ['lv', 'Latviešu', 'Letão'], ['et', 'Eesti', 'Estoniano'], ['fa', 'فارسی', 'Persa'],
  ['bn', 'বাংলা', 'Bengali'], ['ta', 'தமிழ்', 'Tâmil'], ['te', 'తెలుగు', 'Télugo'], ['ur', 'اردو', 'Urdu'],
  ['sw', 'Kiswahili', 'Suaíli'], ['af', 'Afrikaans', 'Africâner'], ['is', 'Íslenska', 'Islandês'], ['ka', 'ქართული', 'Georgiano'],
  ['kk', 'Қазақ тілі', 'Cazaque'], ['az', 'Azərbaycan', 'Azerbaijano'],
];
export const LANGS: Record<string, string> = Object.fromEntries(LANG_TABLE.map(([k, n]) => [k, n]));
const LANGS_PT: Record<string, string> = Object.fromEntries(LANG_TABLE.map(([k, , pt]) => [k, pt]));
const device = (getLocales()[0]?.languageCode ?? 'pt').toLowerCase();
/** Língua do aparelho (se suportada). */
export const LOCAL = LANGS[device] ? device : 'pt';
/** Língua local, inglês, depois as demais. */
export const LANG_ORDER = [LOCAL, ...(LOCAL === 'en' ? [] : ['en']), ...Object.keys(LANGS).filter(k => k !== LOCAL && k !== 'en')];
/** Na primeira vez, só a língua do aparelho vem marcada. */
export const DEFAULT_LANGS = [LOCAL];

/** Mesma chave do worker: junta "Grand Theft Auto V (GTA)" e "Grand Theft Auto V". */
export const catKey = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Busca de língua pelo nome nativo, pelo nome em português ou pelo código. */
export const matchLang = (k: string, q: string) => {
  const f = fold(q.trim());
  return !f || fold(LANGS[k]).includes(f) || fold(LANGS_PT[k]).includes(f) || k === f;
};

export type SkinKey = 'prata' | 'azul' | 'preto';
export interface Skin {
  name: string; dark: boolean;
  frame: string; frameTop: string; frameInk: string; frameMuted: string;
  panel: string; card: string; line: string; ink: string; muted: string;
  lcdBg: string; lcdFlat: string; lcdFg: string; lcdGlow: string;
  btn: string; btnFlat: string; btnInk: string; btnOn: string; btnOnFlat: string; btnOnInk: string;
  bezelRing: string; accent: string; accentInk: string; field: string; eq: string; swOn: string; swOff: string;
  /** vermelho de ação destrutiva sobre o card (mais claro no Preto fosco, para ler bem) */
  danger: string;
}

const radial = (a: string, b: string, stop: number, c: string) => `radial-gradient(circle at 35% 28%, ${a} 0%, ${b} ${stop}%, ${c} 100%)`;

export const SKINS: Record<SkinKey, Skin> = {
  prata: {
    name: 'Cromado prata', dark: false,
    frame: 'linear-gradient(180deg, #f7f8f9 0%, #d6d9de 24%, #f0f1f3 48%, #b3b8c0 74%, #dcdfe3 90%, #c4c8ce 100%)',
    frameTop: '#f7f8f9', frameInk: '#16181d', frameMuted: '#454a53',
    panel: '#eceef1', card: '#ffffff', line: 'rgba(20,24,32,0.10)', ink: '#15171c', muted: '#5a606b',
    lcdBg: 'linear-gradient(180deg, #08120d, #0e1d15)', lcdFlat: '#0b1711', lcdFg: '#62ff9f', lcdGlow: 'rgba(98,255,159,0.7)',
    btn: radial('#ffffff', '#e4e6ea', 40, '#a4a9b1'), btnFlat: '#d9dce1', btnInk: '#16181d',
    btnOn: radial('#e3f6ff', '#8ec5f0', 45, '#3a73b4'), btnOnFlat: '#8ec5f0', btnOnInk: '#06203d',
    bezelRing: '#c6c9cf', accent: '#2f63d6', accentInk: '#ffffff', field: '#f7f8fa', eq: '#12a150', swOn: '#2f63d6', swOff: '#b9bdc4',
    danger: '#d23b3b',
  },
  azul: {
    name: 'Azul metálico', dark: false,
    frame: 'linear-gradient(180deg, #e8f0ff 0%, #a9c2ef 24%, #dae6fc 48%, #7394d4 74%, #b5cbf2 90%, #8eaae0 100%)',
    frameTop: '#e8f0ff', frameInk: '#08142e', frameMuted: '#1d3264',
    panel: '#e3e9f4', card: '#fbfcff', line: 'rgba(16,36,80,0.12)', ink: '#0d172e', muted: '#475775',
    lcdBg: 'linear-gradient(180deg, #03101c, #08192b)', lcdFlat: '#051523', lcdFg: '#6fd6ff', lcdGlow: 'rgba(111,214,255,0.8)',
    btn: radial('#ffffff', '#c8d8f7', 40, '#6283c7'), btnFlat: '#c8d8f7', btnInk: '#08142e',
    btnOn: radial('#fff5dc', '#ffc86e', 45, '#c27812'), btnOnFlat: '#ffc86e', btnOnInk: '#3a2100',
    bezelRing: '#9fb6e4', accent: '#1f4bb0', accentInk: '#ffffff', field: '#f4f7fd', eq: '#1476c8', swOn: '#1f4bb0', swOff: '#aab7cf',
    danger: '#d23b3b',
  },
  preto: {
    name: 'Preto fosco', dark: true,
    frame: 'linear-gradient(180deg, #3a3c41 0%, #242529 32%, #2d2f33 60%, #151618 100%)',
    frameTop: '#3a3c41', frameInk: '#eceef2', frameMuted: '#a6aab3',
    panel: '#131417', card: '#1d1e22', line: 'rgba(255,255,255,0.09)', ink: '#eef0f3', muted: '#9ba1ab',
    lcdBg: 'linear-gradient(180deg, #030603, #081008)', lcdFlat: '#050b05', lcdFg: '#8dff5c', lcdGlow: 'rgba(141,255,92,0.65)',
    btn: radial('#63666c', '#34363a', 45, '#18191b'), btnFlat: '#34363a', btnInk: '#eceef2',
    btnOn: radial('#e4ffd6', '#8dff5c', 45, '#2e8612'), btnOnFlat: '#8dff5c', btnOnInk: '#0b2002',
    bezelRing: '#3a3c41', accent: '#8dff5c', accentInk: '#0b1a05', field: '#232428', eq: '#8dff5c', swOn: '#6fd13f', swOff: '#45474d',
    danger: '#ff6b6b',
  },
};

/** Gradiente CSS como fundo: `backgroundImage` na web, `experimental_backgroundImage` no nativo. */
export const grad = (css: string, flat: string): ViewStyle =>
  Platform.OS === 'web' ? ({ backgroundImage: css } as ViewStyle) : { backgroundColor: flat, experimental_backgroundImage: css };

export const SH = {
  bulb: 'inset 0 2px 1px rgba(255,255,255,0.8), inset 0 -3px 5px rgba(0,0,0,0.25), 0 2px 4px rgba(0,0,0,0.2)',
  pressed: 'inset 0 2px 5px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.6)',
  lcd: 'inset 0 1px 4px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.55)',
  frame: 'inset 0 2px 1px rgba(255,255,255,0.8), inset 0 -3px 6px rgba(0,0,0,0.25), 0 8px 20px rgba(0,0,0,0.18)',
  chrome: 'inset 0 2px 1px rgba(255,255,255,0.7), inset 0 -3px 6px rgba(0,0,0,0.25), 0 3px 8px rgba(0,0,0,0.2)',
  color: 'inset 0 2px 1px rgba(255,255,255,0.35), inset 0 -3px 6px rgba(0,0,0,0.25), 0 3px 8px rgba(0,0,0,0.2)',
  card: (line: string) => `0 0 0 1px ${line}, 0 1px 2px rgba(0,0,0,0.06)`,
  ring: (line: string) => `0 0 0 1px ${line}`,
};

/** Sombra de hover (web) de linhas e cards: no Preto fosco o contorno clareia em vez de escurecer. */
export const hoverShadow = (s: Skin) =>
  s.dark ? '0 0 0 1px rgba(255,255,255,0.22), 0 4px 12px rgba(0,0,0,0.5)' : '0 0 0 1px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.1)';

/** Na web, reserva sem serifa para escritas que a fonte não cobre (cirílico, grego…) e enquanto ela carrega. */
const stack = (f: string) => (Platform.OS === 'web' ? `${f}, system-ui, sans-serif` : f);

export const FONT = {
  400: stack('ChakraPetch_400Regular'),
  600: stack('ChakraPetch_600SemiBold'),
  700: stack('ChakraPetch_700Bold'),
  brand: stack('Michroma_400Regular'),
  lcd: 'DSEG14',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, monospace' })!,
};

export const AMBER = '#ffb347';
/** Fundo do botão "Remover" (texto branco). Texto vermelho sobre o card usa `Skin.danger`. */
export const DANGER = '#d23b3b';

export const fmt = (n: number) =>
  n >= 999_950 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'K' : String(n);
/** Contagem no LCD: o ponto da DSEG14 some na tela ("13.6K" parece "136K"), então nunca tem decimal. */
export const fmtLcd = (n: number) => (n < 10_000 ? String(n) : `${Math.round(n / 1000)}K`);
export const fmtCount = (n: number) =>
  n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '').replace('.', ',') + ' mi' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1).replace('.0', '').replace('.', ',') + ' mil' : String(n);
export const hueOf = (str: string) => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

export const ago = (iso: string) => {
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return 'há poucos minutos';
  const h = Math.floor(mins / 60);
  if (h < 24) return h === 1 ? 'há 1 hora' : `há ${h} horas`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
};
