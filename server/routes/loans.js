import { HttpError, localDate, addDays, daysBetween, nowIso, normalize } from '../util.js';
import { getSettings, tx } from '../db.js';
import { staff, anyUser } from '../guards.js';
import { toIsbn13 } from '../isbn.js';
import { toCsv } from '../csv.js';

// Un prêt « classe » (l.class_id) est présenté comme un emprunteur « 📦 Classe X ».
const LOAN_SELECT = `
  SELECT l.id, l.copy_id, l.document_id, l.user_id, l.loaned_at, l.due_at, l.returned_at, l.renewals, l.lost,
    coalesce(d.title || coalesce(' — ' || c.issue_label, ''), l.doc_title) AS title, d.authors, d.cote, d.cover_url, c.barcode,
    l.class_id AS loan_class_id, l.class_id IS NOT NULL AS is_class_loan,
    CASE WHEN l.class_id IS NOT NULL THEN 'Classe' ELSE u.first_name END AS first_name,
    CASE WHEN l.class_id IS NOT NULL THEN cl.name ELSE u.last_name END AS last_name,
    CASE WHEN l.class_id IS NOT NULL THEN '📦' ELSE u.avatar END AS avatar,
    CASE WHEN l.class_id IS NOT NULL THEN 'classe' ELSE u.role END AS role,
    CASE WHEN l.class_id IS NOT NULL THEN 1 ELSE u.active END AS user_active,
    cl.id AS class_id, cl.name AS class_name
  FROM loans l
  LEFT JOIN copies c ON c.id = l.copy_id
  LEFT JOIN documents d ON d.id = l.document_id
  LEFT JOIN users u ON u.id = l.user_id
  LEFT JOIN classes cl ON cl.id = coalesce(l.class_id, u.class_id)`;

const ON_LOAN = 'EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = c.id AND l.returned_at IS NULL)';

function decorate(loans) {
  const today = localDate();
  for (const l of loans) {
    l.days_late = !l.returned_at ? Math.max(0, daysBetween(l.due_at, today)) : 0;
    l.overdue = l.days_late > 0;
    l.is_class_loan = Boolean(l.is_class_loan);
    l.user_active = Boolean(l.user_active); // false : élève parti (archivé) qui a encore le livre
  }
  return loans;
}

/** Retrouve un exemplaire d'après son numéro, ou d'après l'ISBN du livre (premier exemplaire libre). */
function findCopy(db, code, { forLoan }) {
  code = String(code ?? '').trim();
  if (!code) throw new HttpError(400, 'Numéro du livre manquant');
  if (/^0+\d+$/.test(code)) code = String(Number(code)); // « 012 » = « 12 »
  const copy = db.prepare('SELECT * FROM copies WHERE barcode = ? COLLATE NOCASE').get(code);
  if (copy) return copy;
  const isbn = toIsbn13(code);
  if (isbn) {
    const found = db.prepare(`SELECT c.* FROM copies c JOIN documents d ON d.id = c.document_id
      WHERE d.isbn = ? AND ${forLoan ? `NOT ${ON_LOAN} AND c.state IN ('ok', 'abime')` : ON_LOAN}
      ORDER BY c.id LIMIT 1`).get(isbn);
    if (found) return found;
    if (db.prepare('SELECT 1 FROM documents WHERE isbn = ?').get(isbn)) {
      throw new HttpError(409, forLoan ? 'Aucun exemplaire disponible pour ce titre' : 'Aucun exemplaire de ce titre n\'est en prêt');
    }
  }
  throw new HttpError(404, `Aucun livre n° ${code}`);
}

const userName = (db, id) => {
  const u = db.prepare(`SELECT u.first_name, u.last_name, c.name AS class_name FROM users u
    LEFT JOIN classes c ON c.id = u.class_id WHERE u.id = ?`).get(id);
  return u ? `${u.first_name} ${u.last_name}${u.class_name ? ` (${u.class_name})` : ''}` : '';
};

/**
 * Prêt à un usager (user_id) ou à une classe (class_id).
 * `ignore_reservation` : prêter quand même un livre mis de côté pour quelqu'un d'autre.
 */
