import { HttpError, localDate, addDays, daysBetween, nowIso } from '../util.js';
import { getSettings, tx } from '../db.js';
import { staff, anyUser } from '../guards.js';
import { toIsbn13 } from '../isbn.js';
import { toCsv } from '../csv.js';

const LOAN_SELECT = `
  SELECT l.id, l.copy_id, l.document_id, l.user_id, l.loaned_at, l.due_at, l.returned_at, l.renewals, l.lost,
    coalesce(d.title, l.doc_title) AS title, d.authors, d.cote, d.cover_url, c.barcode,
    u.first_name, u.last_name, u.avatar, u.role, cl.id AS class_id, cl.name AS class_name
  FROM loans l
  LEFT JOIN copies c ON c.id = l.copy_id
  LEFT JOIN documents d ON d.id = l.document_id
  JOIN users u ON u.id = l.user_id
  LEFT JOIN classes cl ON cl.id = u.class_id`;

function decorate(loans) {
  const today = localDate();
  for (const l of loans) {
    l.days_late = !l.returned_at ? Math.max(0, daysBetween(l.due_at, today)) : 0;
    l.overdue = l.days_late > 0;
  }
  return loans;
}

/** Résout un code lu à la douchette : code-barres d'exemplaire, ou ISBN (premier exemplaire libre). */
function findCopy(db, code, { forLoan }) {
  code = String(code ?? '').trim();
  if (!code) throw new HttpError(400, 'Code-barres manquant');
  const copy = db.prepare('SELECT * FROM copies WHERE barcode = ? COLLATE NOCASE').get(code);
  if (copy) return copy;
  const isbn = toIsbn13(code);
  if (isbn) {
    const onLoan = 'EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = c.id AND l.returned_at IS NULL)';
    const found = db.prepare(`SELECT c.* FROM copies c JOIN documents d ON d.id = c.document_id
      WHERE d.isbn = ? AND ${forLoan ? `NOT ${onLoan} AND c.state IN ('ok', 'abime')` : onLoan}
      ORDER BY c.id LIMIT 1`).get(isbn);
    if (found) return found;
    if (db.prepare('SELECT 1 FROM documents WHERE isbn = ?').get(isbn)) {
      throw new HttpError(409, forLoan ? 'Aucun exemplaire disponible pour ce titre' : 'Aucun exemplaire de ce titre n\'est en prêt');
    }
  }
  throw new HttpError(404, `Code inconnu : ${code}`);
}

