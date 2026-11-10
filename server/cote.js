/**
 * Calcul automatique des cotes, selon les usages courants en BCD :
 *  - fictions : préfixe du genre + 3 premières lettres du nom de l'auteur (ex. « R DAH »)
 *  - documentaires : indice Dewey simplifié + 3 lettres de l'auteur (ex. « 590 LEB »)
 */
import { normalize } from './util.js';

export const DOC_TYPES = {
  album: { label: 'Album', prefix: 'A' },
  premiere_lecture: { label: 'Première lecture', prefix: 'PL' },
  roman: { label: 'Roman', prefix: 'R' },
  bd: { label: 'Bande dessinée', prefix: 'BD' },
  manga: { label: 'Manga', prefix: 'M' },
  conte: { label: 'Conte', prefix: 'C' },
  poesie: { label: 'Poésie', prefix: 'P' },
  theatre: { label: 'Théâtre', prefix: 'T' },
  documentaire: { label: 'Documentaire', prefix: null },
  reference: { label: 'Dictionnaire / encyclopédie', prefix: 'REF' },
  periodique: { label: 'Périodique', prefix: 'PER' },
  multimedia: { label: 'Multimédia (CD, DVD…)', prefix: 'MM' },
  jeu: { label: 'Jeu', prefix: 'JEU' },
  autre: { label: 'Autre', prefix: 'DIV' },
};

/** Grandes classes Dewey, adaptées au primaire. */
export const DEWEY_CLASSES = {
  '000': 'Généralités, informatique',
  '100': 'Philosophie, psychologie, émotions',
  '200': 'Religions, mythologies',
  '300': 'Société, citoyenneté, école',
  '400': 'Langues',
  '500': 'Sciences de la nature',
  '600': 'Techniques, corps humain, cuisine',
  '700': 'Arts, loisirs, sports',
  '800': 'Littérature',
  '900': 'Histoire, géographie, biographies',
};

// Du plus précis au plus général : la première règle trouvée gagne.
const DEWEY_KEYWORDS = [
  ['dinosaure', '567'], ['prehistoire', '930'],
  ['ordinateur', '004'], ['informatique', '004'], ['internet', '004'], ['robot', '629'],
  ['encyclopedie', '030'], ['dictionnaire', '030'],
  ['emotion', '152'], ['sentiment', '152'], ['philosoph', '100'],
  ['mythologie', '292'], ['religion', '200'], ['bible', '220'],
  ['citoyen', '323'], ['droits de l', '323'], ['politique', '320'], ['argent', '332'],
  ['metier', '331'], ['ecole', '370'], ['fete', '394'], ['conte ', '398'], ['contes', '398'],
  ['anglais', '420'], ['grammaire', '440'], ['orthographe', '440'], ['langue francaise', '440'],
  ['mathemat', '510'], ['astronom', '520'], ['espace', '520'], ['planete', '520'], ['etoile', '520'],
  ['saison', '508'], ['nature', '508'], ['physique', '530'], ['energie', '530'], ['electricite', '530'], ['chimie', '540'],
  ['volcan', '551'], ['meteo', '551'], ['climat', '551'], ['ocean', '551'], ['geologie', '550'],
  ['ecologie', '577'], ['environnement', '577'], ['plante', '580'], ['arbre', '580'], ['fleur', '580'],
  ['insecte', '595'], ['poisson', '597'], ['oiseau', '598'], ['mammifere', '599'], ['animau', '590'], ['animal', '590'],
  ['corps humain', '612'], ['sante', '613'], ['alimentation', '613'],
  ['agriculture', '630'], ['jardin', '635'], ['cuisine', '641'], ['recette', '641'],
  ['transport', '629'], ['voiture', '629'], ['avion', '629'], ['train', '625'], ['bateau', '623'],
  ['invention', '600'], ['technique', '600'], ['construction', '690'],
  ['architecture', '720'], ['sculpture', '730'], ['dessin', '741'], ['peinture', '750'],
  ['photograph', '770'], ['musique', '780'], ['cinema', '791'], ['jeu ', '793'], ['jeux', '793'],
  ['football', '796'], ['sport', '796'],
  ['poesie', '841'], ['theatre', '842'], ['litterature', '800'],
  ['atlas', '912'], ['biographie', '920'], ['antiquite', '930'], ['egypte', '932'],
  ['moyen age', '940'], ['guerre mondiale', '940'], ['histoire de france', '944'],
  ['afrique', '960'], ['amerique', '970'], ['asie', '950'],
  ['geographie', '910'], ['voyage', '910'], ['pays', '910'], ['histoire', '900'],
];

const ARTICLES = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'the', 'a', 'an']);

function letters3(s) {
  const k = normalize(s).replace(/[^a-z]/g, '').toUpperCase();
  return k.slice(0, 3);
}

/** Nom de famille du premier auteur. Format attendu : « Nom, Prénom ; Nom2, Prénom2 ». */
export function firstAuthorSurname(authors) {
  const first = String(authors ?? '').split(';')[0].trim();
  if (!first) return '';
  if (first.includes(',')) return first.split(',')[0].trim();
  const words = first.split(/\s+/);
  return words[words.length - 1];
}

/** Premier mot significatif du titre (articles ignorés). */
export function titleKeyword(title) {
  const words = normalize(title).replace(/['’]/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
  return words.find((w) => !ARTICLES.has(w)) ?? words[0] ?? '';
}

export function guessDewey(doc) {
  // Les mots-clés sont cherchés en début de mot (« train » ne doit pas trouver « entraînement »).
  const text = ' ' + normalize([doc.subjects, doc.title, doc.subtitle, doc.series].filter(Boolean).join(' '))
    .replace(/[^a-z0-9]+/g, ' ') + ' ';
  for (const [kw, dewey] of DEWEY_KEYWORDS) if (text.includes(' ' + kw)) return dewey;
  return null;
}

/** Indice Dewey ramené à 3 chiffres (« 599.75 » → « 599 »). */
export function shortDewey(dewey) {
  const m = String(dewey ?? '').match(/\d{1,3}/);
  return m ? m[0].padEnd(3, '0') : null;
}

export function computeCote(doc) {
  const type = DOC_TYPES[doc.doc_type] ? doc.doc_type : 'autre';
  const authorKey = letters3(firstAuthorSurname(doc.authors));
  const titleKey = letters3(titleKeyword(doc.title));
  const seriesKey = doc.series ? letters3(titleKeyword(doc.series)) : '';

  let prefix;
  let key = authorKey || titleKey;
  if (type === 'documentaire') {
    prefix = shortDewey(doc.dewey) ?? guessDewey(doc) ?? 'DOC';
  } else {
    prefix = DOC_TYPES[type].prefix;
    if (type === 'periodique' || type === 'reference') key = titleKey || authorKey;
    if (type === 'bd' || type === 'manga') key = seriesKey || authorKey || titleKey;
  }
  return [prefix, key].filter(Boolean).join(' ');
}