export function createLoan(db, { user_id, class_id, barcode, copy_id, loaned_by, force, ignore_reservation }) {
  return tx(db, () => {
    const s = getSettings(db);
    let user = null;
    let cls = null;
    if (class_id) {
      cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(class_id);
      if (!cls) throw new HttpError(404, 'Classe introuvable');
    } else {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
      if (!user) throw new HttpError(404, 'Usager introuvable');
      if (!user.active) throw new HttpError(409, 'Compte désactivé');
      if (user.role === 'catalogueur') throw new HttpError(409, 'Ce compte sert à ajouter des livres : il ne peut pas emprunter');
    }
    const role = cls ? 'classe' : user.role;

    const copy = copy_id ? db.prepare('SELECT * FROM copies WHERE id = ?').get(copy_id) : findCopy(db, barcode, { forLoan: true });
    if (!copy) throw new HttpError(404, 'Exemplaire introuvable');
    if (!['ok', 'abime'].includes(copy.state)) throw new HttpError(409, 'Cet exemplaire n\'est pas empruntable (perdu ou en réparation)');
    const current = db.prepare('SELECT user_id, class_id FROM loans WHERE copy_id = ? AND returned_at IS NULL').get(copy.id);
    if (current) {
      const same = cls ? current.class_id === cls.id : current.user_id === user.id;
      throw new HttpError(409, same ? 'Déjà emprunté par cet emprunteur' : `Le livre n° ${copy.barcode} est déjà en prêt : enregistrez d'abord le retour`);
    }

    // Réservations : un exemplaire mis de côté pour quelqu'un d'autre n'est pas prêté sans confirmation.
    const held = db.prepare(`SELECT id, user_id FROM reservations WHERE document_id = ? AND status = 'prete' ORDER BY ready_at`).all(copy.document_id);
    const mine = user ? held.find((h) => h.user_id === user.id) : null;
    const heldForOthers = held.filter((h) => h !== mine);
    if (heldForOthers.length && !ignore_reservation) {
      const free = db.prepare(`SELECT COUNT(*) AS n FROM copies c WHERE c.document_id = ? AND c.state IN ('ok', 'abime') AND NOT ${ON_LOAN}`)
        .get(copy.document_id).n;
      if (free <= heldForOthers.length) {
        const e = new HttpError(409, `Ce livre est mis de côté pour ${userName(db, heldForOthers[0].user_id)}`);
        e.code = 'reserved';
        throw e;
      }
    }

    const today = localDate();
    if (!force) {
      const active = db.prepare(`SELECT due_at FROM loans WHERE ${cls ? 'class_id' : 'user_id'} = ? AND returned_at IS NULL`)
        .all(cls ? cls.id : user.id);
      const max = Number(s[`max_loans_${role}`] ?? 2);
      if (active.length >= max) throw new HttpError(409, `Limite atteinte : ${max} prêt(s) maximum`);
      if (!cls && s.block_if_overdue === '1' && active.some((l) => l.due_at < today)) {
        throw new HttpError(409, 'Cet usager a un retard : il doit d\'abord rendre son livre');
      }
    }

    const doc = db.prepare('SELECT id, title, cover_url FROM documents WHERE id = ?').get(copy.document_id);
    if (copy.issue_label) doc.title = `${doc.title} — ${copy.issue_label}`; // numéro de périodique
    const due = addDays(today, Number(s[`loan_days_${role}`] ?? 14));
    const { lastInsertRowid } = db.prepare(`INSERT INTO loans (copy_id, document_id, doc_title, user_id, class_id, loaned_at, due_at, loaned_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(copy.id, doc.id, doc.title, user?.id ?? null, cls?.id ?? null, nowIso(), due, loaned_by ?? null);

    // La réservation de cet emprunteur est satisfaite.
    if (user) {
      db.prepare(`UPDATE reservations SET status = 'terminee' WHERE document_id = ? AND user_id = ? AND status IN ('attente', 'prete')`)
        .run(doc.id, user.id);
    }
    if (ignore_reservation && heldForOthers.length) {
      // Le livre mis de côté est parti : la réservation repasse en attente.
      db.prepare(`UPDATE reservations SET status = 'attente', ready_at = NULL WHERE id = ?`).run(heldForOthers[heldForOthers.length - 1].id);
    }
    return { id: Number(lastInsertRowid), due_at: due, title: doc.title, barcode: copy.barcode, cover_url: doc.cover_url };
  });
}

/** Si quelqu'un attend ce livre, l'exemplaire rendu lui est mis de côté. */
function holdForNext(db, documentId) {
  const next = db.prepare(`SELECT id, user_id FROM reservations WHERE document_id = ? AND status = 'attente'
    ORDER BY created_at, id LIMIT 1`).get(documentId);
  if (!next) return null;
  db.prepare(`UPDATE reservations SET status = 'prete', ready_at = ? WHERE id = ?`).run(nowIso(), next.id);
  return userName(db, next.user_id);
}

export function returnLoan(db, { barcode, loan_id, lost }) {
  return tx(db, () => {
    let loan;
    if (loan_id) loan = db.prepare('SELECT * FROM loans WHERE id = ? AND returned_at IS NULL').get(loan_id);
    else {
      const copy = findCopy(db, barcode, { forLoan: false });
      loan = db.prepare('SELECT * FROM loans WHERE copy_id = ? AND returned_at IS NULL').get(copy.id);
    }
    if (!loan) throw new HttpError(404, 'Aucun prêt en cours pour ce livre');
    db.prepare('UPDATE loans SET returned_at = ?, lost = ? WHERE id = ?').run(nowIso(), lost ? 1 : 0, loan.id);
    if (lost && loan.copy_id) db.prepare(`UPDATE copies SET state = 'perdu' WHERE id = ?`).run(loan.copy_id);
    const info = decorate([db.prepare(`${LOAN_SELECT} WHERE l.id = ?`).get(loan.id)])[0];
    const reserved_for = !lost && loan.document_id ? holdForNext(db, loan.document_id) : null;
    return {
      id: loan.id, title: info.title, barcode: info.barcode, first_name: info.first_name, last_name: info.last_name,
      cover_url: info.cover_url, avatar: info.avatar, user_id: loan.user_id, class_id: loan.class_id,
      due_at: loan.due_at, days_late: Math.max(0, daysBetween(loan.due_at, localDate())), reserved_for,
    };
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
  if (q.class_id) { where.push('coalesce(l.class_id, u.class_id) = ?'); args.push(Number(q.class_id)); }
  if (q.class_loans === '1') where.push('l.class_id IS NOT NULL');
  if (q.departed === '1') where.push('l.user_id IS NOT NULL AND u.active = 0'); // élèves partis avec un livre
  if (q.loan_class_id) { where.push('l.class_id = ?'); args.push(Number(q.loan_class_id)); }
  if (q.document_id) { where.push('l.document_id = ?'); args.push(Number(q.document_id)); }
  if (q.q) {
    for (const t of normalize(q.q).split(' ').filter(Boolean)) {
      where.push(`(c.barcode = ? OR norm(coalesce(d.title, l.doc_title) || ' ' || coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')
        || ' ' || coalesce(cl.name, '')) LIKE ?)`);
      args.push(t, `%${t}%`);
    }
  }
  const order = q.status === 'history' ? 'l.returned_at DESC' : 'cl.name, l.class_id IS NULL, u.last_name, u.first_name, l.due_at';
  const limit = Math.min(Number(q.limit) || 500, 5000);
  return decorate(db.prepare(`${LOAN_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${order} LIMIT ?`).all(...args, limit));
}

export function listReservations(db, { user_id, document_id } = {}) {
  const where = [`rv.status IN ('attente', 'prete')`];
  const args = [];
  if (user_id) { where.push('rv.user_id = ?'); args.push(Number(user_id)); }
  if (document_id) { where.push('rv.document_id = ?'); args.push(Number(document_id)); }
  return db.prepare(`SELECT rv.id, rv.status, rv.created_at, rv.ready_at, rv.document_id, rv.user_id,
      d.title, d.cote, d.cover_url, u.first_name, u.last_name, u.avatar, c.name AS class_name
    FROM reservations rv JOIN documents d ON d.id = rv.document_id JOIN users u ON u.id = rv.user_id
    LEFT JOIN classes c ON c.id = u.class_id
    WHERE ${where.join(' AND ')} ORDER BY rv.status = 'prete' DESC, rv.created_at`).all(...args);
}

export function createReservation(db, { document_id, user_id, created_by }) {
  return tx(db, () => {
    const doc = db.prepare('SELECT id, title FROM documents WHERE id = ?').get(document_id);
    if (!doc) throw new HttpError(404, 'Document introuvable');
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(user_id)) throw new HttpError(404, 'Usager introuvable');
    if (db.prepare(`SELECT 1 FROM reservations WHERE document_id = ? AND user_id = ? AND status IN ('attente', 'prete')`).get(doc.id, user_id)) {
      throw new HttpError(409, 'Déjà réservé');
    }
    if (db.prepare('SELECT 1 FROM loans WHERE document_id = ? AND user_id = ? AND returned_at IS NULL').get(doc.id, user_id)) {
      throw new HttpError(409, 'Ce livre est déjà emprunté par cet usager');
    }
    const free = db.prepare(`SELECT COUNT(*) AS n FROM copies c WHERE c.document_id = ? AND c.state IN ('ok', 'abime') AND NOT ${ON_LOAN}`).get(doc.id).n;
    const held = db.prepare(`SELECT COUNT(*) AS n FROM reservations WHERE document_id = ? AND status = 'prete'`).get(doc.id).n;
    // Un exemplaire est libre : il est mis de côté tout de suite.
    const status = free > held ? 'prete' : 'attente';
    const { lastInsertRowid } = db.prepare(`INSERT INTO reservations (document_id, user_id, status, ready_at, created_by)
      VALUES (?, ?, ?, ?, ?)`).run(doc.id, user_id, status, status === 'prete' ? nowIso() : null, created_by ?? null);
    return { id: Number(lastInsertRowid), status, title: doc.title };
  });
}

function cancelReservation(db, id) {
  return tx(db, () => {
    const rv = db.prepare(`SELECT * FROM reservations WHERE id = ? AND status IN ('attente', 'prete')`).get(id);
    if (!rv) throw new HttpError(404, 'Réservation introuvable');
    db.prepare(`UPDATE reservations SET status = 'annulee' WHERE id = ?`).run(rv.id);
    const next = rv.status === 'prete' ? holdForNext(db, rv.document_id) : null;
    return { ok: true, reserved_for: next };
  });
}

export default function (r) {
  r.get('/api/loans', staff, ({ db, query }) => listLoans(db, query));

  r.get('/api/loans/overdue.csv', staff, ({ db, query, res }) => {
    const rows = [['Classe', 'Nom', 'Prénom', 'Titre', 'Cote', 'N° du livre', 'Prêté le', 'À rendre le', 'Jours de retard']];
    for (const l of listLoans(db, { ...query, status: 'overdue' })) {
      rows.push([l.class_name, l.last_name, l.first_name, l.title, l.cote, l.barcode, l.loaned_at.slice(0, 10), l.due_at, l.days_late]);
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="retards.csv"' });
    res.end(toCsv(rows));
  });

  /**
   * Comptoir sans douchette : on tape le numéro du livre ou quelques mots du titre.
   * Renvoie les exemplaires correspondants avec leur situation.
   */
  r.get('/api/loans/find-copies', staff, ({ db, query }) => {
    const q = String(query.q ?? '').trim();
    if (!q) return [];
    const select = `SELECT c.id AS copy_id, c.barcode, c.state, d.id AS document_id,
        d.title || coalesce(' — ' || c.issue_label, '') AS title, d.authors, d.cote, d.cover_url,
        ${ON_LOAN} AS on_loan,
        (SELECT u.first_name || ' ' || u.last_name FROM reservations rv JOIN users u ON u.id = rv.user_id
          WHERE rv.document_id = d.id AND rv.status = 'prete' ORDER BY rv.ready_at LIMIT 1) AS held_for
      FROM copies c JOIN documents d ON d.id = c.document_id`;
    const exact = db.prepare(`${select} WHERE c.barcode = ? COLLATE NOCASE`).all(/^0+\d+$/.test(q) ? String(Number(q)) : q);
    const words = normalize(q).split(' ').filter(Boolean);
    const byTitle = db.prepare(`${select} WHERE ${words.map(() => `norm(d.title || ' ' || coalesce(d.subtitle, '') || ' '
        || coalesce(d.authors, '') || ' ' || coalesce(d.series, '')) LIKE ?`).join(' AND ')}
      ORDER BY on_loan, norm(d.title), CAST(c.barcode AS INTEGER) LIMIT 30`).all(...words.map((w) => `%${w}%`));
    const seen = new Set();
    return [...exact, ...byTitle].filter((c) => !seen.has(c.copy_id) && seen.add(c.copy_id))
      .map((c) => ({ ...c, on_loan: Boolean(c.on_loan) }));
  });

  r.get('/api/me/loans', anyUser, ({ db, user }) => ({
    current: listLoans(db, { user_id: user.id }),
    history: listLoans(db, { user_id: user.id, status: 'history', limit: 30 }),
    reservations: listReservations(db, { user_id: user.id }),
    reviews: Object.fromEntries(db.prepare('SELECT document_id, rating FROM reviews WHERE user_id = ?').all(user.id)
      .map((x) => [x.document_id, x.rating])),
  }));

  r.post('/api/loans', staff, ({ db, body, user }) => {
    if (!body.user_id && !body.class_id) throw new HttpError(400, 'Choisissez un emprunteur');
    // Erreur de code « reserved » : l'interface propose alors « Prêter quand même ».
    return createLoan(db, { ...body, loaned_by: user.id, force: body.force && user.role === 'admin' });
  });

  r.post('/api/loans/return', staff, ({ db, body }) => returnLoan(db, body));

  r.post('/api/loans/:id/renew', staff, ({ db, params }) => {
    const s = getSettings(db);
    const l = db.prepare(`SELECT l.*, CASE WHEN l.class_id IS NOT NULL THEN 'classe' ELSE u.role END AS role
      FROM loans l LEFT JOIN users u ON u.id = l.user_id WHERE l.id = ? AND l.returned_at IS NULL`).get(params.id);
    if (!l) throw new HttpError(404, 'Prêt introuvable');
    if (l.renewals >= Number(s.max_renewals ?? 1)) throw new HttpError(409, 'Nombre maximum de prolongations atteint');
    if (db.prepare(`SELECT 1 FROM reservations WHERE document_id = ? AND status = 'attente'`).get(l.document_id)) {
      throw new HttpError(409, 'Impossible de prolonger : quelqu\'un a réservé ce livre');
    }
    const today = localDate();
    const due = addDays(l.due_at > today ? l.due_at : today, Number(s[`loan_days_${l.role}`] ?? 14));
    db.prepare('UPDATE loans SET due_at = ?, renewals = renewals + 1 WHERE id = ?').run(due, l.id);
    return { due_at: due };
  });

  // Fin d'année : fixer une même date de retour pour tous les prêts en cours (ou ceux d'une classe).
  r.post('/api/loans/due-date', staff, ({ db, body }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.due_at ?? '')) throw new HttpError(400, 'Date invalide');
    const ids = listLoans(db, { class_id: body.class_id, limit: 5000 }).map((l) => l.id);
    const upd = db.prepare('UPDATE loans SET due_at = ? WHERE id = ?');
    tx(db, () => { for (const id of ids) upd.run(body.due_at, id); });
    return { updated: ids.length };
  });

  // Réservations
  r.get('/api/reservations', staff, ({ db, query }) => listReservations(db, query));

  r.post('/api/reservations', staff, ({ db, body, user }) => createReservation(db, { ...body, created_by: user.id }));

  r.delete('/api/reservations/:id', anyUser, ({ db, params, user }) => {
    if (user.role === 'eleve') {
      const rv = db.prepare('SELECT user_id FROM reservations WHERE id = ?').get(params.id);
      if (rv?.user_id !== user.id) throw new HttpError(403, 'Accès réservé');
    }
    return cancelReservation(db, params.id);
  });

  // Un élève peut réserver lui-même un livre (« Je le veux ! »).
  r.post('/api/me/reservations', anyUser, ({ db, body, user }) =>
    createReservation(db, { document_id: body.document_id, user_id: user.id, created_by: user.id }));
}