export function createLoan(db, { user_id, barcode, copy_id, loaned_by, force }) {
  return tx(db, () => {
    const s = getSettings(db);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
    if (!user) throw new HttpError(404, 'Usager introuvable');
    if (!user.active) throw new HttpError(409, 'Compte désactivé');

    const copy = copy_id ? db.prepare('SELECT * FROM copies WHERE id = ?').get(copy_id) : findCopy(db, barcode, { forLoan: true });
    if (!copy) throw new HttpError(404, 'Exemplaire introuvable');
    if (!['ok', 'abime'].includes(copy.state)) throw new HttpError(409, 'Cet exemplaire n\'est pas empruntable (perdu ou en réparation)');
    const current = db.prepare('SELECT user_id FROM loans WHERE copy_id = ? AND returned_at IS NULL').get(copy.id);
    if (current) {
      throw new HttpError(409, current.user_id === user.id ? 'Déjà emprunté par cet usager' : 'Exemplaire déjà en prêt : enregistrez d\'abord le retour');
    }

    const today = localDate();
    if (!force) {
      const active = db.prepare('SELECT due_at FROM loans WHERE user_id = ? AND returned_at IS NULL').all(user.id);
      const max = Number(s[`max_loans_${user.role}`] ?? 2);
      if (active.length >= max) throw new HttpError(409, `Limite atteinte : ${max} prêt(s) maximum`);
      if (s.block_if_overdue === '1' && active.some((l) => l.due_at < today)) {
        throw new HttpError(409, 'Cet usager a un retard : il doit d\'abord rendre son livre');
      }
    }

    const doc = db.prepare('SELECT id, title FROM documents WHERE id = ?').get(copy.document_id);
    const due = addDays(today, Number(s[`loan_days_${user.role}`] ?? 14));
    const { lastInsertRowid } = db.prepare(`INSERT INTO loans (copy_id, document_id, doc_title, user_id, loaned_at, due_at, loaned_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(copy.id, doc.id, doc.title, user.id, nowIso(), due, loaned_by ?? null);
    return { id: Number(lastInsertRowid), due_at: due, title: doc.title, barcode: copy.barcode };
  });
}

export function returnLoan(db, { barcode, loan_id, lost }) {
  return tx(db, () => {
    let loan;
    if (loan_id) loan = db.prepare('SELECT * FROM loans WHERE id = ? AND returned_at IS NULL').get(loan_id);
    else {
      const copy = findCopy(db, barcode, { forLoan: false });
      loan = db.prepare('SELECT * FROM loans WHERE copy_id = ? AND returned_at IS NULL').get(copy.id);
    }
    if (!loan) throw new HttpError(404, 'Aucun prêt en cours pour cet exemplaire');
    db.prepare('UPDATE loans SET returned_at = ?, lost = ? WHERE id = ?').run(nowIso(), lost ? 1 : 0, loan.id);
    if (lost && loan.copy_id) db.prepare(`UPDATE copies SET state = 'perdu' WHERE id = ?`).run(loan.copy_id);
    const info = db.prepare(`SELECT u.first_name, u.last_name, l.doc_title AS title, l.due_at FROM loans l
      JOIN users u ON u.id = l.user_id WHERE l.id = ?`).get(loan.id);
    return { id: loan.id, ...info, days_late: Math.max(0, daysBetween(loan.due_at, localDate())) };
  });
}

export function listLoans(db, q) {
  const where = [];
  const args = [];
  const today = localDate();
  if (q.status === 'history') where.push('l.returned_at IS NOT NULL');
  else if (q.status !== 'all') where.push('l.returned_at IS NULL');
  if (q.status === 'overdue') { where.push('l.due_at < ?'); args.push(today); }
  if (q.user_id) { where.push('l.user_id = ?'); args.push(Number(q.user_id)); }
  if (q.class_id) { where.push('u.class_id = ?'); args.push(Number(q.class_id)); }
  if (q.document_id) { where.push('l.document_id = ?'); args.push(Number(q.document_id)); }
  const order = q.status === 'history' ? 'l.returned_at DESC' : 'cl.name, u.last_name, u.first_name, l.due_at';
  const limit = Math.min(Number(q.limit) || 500, 5000);
  return decorate(db.prepare(`${LOAN_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${order} LIMIT ?`).all(...args, limit));
}

export default function (r) {
  r.get('/api/loans', staff, ({ db, query }) => listLoans(db, query));

  r.get('/api/loans/overdue.csv', staff, ({ db, query, res }) => {
    const rows = [['Classe', 'Nom', 'Prénom', 'Titre', 'Cote', 'Code-barres', 'Prêté le', 'À rendre le', 'Jours de retard']];
    for (const l of listLoans(db, { ...query, status: 'overdue' })) {
      rows.push([l.class_name, l.last_name, l.first_name, l.title, l.cote, l.barcode, l.loaned_at.slice(0, 10), l.due_at, l.days_late]);
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="retards.csv"' });
    res.end(toCsv(rows));
  });

  r.get('/api/me/loans', anyUser, ({ db, user }) => ({
    current: listLoans(db, { user_id: user.id }),
    history: listLoans(db, { user_id: user.id, status: 'history', limit: 30 }),
  }));

  r.post('/api/loans', staff, ({ db, body, user }) => {
    if (!body.user_id) throw new HttpError(400, 'Choisissez un emprunteur');
    return createLoan(db, { ...body, loaned_by: user.id, force: body.force && user.role === 'admin' });
  });

  r.post('/api/loans/return', staff, ({ db, body }) => returnLoan(db, body));

  r.post('/api/loans/:id/renew', staff, ({ db, params }) => {
    const s = getSettings(db);
    const l = db.prepare(`SELECT l.*, u.role FROM loans l JOIN users u ON u.id = l.user_id
      WHERE l.id = ? AND l.returned_at IS NULL`).get(params.id);
    if (!l) throw new HttpError(404, 'Prêt introuvable');
    if (l.renewals >= Number(s.max_renewals ?? 1)) throw new HttpError(409, 'Nombre maximum de prolongations atteint');
    const today = localDate();
    const due = addDays(l.due_at > today ? l.due_at : today, Number(s[`loan_days_${l.role}`] ?? 14));
    db.prepare('UPDATE loans SET due_at = ?, renewals = renewals + 1 WHERE id = ?').run(due, l.id);
    return { due_at: due };
  });
}
