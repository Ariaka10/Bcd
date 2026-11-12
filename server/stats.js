/**
 * Statistiques détaillées d'une année scolaire (1er septembre → 31 août) :
 * prêts par mois, lecteurs, rotation du fonds, livres et thèmes préférés, classes.
 * Aucune donnée nominative d'élève : uniquement des comptes.
 */
import { currentSchoolYear } from './db.js';

const MONTHS = ['sept.', 'oct.', 'nov.', 'déc.', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août'];

/** « 2025-2026 » → bornes de l'année scolaire. */
export function schoolYearBounds(year) {
  const y = Number(String(year ?? '').slice(0, 4)) || Number(currentSchoolYear().slice(0, 4));
  return { year: `${y}-${y + 1}`, start: `${y}-09-01`, end: `${y + 1}-09-01`, first: y };
}

export function detailedStats(db, yearParam) {
  const { year, start, end, first } = schoolYearBounds(yearParam);
  const one = (sql, ...a) => db.prepare(sql).get(...a)?.n ?? 0;
  const IN_YEAR = 'l.loaned_at >= ? AND l.loaned_at < ?';
  const span = [start, end];

  // Années disponibles : celles où il y a eu des prêts, plus l'année en cours.
  const years = new Set([currentSchoolYear()]);
  for (const { d } of db.prepare(`SELECT DISTINCT substr(loaned_at, 1, 7) AS d FROM loans`).all()) {
    const [y, m] = d.split('-').map(Number);
    const sy = m >= 9 ? y : y - 1;
    years.add(`${sy}-${sy + 1}`);
  }

  const perMonth = new Map(db.prepare(`SELECT substr(l.loaned_at, 1, 7) AS m, COUNT(*) AS n FROM loans l
    WHERE ${IN_YEAR} GROUP BY m`).all(...span).map((r) => [r.m, r.n]));
  const months = MONTHS.map((label, i) => {
    const y = i < 4 ? first : first + 1;
    const key = `${y}-${String(((i + 8) % 12) + 1).padStart(2, '0')}`;
    return { key, label, n: perMonth.get(key) ?? 0 };
  });

  const loans = one(`SELECT COUNT(*) AS n FROM loans l WHERE ${IN_YEAR}`, ...span);
  const students = one(`SELECT COUNT(*) AS n FROM users WHERE role = 'eleve' AND active = 1`);
  const readers = one(`SELECT COUNT(DISTINCT l.user_id) AS n FROM loans l JOIN users u ON u.id = l.user_id
    WHERE u.role = 'eleve' AND ${IN_YEAR}`, ...span);
  const documents = one(`SELECT COUNT(*) AS n FROM documents WHERE created_at < ?`, end);
  const borrowedDocs = one(`SELECT COUNT(DISTINCT l.document_id) AS n FROM loans l WHERE ${IN_YEAR}`, ...span);

  return {
    year,
    years: [...years].sort().reverse(),
    months,
    totals: {
      loans,
      class_loans: one(`SELECT COUNT(*) AS n FROM loans l WHERE l.class_id IS NOT NULL AND ${IN_YEAR}`, ...span),
      returned: one(`SELECT COUNT(*) AS n FROM loans l WHERE l.returned_at IS NOT NULL AND ${IN_YEAR}`, ...span),
      returned_late: one(`SELECT COUNT(*) AS n FROM loans l WHERE l.returned_at IS NOT NULL
        AND substr(l.returned_at, 1, 10) > l.due_at AND ${IN_YEAR}`, ...span),
      lost: one(`SELECT COUNT(*) AS n FROM loans l WHERE l.lost = 1 AND ${IN_YEAR}`, ...span),
      students,
      readers,
      documents,
      borrowed_docs: borrowedDocs,
      never_borrowed: one(`SELECT COUNT(*) AS n FROM documents d WHERE d.created_at < ?
        AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.document_id = d.id)`, end),
      added: one(`SELECT COUNT(*) AS n FROM documents WHERE created_at >= ? AND created_at < ?`, ...span),
    },
    top_documents: db.prepare(`SELECT d.id, d.title, d.cote, COUNT(*) AS n FROM loans l JOIN documents d ON d.id = l.document_id
      WHERE ${IN_YEAR} GROUP BY d.id ORDER BY n DESC, d.title LIMIT 10`).all(...span),
    top_themes: db.prepare(`SELECT t.name, t.emoji, COUNT(*) AS n FROM loans l
      JOIN document_themes dt ON dt.document_id = l.document_id JOIN themes t ON t.id = dt.theme_id
      WHERE ${IN_YEAR} GROUP BY t.id ORDER BY n DESC, t.name LIMIT 8`).all(...span),
    by_type: db.prepare(`SELECT d.doc_type, COUNT(*) AS n FROM loans l JOIN documents d ON d.id = l.document_id
      WHERE ${IN_YEAR} GROUP BY d.doc_type ORDER BY n DESC`).all(...span),
    // Classe actuelle de l'élève (ou classe emprunteuse pour un prêt à la classe).
    by_class: db.prepare(`SELECT c.id, c.name,
        (SELECT COUNT(*) FROM loans l LEFT JOIN users u ON u.id = l.user_id
          WHERE coalesce(l.class_id, u.class_id) = c.id AND ${IN_YEAR}) AS loans,
        (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND u.role = 'eleve' AND u.active = 1) AS students,
        (SELECT COUNT(DISTINCT l.user_id) FROM loans l JOIN users u ON u.id = l.user_id
          WHERE u.class_id = c.id AND u.role = 'eleve' AND ${IN_YEAR}) AS readers
      FROM classes c ORDER BY c.name`).all(...span, ...span),
  };
}
