import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toIsbn13, isValidEan13 } from '../server/isbn.js';
import { computeCote, guessDewey, firstAuthorSurname } from '../server/cote.js';
import { parseStudentList, parseCsv } from '../server/csv.js';
import { parseUnimarc, unimarcToNotice } from '../server/notice.js';
import { guessType } from '../server/routes/documents.js';

test('ISBN-10 → ISBN-13 et contrôle EAN', () => {
  assert.equal(toIsbn13('2-07-061275-X'), null); // clé fausse
  assert.equal(toIsbn13('2070612759'), '9782070612758');
  assert.equal(toIsbn13('978-2-07-061275-8'), '9782070612758');
  assert.ok(isValidEan13('9782070612758'));
  assert.equal(toIsbn13('9782070612759'), null);
});

test('calcul des cotes', () => {
  assert.equal(computeCote({ doc_type: 'roman', authors: 'Dahl, Roald', title: 'Matilda' }), 'R DAH');
  assert.equal(computeCote({ doc_type: 'album', authors: 'Ramos, Mario', title: 'C\'est moi le plus fort' }), 'A RAM');
  assert.equal(computeCote({ doc_type: 'album', authors: '', title: 'Les trois petits cochons' }), 'A TRO');
  assert.equal(computeCote({ doc_type: 'documentaire', dewey: '599.75', authors: 'Ledu, Stéphanie' }), '599 LED');
  assert.equal(computeCote({ doc_type: 'documentaire', subjects: 'Dinosaures -- Ouvrages pour la jeunesse', authors: 'Émile Zébu' }), '567 ZEB');
  assert.equal(computeCote({ doc_type: 'bd', series: 'Astérix', authors: 'Goscinny, René' }), 'BD AST');
  assert.equal(computeCote({ doc_type: 'periodique', title: 'Wapiti' }), 'PER WAP');
  assert.equal(firstAuthorSurname('Roald Dahl'), 'Dahl');
  assert.equal(guessDewey({ title: 'Mon entraînement' }), null);
  assert.equal(guessDewey({ subjects: 'Trains' }), '625');
});

test('import ONDE (CSV « ; », en-têtes officiels)', () => {
  const csv = [
    "Nom élève;Nom d'usage élève;Prénom élève;Date naissance;Sexe;Niveau;Classe",
    'MARTIN;;léa;03/09/2016;F;CE2;CE2 Mme Durand',
    'DUPONT;DUPONT-LEROY;jean-baptiste;12/01/2015;M;CM1;CM1-CM2',
    ';;;;;;',
  ].join('\r\n');
  const { students, errors } = parseStudentList(csv);
  assert.deepEqual(errors, []);
  assert.equal(students.length, 2);
  assert.deepEqual(students[0], {
    line: 2, last_name: 'MARTIN', first_name: 'Léa', birth_date: '2016-09-03',
    class_name: 'CE2 Mme Durand', level: 'CE2', sex: 'F', ine: null,
  });
  assert.equal(students[1].last_name, 'DUPONT-LEROY');
  assert.equal(students[1].first_name, 'Jean-Baptiste');
});

test('CSV simple, virgules et guillemets', () => {
  assert.deepEqual(parseCsv('a,"b, c",d\n1,"x ""y""",3'), [['a', 'b, c', 'd'], ['1', 'x "y"', '3']]);
  const { students, errors } = parseStudentList('Nom,Prénom\nBERNARD,Tom', { defaultClass: 'CP' });
  assert.deepEqual(errors, []);
  assert.equal(students[0].class_name, 'CP');
});

test('analyse UNIMARC (format BnF)', () => {
  const xml = `<mxc:record>
    <mxc:datafield tag="010" ind1=" " ind2=" "><mxc:subfield code="a">978-2-07-061275-8</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="200" ind1="1" ind2=" "><mxc:subfield code="a">Matilda</mxc:subfield><mxc:subfield code="f">Roald Dahl</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="214" ind1=" " ind2="0"><mxc:subfield code="c">Gallimard jeunesse</mxc:subfield><mxc:subfield code="d">DL 2016</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="215" ind1=" " ind2=" "><mxc:subfield code="a">1 vol. (264 p.)</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="225" ind1=" " ind2=" "><mxc:subfield code="a">Folio junior</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="330" ind1=" " ind2=" "><mxc:subfield code="a">Matilda est une petite fille &amp; surdouée.</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="700" ind1=" " ind2="|"><mxc:subfield code="a">Dahl</mxc:subfield><mxc:subfield code="b">Roald</mxc:subfield></mxc:datafield>
    <mxc:datafield tag="702" ind1=" " ind2="|"><mxc:subfield code="a">Blake</mxc:subfield><mxc:subfield code="b">Quentin</mxc:subfield></mxc:datafield>
  </mxc:record>`;
  const n = unimarcToNotice(parseUnimarc(xml));
  assert.equal(n.title, 'Matilda');
  assert.equal(n.authors, 'Dahl, Roald ; Blake, Quentin');
  assert.equal(n.publisher, 'Gallimard jeunesse');
  assert.equal(n.pub_year, 2016);
  assert.equal(n.pages, 264);
  assert.equal(n.series, 'Folio junior');
  assert.equal(n.summary, 'Matilda est une petite fille & surdouée');
  assert.equal(guessType({ ...n, subjects: 'Roman' }), 'roman');
  assert.equal(guessType({ title: 'Les volcans', dewey: '551.21' }), 'documentaire');
});
