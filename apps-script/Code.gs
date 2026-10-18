/**
 * MikJain Wedding HQ · Google Apps Script backend
 * ------------------------------------------------
 * Lives inside the "MikJain HQ — data" Google Sheet (Extensions → Apps Script).
 * The website (GitHub Pages) talks to this script; this script reads and writes the sheet.
 * Passwords live only in the sheet's "Access" tab, never in the website code.
 *
 * One-time setup: run `setup` once from the editor, then Deploy → New deployment → Web app
 * (Execute as: Me, Who has access: Anyone). Paste the web app URL into the site's config.js.
 */

const TOKEN_DAYS = 45;
const TZ = 'Asia/Kolkata';
const TABS = ['Tasks', 'Activity', 'Programme', 'Runsheet', 'Dates', 'Docs', 'People', 'Meta', 'Access', 'Guests', 'Rooms', 'Blocks'];
const FORM_TITLE = 'Yash & Anna · Jaisalmer · Guest registration';
const FORM_DESC_EN = 'The big day is just around the corner: Yash & Anna are getting married! (Again.) It would mean the world to them to have you there.\n\n'
  + 'Join us at Fort Rajwada, Jaisalmer, for two days of love, colour and celebration.\n\n'
  + 'Check-in: Saturday 30 Jan 2027, from 11 AM\n'
  + 'Check-out: Monday 1 Feb 2027, 10 AM\n\n'
  + 'This short form helps us get your room, check-in and meals just right. Everyone has their own personal link, so please fill it in just for yourself; it takes about 2 minutes.\n\n'
  + 'With love,\nTeam MikJain';
const FORM_DESC_RU = 'Совсем скоро большой день: Яш и Анна женятся! (Ещё раз.) Для них очень важно, чтобы вы были рядом.\n\n'
  + 'Приглашаем вас в Форт Раджвада, Джайсалмер, на два дня любви, красок и праздника.\n\n'
  + 'Заезд: суббота, 30 января 2027, с 11:00\n'
  + 'Выезд: понедельник, 1 февраля 2027, в 10:00\n\n'
  + 'Эта короткая форма поможет нам подготовить для вас номер, заселение и питание. У каждого гостя своя личная ссылка, поэтому, пожалуйста, заполните форму только за себя; это займёт около 2 минут.\n\n'
  + 'С любовью,\nКоманда MikJain';
const FORM_DESC = FORM_DESC_EN + '\n\n—\n\n' + FORM_DESC_RU;
/** Guests on these Vedding lists get the English-only copy of the form (Sparsh, 14 Oct 26). Everyone else: English + Russian. */
const EN_ONLY_LISTS = ['Sparsh', 'Rajiv & Shalini'];
/** 'both' = English + Russian; 'en' = English only. Set by buildForm_ while a form is being built. */
let FORM_LANG = 'both';
/** Photo ID help (18 Oct 26: passport only for non-Indian citizens; no visa photo). */
function idHelp_() {
  return enRu_('The hotel needs a photo ID for every guest. Non-Indian citizens: passport. Indian citizens: passport, Aadhaar or driving licence. '
    + 'Please send a clear photo by 15 November 2026 (' + idSend_() + ') and bring the original with you.',
    'Фото документа для заселения. Отелю нужен документ с фото для каждого гостя. Для граждан других стран (не Индии): паспорт. Пожалуйста, отправьте чёткое фото до 15 ноября 2026 (' + idSendRu_() + ') и возьмите оригинал с собой.');
}
/** Refreshes the photo-ID help text on a live form in place (no rebuild, so replies and edit links stay intact). */
function refreshIdHelp_(id, lang) {
  if (!id) return;
  try {
    const f = FormApp.openById(id);
    FORM_LANG = lang;
    f.getItems().forEach(function (it) { if (it.getTitle() === Q.id) it.setHelpText(idHelp_()); });
  } catch (e) { Logger.log('ID help: ' + e); } finally { FORM_LANG = 'both'; }
}
function formDesc_() { return FORM_LANG === 'en' ? FORM_DESC_EN : FORM_DESC; }
/* Private values (phone numbers, task notes) live in LOCAL, which is only in the paste file, never in this repo. */
function local_() { return (typeof LOCAL !== 'undefined') ? LOCAL : {}; }
function idWa_() { return local_().id_whatsapp || 'Sparsh'; }
function idEmail_() { return local_().id_email || ''; }
function idSend_() { return 'WhatsApp it to Sparsh on ' + idWa_() + (idEmail_() ? ' or email it to ' + idEmail_() : ''); }
function idSendRu_() { return 'WhatsApp Спаршу: ' + idWa_() + (idEmail_() ? ', или на почту ' + idEmail_() : ''); }
/** English first, Russian underneath (help text). */
function enRu_(en, ru) { if (FORM_LANG === 'en') return en || ''; return en ? en + '\n\n' + ru : ru; }
/** Choice and short-label text: 'English / Русский', or English only on the English form. */
function bi_(en, ru) { return FORM_LANG === 'en' ? en : en + ' / ' + ru; }
function formThanks_() { const en = 'Thank you! We’ve got your details. Please remember to send a photo of your ID by 15 November: ' + idSend_() + '. See you in Jaisalmer! Yash & Anna';
  return FORM_LANG === 'en' ? en : en + '\n\nСпасибо! Мы получили ваши данные. Пожалуйста, не забудьте отправить фото документа до 15 ноября (' + idSendRu_() + '). До встречи в Джайсалмере! Яш и Анна'; }
const Q = {
  name: 'Your name',
  others: 'Who this invitation is for',
  confirm: 'Is this correct?',
  when: 'Are you arriving on Saturday 30 January and leaving on Monday 1 February?',
  code: 'Guest reference',
  idnames: 'Your full name (as on passport / ID)',
  phone: 'Phone / WhatsApp',
  email: 'Email',
  aDate: 'Arriving in Jaisalmer on',
  aMode: 'Arriving by',
  extra: 'Extra nights at Fort Rajwada',
  aTime: 'Arrival time (roughly)',
  aRef: 'Arrival flight or train number',
  dDate: 'Leaving Jaisalmer on',
  dMode: 'Leaving by',
  dTime: 'Departure time (roughly)',
  dRef: 'Departure flight or train number',
  diet: 'Meal preference',
  dietNotes: 'Allergies or other dietary needs',
  id: 'Photo ID for hotel check-in',
  drivers: 'Arriving or leaving on another day?',
  notes: 'Anything else we should know?',
  aWhen: 'When do you plan to arrive in Jaisalmer?',
  dWhen: 'When do you plan to leave Jaisalmer?',
  travel: 'Your travel details so far',
};
const TEXT_TABS = ['Tasks', 'Activity', 'Programme', 'Runsheet', 'Dates', 'Docs', 'People', 'Meta', 'Access', 'Guests', 'Rooms', 'Blocks'];
const TASK_FIELDS = ['area', 'title', 'type', 'waitingOn', 'next', 'due', 'status', 'priority', 'notes'];
const GUEST_EDIT = ['travel_plans', 'sent_at', 'id_status', 'drivers', 'rsvp', 'phone', 'email', 'from_city', 'party_size', 'party_names', 'arrive_date', 'arrive_time', 'arrive_mode', 'arrive_ref', 'pickup',
  'depart_date', 'depart_time', 'depart_mode', 'depart_ref', 'drop', 'extra_nights', 'room_block', 'room', 'room_with', 'diet', 'diet_notes', 'notes'];
const PRIVATE_GUEST = ['phone', 'email'];

/* =========================== web entry points =========================== */

function doGet() {
  return json_({ ok: true, app: 'MikJain HQ', time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const q = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    let res = {};
    switch (q.action) {
      case 'login': {
        const u = login_(q.password);
        res = { token: u.token, data: bundle_(u) };
        break;
      }
      case 'data':
        res = { data: bundle_(auth_(q.token)) };
        break;
      case 'saveTask': {
        const u = need_(auth_(q.token), 'edit');
        res = { task: saveTask_(u, q.task || {}) };
        break;
      }
      case 'deleteTask': {
        const u = need_(auth_(q.token), 'edit');
        deleteTask_(u, q.id);
        break;
      }
      case 'saveGuest': {
        const u = need_(auth_(q.token), 'edit');
        res = { guest: saveGuest_(u, q.guest || {}) };
        break;
      }
      case 'logout':
        if (q.token) PropertiesService.getScriptProperties().deleteProperty('tok_' + q.token);
        break;
      default:
        throw err_('Unknown request.', 400);
    }
    return json_(Object.assign({ ok: true }, res));
  } catch (x) {
    return json_({ ok: false, error: x.message || String(x), code: x.code || 500 });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function err_(msg, code) { const e = new Error(msg); e.code = code || 400; return e; }

/* =========================== auth =========================== */

function hash_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8));
}

function login_(pw) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fails') || 0);
  if (fails > 40) throw err_('Too many attempts. Try again in 10 minutes.', 429);
  const typed = String(pw || '').trim();
  const row = typed && read_('Access').find(function (r) { return String(r.password).trim() !== '' && String(r.password).trim() === typed; });
  if (!row) {
    cache.put('fails', String(fails + 1), 600);
    Utilities.sleep(1200);
    throw err_('That password didn’t work.', 401);
  }
  const token = Utilities.getUuid().replace(/-/g, '');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('tok_' + token, JSON.stringify({ name: row.name, ph: hash_(typed), exp: Date.now() + TOKEN_DAYS * 864e5 }));
  cleanTokens_();
  return Object.assign(userFromRow_(row), { token: token });
}

function userFromRow_(row) {
  const role = String(row.role || 'viewer').toLowerCase().trim();
  return { name: String(row.name), role: ['admin', 'editor', 'viewer'].indexOf(role) >= 0 ? role : 'viewer', person: String(row.person || row.name) };
}

function auth_(token) {
  if (!token) throw err_('Please sign in.', 401);
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('tok_' + token);
  if (!raw) throw err_('Please sign in again.', 401);
  const t = JSON.parse(raw);
  const row = read_('Access').find(function (r) { return String(r.name) === t.name; });
  // A changed or removed password signs that person out everywhere.
  if (t.exp < Date.now() || !row || !String(row.password).trim() || hash_(String(row.password).trim()) !== t.ph) {
    props.deleteProperty('tok_' + token);
    throw err_('Please sign in again.', 401);
  }
  return userFromRow_(row);
}

function need_(u, what) {
  if (what === 'edit' && u.role === 'viewer') throw err_('You have view-only access.', 403);
  return u;
}

function cleanTokens_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('tok_') !== 0) return;
    try { if (JSON.parse(all[k]).exp < Date.now()) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}

/* =========================== sheet helpers =========================== */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sh_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw err_('The sheet is missing the "' + name + '" tab. Run setup.', 500);
  return s;
}
function cell_(c) {
  if (c instanceof Date) {
    if (c.getFullYear() < 1901) return Utilities.formatDate(c, TZ, 'HH:mm');
    return Utilities.formatDate(c, TZ, 'yyyy-MM-dd');
  }
  return c === null || c === undefined ? '' : String(c);
}
function read_(name) {
  const v = sh_(name).getDataRange().getValues();
  if (v.length < 2) return [];
  const h = v[0].map(String);
  return v.slice(1).filter(function (r) { return r.some(function (c) { return c !== '' && c !== null; }); }).map(function (r) {
    const o = {};
    h.forEach(function (k, i) { if (k) o[k] = cell_(r[i]); });
    return o;
  });
}
function headers_(name) { return sh_(name).getRange(1, 1, 1, sh_(name).getLastColumn()).getValues()[0].map(String); }

/** Insert or merge a row keyed by `key`. Only fields present in `obj` change. */
function upsert_(name, obj, key) {
  key = key || 'id';
  const s = sh_(name), h = headers_(name), ki = h.indexOf(key);
  const last = s.getLastRow();
  const keys = last > 1 ? s.getRange(2, ki + 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  const at = keys.indexOf(String(obj[key]));
  if (at >= 0) {
    const rng = s.getRange(at + 2, 1, 1, h.length);
    const cur = rng.getValues()[0];
    const row = h.map(function (k, i) { return Object.prototype.hasOwnProperty.call(obj, k) ? String(obj[k] == null ? '' : obj[k]) : cur[i]; });
    rng.setNumberFormat('@').setValues([row]);
  } else {
    const row = h.map(function (k) { return String(obj[k] == null ? '' : obj[k]); });
    s.getRange(last + 1, 1, 1, h.length).setNumberFormat('@').setValues([row]);
  }
}
function deleteRow_(name, id) {
  const s = sh_(name), h = headers_(name), ki = h.indexOf('id');
  const last = s.getLastRow();
  if (last < 2) return;
  const ids = s.getRange(2, ki + 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); });
  const at = ids.indexOf(String(id));
  if (at >= 0) s.deleteRow(at + 2);
}
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function meta_() { const m = {}; read_('Meta').forEach(function (r) { m[r.key] = r.value; }); return m; }
function setMeta_(k, v) { upsert_('Meta', { key: k, value: v }, 'key'); }
function log_(u, taskId, title, change) {
  sh_('Activity').appendRow([new Date().toISOString(), u.name, taskId, title, change]);
}

/* =========================== reads =========================== */

function bundle_(u) {
  const meta = meta_();
  const pub = {};
  Object.keys(meta).forEach(function (k) { if (k.indexOf('source_') !== 0 && k.indexOf('form_edit') !== 0 && k.indexOf('form_entry') !== 0) pub[k] = meta[k]; });
  if (u.role !== 'viewer') pub.form_entry_name = meta.form_entry_name || '', pub.form_entry_code = meta.form_entry_code || '', pub.form_entry_others = meta.form_entry_others || '', pub.form_entry_code_en = meta.form_entry_code_en || '';
  const days = {};
  read_('Programme').forEach(function (r) {
    const d = days[r.day_id] || (days[r.day_id] = { id: r.day_id, order: Number(r.day_order), label: r.day_label, title: r.day_title, note: r.day_note, items: [] });
    d.items.push({ order: Number(r.order), time: r.time, title: r.title, place: r.place, status: r.status });
  });
  Object.keys(days).forEach(function (k) { days[k].items.sort(function (a, b) { return a.order - b.order; }); });
  const guests = read_('Guests').map(function (g) {
    if (u.role === 'viewer') PRIVATE_GUEST.forEach(function (k) { delete g[k]; });
    return g;
  });
  const act = read_('Activity').slice(-60).reverse();
  return {
    me: u,
    tasks: read_('Tasks').map(function (t) { t.n = Number(t.n) || 0; return t; }),
    activity: act,
    programme: Object.keys(days).map(function (k) { return days[k]; }),
    dates: read_('Dates'),
    docs: read_('Docs').map(function (d) { d.order = Number(d.order) || 0; return d; }),
    people: read_('People').map(function (p) { p.order = Number(p.order) || 0; return p; }),
    meta: pub,
    guests: guests,
    rooms: read_('Rooms'),
    runsheet: ss_().getSheetByName('Runsheet') ? read_('Runsheet') : [],
    blocks: read_('Blocks'),
  };
}

/* =========================== writes =========================== */

function saveTask_(u, t) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const all = read_('Tasks');
    const body = {};
    TASK_FIELDS.forEach(function (k) { if (t[k] !== undefined) body[k] = String(t[k]).slice(0, 2000); });
    if (!t.id) {
      if (!body.title || !body.area) throw err_('An entry and a chapter are needed.');
      const n = all.reduce(function (m, x) { return Math.max(m, Number(x.n) || 0); }, 0) + 1;
      body.id = 't' + ('00' + n).slice(-3);
      body.n = String(n);
      body.source = 'Added in HQ by ' + u.name;
      body.created = today_();
      body.status = body.status || 'open';
      body.type = body.type || 'task';
      body.priority = body.priority || 'normal';
    } else {
      body.id = t.id;
      if (!all.some(function (x) { return x.id === t.id; })) throw err_('That entry no longer exists.', 404);
    }
    body.updated = today_();
    body.updatedBy = u.name;
    upsert_('Tasks', body);
    const before = all.find(function (x) { return x.id === body.id; });
    log_(u, body.id, body.title || (before && before.title) || '', t._change || (t.id ? 'edited' : 'added'));
    return body;
  } finally { lock.releaseLock(); }
}

function deleteTask_(u, id) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = read_('Tasks').find(function (x) { return x.id === id; });
    deleteRow_('Tasks', id);
    if (t) log_(u, id, t.title, 'deleted');
  } finally { lock.releaseLock(); }
}

function saveGuest_(u, g) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const cur = read_('Guests').find(function (x) { return x.id === g.id; });
    if (!cur) throw err_('That guest no longer exists.', 404);
    const body = { id: g.id };
    GUEST_EDIT.forEach(function (k) { if (g[k] !== undefined) body[k] = String(g[k]).slice(0, 1000); });
    body.updated = today_();
    body.updated_by = u.name;
    upsert_('Guests', body);
    log_(u, g.id, 'Guest: ' + cur.name, g._change || 'updated guest details');
    return body;
  } finally { lock.releaseLock(); }
}

/* =========================== travel form =========================== */

const FORM_MAP = {};
FORM_MAP[Q.name] = 'name'; FORM_MAP['Your full name'] = 'name';
FORM_MAP[Q.others] = 'others'; FORM_MAP['Also on your invitation, sharing your room'] = 'others';
FORM_MAP[Q.confirm] = 'arrangement'; FORM_MAP['Is this right?'] = 'arrangement'; FORM_MAP['Our arrangements for you'] = 'others';
FORM_MAP[Q.when] = 'other_days';
FORM_MAP[Q.extra] = 'extra_nights';
FORM_MAP[Q.code] = 'code'; FORM_MAP['Guest code'] = 'code'; FORM_MAP['Invitation code'] = 'code'; FORM_MAP['Head guest name (as on passport / ID)'] = 'name';
FORM_MAP[Q.idnames] = 'id_names'; FORM_MAP['Full names as on passport / ID'] = 'id_names';
FORM_MAP[Q.phone] = 'phone';
FORM_MAP[Q.email] = 'email';
FORM_MAP[Q.aDate] = 'arrive_date';
FORM_MAP[Q.aMode] = 'arrive_mode';
FORM_MAP[Q.aTime] = 'arrive_time';
FORM_MAP[Q.aRef] = 'arrive_ref';
FORM_MAP[Q.dDate] = 'depart_date';
FORM_MAP[Q.dMode] = 'depart_mode';
FORM_MAP[Q.dTime] = 'depart_time';
FORM_MAP[Q.dRef] = 'depart_ref';
FORM_MAP[Q.diet] = 'diet';
FORM_MAP[Q.dietNotes] = 'diet_notes';
FORM_MAP[Q.id] = 'id_status';
FORM_MAP[Q.drivers] = 'drivers';
FORM_MAP[Q.notes] = 'notes';
FORM_MAP[Q.aWhen] = 'arrive_when';
FORM_MAP[Q.dWhen] = 'depart_when';
FORM_MAP[Q.travel] = 'travel_plans';
const TRAVEL_COPY = ['arrive_date', 'arrive_mode', 'arrive_time', 'arrive_ref', 'depart_date', 'depart_mode', 'depart_time', 'depart_ref', 'pickup', 'drop', 'extra_nights', 'id_status', 'drivers', 'arrangement', 'form_at'];
const FORM_VERSION = '13';
/** Half-hour time choices in 12-hour format (KV, 14 Oct 26: no 24-hour clock). The bilingual form adds the 24-hour time in brackets for Russian guests. */
function timeChoices_() {
  const out = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    const h = Math.floor(m / 60), mm = ('0' + (m % 60)).slice(-2), h12 = (h % 12) || 12;
    const t = h12 + ':' + mm + ' ' + (h < 12 ? 'AM' : 'PM');
    out.push(FORM_LANG === 'en' ? t : t + ' (' + ('0' + h).slice(-2) + ':' + mm + ')');
  }
  return out;
}
/** '2:30 PM' or '2:30 PM (14:30)' → '14:30' (the HQ stores 24-hour times). Anything else is kept as typed. */
function to24_(v) {
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return v;
  let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12;
  return ('0' + h).slice(-2) + ':' + m[2];
}

function createForm_() {
  const meta = meta_();
  if (meta.form_id) { try { FormApp.openById(meta.form_id); return meta.form_url; } catch (e) { /* recreate */ } }
  const f = FormApp.create(FORM_TITLE);
  buildForm_(f);
  f.setDestination(FormApp.DestinationType.SPREADSHEET, ss_().getId());
  const enId = meta.form_id_en;
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'onTravelForm' && t.getTriggerSourceId() !== enId) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onTravelForm').forForm(f).onFormSubmit().create();
  setMeta_('form_id', f.getId());
  setMeta_('form_url', f.getPublishedUrl());
  setMeta_('form_edit_url', f.getEditUrl());
  formEntries_(f);
  setMeta_('form_v', FORM_VERSION);
  return f.getPublishedUrl();
}

/** One-page guest registration (Dad's questions, Tauji's wording, 11 Oct 26). Keeps the name and code
 *  questions (renamed) so existing personal links keep working; everything else is rebuilt. */
function buildForm_(f, lang) {
  FORM_LANG = lang || 'both';
  try { buildFormItems_(f); } finally { FORM_LANG = 'both'; }
}
function buildFormItems_(f) {
  f.setTitle(FORM_TITLE).setDescription(formDesc_()).setConfirmationMessage(formThanks_());
  f.setCollectEmail(false).setAllowResponseEdits(true).setShowLinkToRespondAgain(false).setProgressBar(false);
  // Name is asked once (as on the ID). The guest reference, filled in by the personal link, sits at the end; it is how a reply finds its guest.
  let codeIt = null;
  const CODE_TITLES = ['Guest code', 'Invitation code', Q.code];
  f.getItems().forEach(function (it) {
    if (!codeIt && CODE_TITLES.indexOf(it.getTitle()) >= 0 && it.getType() === FormApp.ItemType.TEXT) codeIt = it;
    else f.deleteItem(it);
  });
  const REF_RU = 'Если ещё не забронировали, напишите «пока нет»; если едете сами, напишите «свой транспорт». Ответы можно изменить позже.';
  f.addTextItem().setTitle(Q.idnames).setRequired(true)
    .setHelpText(enRu_('Full name as on your passport or ID.', 'Ваше полное имя, точно как в паспорте или документе (для отеля).'));
  f.addTextItem().setTitle(Q.phone).setRequired(true)
    .setHelpText(enRu_('With country code, e.g. +44 7700 900123 or +91 98100 00000', 'Телефон / WhatsApp с кодом страны, например +7 900 123 45 67'));
  f.addTextItem().setTitle(Q.email).setRequired(true).setHelpText(enRu_('', 'Электронная почта'));
  // Travel kept general and optional (17 Oct 26): no exact flights, times or transfer promises while Saturday flights are uncertain.
  f.addSectionHeaderItem().setTitle('Your travel plans')
    .setHelpText(enRu_('Just tell us what you know so far. Not decided yet? Choose ‘Not sure yet’; you can come back and edit your answers any time.',
      'Ваши планы на поездку. Укажите то, что уже известно. Ещё не решили? Выберите «Пока не знаю»; ответы можно изменить в любой момент.'));
  f.addMultipleChoiceItem().setTitle(Q.aWhen).setRequired(true).setHelpText(enRu_('', 'Когда вы планируете приехать в Джайсалмер?'))
    .setChoiceValues([bi_('Before Fri 29 Jan', 'До пятницы, 29 января'), bi_('Fri 29 Jan', 'Пятница, 29 января'), bi_('Sat 30 Jan', 'Суббота, 30 января'), bi_('Not sure yet', 'Пока не знаю')]);
  f.addMultipleChoiceItem().setTitle(Q.dWhen).setRequired(true).setHelpText(enRu_('', 'Когда вы планируете уехать из Джайсалмера?'))
    .setChoiceValues([bi_('Sun 31 Jan', 'Воскресенье, 31 января'), bi_('Mon 1 Feb', 'Понедельник, 1 февраля'), bi_('After Mon 1 Feb', 'После понедельника, 1 февраля'), bi_('Not sure yet', 'Пока не знаю')]);
  f.addParagraphTextItem().setTitle(Q.travel)
    .setHelpText(enRu_('Optional. Flight or train, rough times, or driving: whatever you know. Or just TBD.', 'Необязательно. Самолёт или поезд, примерное время или на машине: всё, что уже известно. Или просто «пока не знаю».'));
  f.addMultipleChoiceItem().setTitle(Q.diet).setRequired(true).setHelpText(enRu_('', 'Предпочтения в еде'))
    .setChoiceValues([bi_('Vegetarian', 'Вегетарианское'), bi_('Jain (no onion, garlic or root vegetables)', 'Джайнское (без лука, чеснока и корнеплодов)'), bi_('Vegan', 'Веганское'), bi_('Non-vegetarian', 'С мясом')]);
  f.addCheckboxItem().setTitle(Q.id).setRequired(true)
    .setHelpText(idHelp_())
    .setChoiceValues([bi_('Understood. I’ll send my ID by 15 November', 'Понятно. Отправлю до 15 ноября')]);
  f.addParagraphTextItem().setTitle(Q.notes)
    .setHelpText(enRu_('Accessibility needs, questions, anything at all', 'Что-нибудь ещё, что нам стоит знать? Особые потребности, вопросы, что угодно.'));
  f.addSectionHeaderItem().setTitle('For our records').setHelpText(enRu_('', 'Для наших записей'));
  const code = codeIt ? codeIt.asTextItem() : f.addTextItem();
  code.setTitle(Q.code).setRequired(true)
    .setHelpText(enRu_('Filled in by your personal link. Please leave it as it is.', 'Заполняется по вашей личной ссылке. Пожалуйста, не меняйте.'))
    .setValidation(FormApp.createTextValidation().setHelpText(bi_('Please open the form from the personal link we sent you.', 'Пожалуйста, откройте форму по личной ссылке, которую мы прислали.')).requireTextMatchesPattern('^g[0-9]{3}$').build());
  f.moveItem(code.getIndex(), f.getItems().length - 1);
}

/** Saves the pre-fill entry ids (name, others on the invitation, code) used by personal links. */
function formEntries_(f, sfx) {
  sfx = sfx || '';
  const ids = {};
  f.getItems().forEach(function (it) { ids[it.getTitle()] = it.getId(); });
  const pre = f.createResponse();
  pre.withItemResponse(f.getItemById(ids[Q.code]).asTextItem().createResponse('__CODE__'));
  const url = pre.toPrefilledUrl();
  const m1 = url.match(/entry\.(\d+)=__NAME__/), m2 = url.match(/entry\.(\d+)=__CODE__/), m3 = url.match(/entry\.(\d+)=__OTHERS__/);
  if (!sfx) setMeta_('form_entry_name', m1 ? m1[1] : '');
  if (m2) setMeta_('form_entry_code' + sfx, m2[1]);
  if (sfx) return;
  setMeta_('form_entry_others', '');
}

/** The English-only copy of the registration form (same questions, same sheet, same reply handler). Safe to re-run. */
function ensureEnglishForm_() {
  const meta = meta_();
  let f = null;
  if (meta.form_id_en) { try { f = FormApp.openById(meta.form_id_en); } catch (e) { f = null; } }
  if (!f) {
    f = FormApp.create(FORM_TITLE);
    buildForm_(f, 'en');
    f.setDestination(FormApp.DestinationType.SPREADSHEET, ss_().getId());
    try {
      const file = DriveApp.getFileById(f.getId());
      file.setName(FORM_TITLE + ' (English only)');
      const parents = DriveApp.getFileById(ss_().getId()).getParents();
      if (parents.hasNext()) file.moveTo(parents.next());
    } catch (e) { Logger.log('English form file: ' + e); }
    setMeta_('form_id_en', f.getId());
    setMeta_('form_url_en', f.getPublishedUrl());
    setMeta_('form_edit_url_en', f.getEditUrl());
    formEntries_(f, '_en');
    setMeta_('form_v_en', FORM_VERSION);
  } else if (meta.form_v_en !== FORM_VERSION) {
    buildForm_(f, 'en'); formEntries_(f, '_en'); setMeta_('form_v_en', FORM_VERSION);
  } else {
    FORM_LANG = 'en';
    try { f.setTitle(FORM_TITLE).setDescription(formDesc_()).setConfirmationMessage(formThanks_()); } finally { FORM_LANG = 'both'; }
  }
  const id = f.getId();
  if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'onTravelForm' && t.getTriggerSourceId() === id; })) {
    ScriptApp.newTrigger('onTravelForm').forForm(f).onFormSubmit().create();
  }
}

/** Trigger: copies each travel-form reply onto the matching guest (by code, else by name). */
function onTravelForm(e) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const a = {};
    e.response.getItemResponses().forEach(function (r) {
      const k = FORM_MAP[r.getItem().getTitle()];
      if (!k) return;
      let v = r.getResponse();
      if (Array.isArray(v)) v = v.join(', ');
      a[k] = String(v == null ? '' : v).trim();
      if (/[А-Яа-яЁё]/.test(a[k]) && a[k].indexOf(' / ') > 0) a[k] = a[k].split(' / ')[0].trim();
    });
    if (a.pickup) a.pickup = /^yes/i.test(a.pickup) ? 'yes' : 'no';
    if (a.drop) a.drop = /^yes/i.test(a.drop) ? 'yes' : 'no';
    if (a.diet) a.diet = a.diet.split(' (')[0];
    if (a.arrive_time) a.arrive_time = to24_(a.arrive_time);
    if (a.depart_time) a.depart_time = to24_(a.depart_time);
    // Rough plans only: an exact day goes into the date; anything else ('Before Fri 29 Jan', 'Not sure yet') into the ref as text.
    const when = {};
    if (a.arrive_when) { const d = { 'Fri 29 Jan': '2027-01-29', 'Sat 30 Jan': '2027-01-30' }[a.arrive_when]; when.arrive_date = d || ''; when.arrive_ref = d ? '' : (a.arrive_when === 'Not sure yet' ? 'TBD' : a.arrive_when); delete a.arrive_when; }
    if (a.depart_when) { const d = { 'Sun 31 Jan': '2027-01-31', 'Mon 1 Feb': '2027-02-01' }[a.depart_when]; when.depart_date = d || ''; when.depart_ref = d ? '' : (a.depart_when === 'Not sure yet' ? 'TBD' : a.depart_when); delete a.depart_when; }
    if (a.id_status) a.id_status = 'promised';
    if (a.drivers && a.drivers !== 'cab contacts') a.drivers = 'send list';
    if (a.other_days) { if (/^no/i.test(a.other_days)) a.drivers = 'cab contacts'; delete a.other_days; }
    if (a.arrangement) a.arrangement = /^yes/i.test(a.arrangement) ? 'confirmed' : 'not right';
    if (!a.name && a.id_names) a.name = a.id_names;
    let othersTyped = a.others || ''; delete a.others;
    if (/^just you\.?$/i.test(othersTyped.trim())) othersTyped = '';
    const guests = read_('Guests');
    const norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-zЀ-ӿ ]/g, '').replace(/\s+/g, ' ').trim(); };
    let g = a.code ? guests.find(function (x) { return x.id === a.code; }) : null;
    if (!g && a.name) {
      const full = norm(a.name), first = full.split(' ')[0];
      const exact = guests.filter(function (x) { return norm(x.name) === full; });
      const firsts = guests.filter(function (x) { return norm(x.name) === first || norm(x.name).split(' ')[0] === first; });
      g = exact.length === 1 ? exact[0] : (firsts.length === 1 ? firsts[0] : null);
    }
    const body = {};
    Object.keys(a).forEach(function (k) { if (k !== 'code' && k !== 'name' && a[k] !== '') body[k] = a[k]; });
    Object.keys(when).forEach(function (k) { body[k] = when[k]; });
    body.form_at = new Date().toISOString();
    body.updated = today_();
    body.updated_by = 'Travel form';
    if (g) {
      body.id = g.id;
      // The invitation (household) comes from Vedding only. Names typed in the form never add guests.
      if (/^no/i.test(a.arrangement || '')) {
        body.notes = ((g.notes ? g.notes + ' · ' : '') + 'Said our arrangement for them is NOT right: get in touch').slice(0, 1000);
        sh_('Activity').appendRow([new Date().toISOString(), 'Travel form', g.id, 'Guest: ' + g.name, 'says the invitation arrangement is not right: please call them']);
      }
      upsert_('Guests', body);
    } else {
      // Not matched to the guest list: kept separately for the family to check, never merged into an invitation.
      const n = guests.reduce(function (m, x) { return Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0); }, 0) + 1;
      body.id = 'g' + ('00' + n).slice(-3);
      body.name = a.name || 'Unknown';
      body.list = 'From the form';
      body.group = 'Not matched yet';
      body.rsvp = 'Y';
      if (othersTyped) body.party_names = othersTyped;
      upsert_('Guests', body);
    }
    sh_('Activity').appendRow([new Date().toISOString(), 'Travel form', body.id, 'Guest: ' + (g ? g.name : body.name), 'sent travel details']);
  } finally { lock.releaseLock(); }
}

/* =========================== one-time setup =========================== */

function setup() {
  const ss = ss_();
  seed_();
  TEXT_TABS.forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s) s.getRange(1, 1, s.getMaxRows(), s.getMaxColumns()).setNumberFormat('@');
  });
  const meta = meta_();
  const gN = importGuests_(meta.source_vedding_id);
  const rN = importRooms_(meta.source_roomplan_id);
  const url = createForm_();
  migrate_();
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  const msg = 'Setup done. Guests imported: ' + gN + '. Room-plan rows: ' + rN + '. Travel form: ' + url;
  Logger.log(msg);
  return msg;
}

/** Safe, repeatable fixes for an existing sheet: Anna spelling and form wording. */
function migrate_() {
  const meta = meta_();
  if (meta.form_id) {
    try { FormApp.openById(meta.form_id).setTitle(FORM_TITLE).setDescription(FORM_DESC).setConfirmationMessage(formThanks_()); } catch (e) { Logger.log('Form text: ' + e); }
  }
  setMeta_('couple', 'Yash & Anna');
  fixCoupleOrder_();
  const ppl = read_('People').find(function (p) { return p.id === 'p07'; });
  if (ppl && ppl.name === 'Ana') upsert_('People', { id: 'p07', name: 'Anna' });
  // Tauji's family joins the planning (10 Oct). Rows are added with a BLANK password: no access until Sparsh types one in.
  const acc = read_('Access');
  [['Sanjiv', 'editor', 'Tauji'], ['Animesh', 'editor', 'Animesh'], ['Taneema', 'editor', 'Taneema']].forEach(function (a) {
    if (!acc.some(function (r) { return r.name === a[0]; })) sh_('Access').appendRow([a[0], '', a[1], a[2]]);
  });
  const people = read_('People');
  if (!people.some(function (p) { return p.name === 'Taneema'; })) {
    upsert_('People', { id: 'p12', order: '6', name: 'Taneema', role: 'Tauji’s daughter. Attire guide feedback', side: 'Jain' });
  }
  const tp = people.find(function (p) { return p.id === 'p03'; });
  if (tp && tp.role === 'Decision-maker') upsert_('People', { id: 'p03', role: 'Decision-maker. Guest logistics, with Sparsh' });
  const tasks = read_('Tasks');
  const t46 = tasks.find(function (t) { return t.id === 't046'; });
  if (t46 && !t46.waitingOn) upsert_('Tasks', { id: 't046', waitingOn: 'Tauji / Sparcho' });
  const t18 = tasks.find(function (t) { return t.id === 't018'; });
  if (t18 && t18.status === 'done' && t18.updatedBy === 'Rajiv') {
    upsert_('Tasks', { id: 't018', status: 'hold', next: 'Check the family group chat: is this a separate request from Galina (#17)?', updated: today_(), updatedBy: 'Claude' });
    log_({ name: 'Claude' }, 't018', t18.title, 'put on hold: may be a different request from Galina’s (#17)');
  }

  // ---- 11 Oct 26: one-page registration form, couples, new tracker items ----
  const gs = sh_('Guests'), gh = headers_('Guests');
  ['household', 'id_status', 'drivers', 'id_names', 'arrangement', 'sent_at', 'travel_plans'].forEach(function (k) {
    if (gh.indexOf(k) < 0) { gs.getRange(1, gs.getLastColumn() + 1).setValue(k).setFontWeight('bold').setBackground('#5A1A1C').setFontColor('#FFFFFF'); gh.push(k); }
  });
  gs.createTextFinder('Yash & Ana').matchEntireCell(true).replaceAllWith('Yash & Anna');
  if (meta.form_id && meta.form_v !== FORM_VERSION) {
    try { const f = FormApp.openById(meta.form_id); buildForm_(f); formEntries_(f); setMeta_('form_v', FORM_VERSION); } catch (e) { Logger.log('Form rebuild: ' + e); }
  }
  try { ensureEnglishForm_(); } catch (e) { Logger.log('English form: ' + e); }
  refreshIdHelp_(meta_().form_id, 'both');
  refreshIdHelp_(meta_().form_id_en, 'en');
  try { syncVedding_(); } catch (e) { Logger.log('Vedding sync: ' + e); }
  if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncVedding'; })) ScriptApp.newTrigger('syncVedding').timeBased().everyHours(6).create();
  fixWeekdays_();
  applyLocalUpdates_();
  uploadGuides_();
}

/** Always Yash first: "Anna & Yash" becomes "Yash & Anna" in every tab, once. */
function fixCoupleOrder_() {
  if (meta_().couple_v === '1') return;
  [[/Ann?a\s*&\s*Yash/g, 'Yash & Anna'], [/Ann?a and Yash/g, 'Yash and Anna'], [/Ann?a, Yash/g, 'Yash, Anna'], [/Yash & Ana\b/g, 'Yash & Anna'], [/Yash and Ana\b/g, 'Yash and Anna']].forEach(function (p) {
    ss_().getSheets().forEach(function (sh) {
      if (sh.getName() === 'Access' || sh.getLastRow() < 1) return;
      sh.createTextFinder(p[0].source).useRegularExpression(true).replaceAllWith(p[1]);
    });
  });
  setMeta_('couple_v', '1');
}

/** 30 Jan 2027 is a Saturday: earlier text said Friday. Fixes day names in every tab, once. */
function fixWeekdays_() {
  if (meta_().weekdays_v === '1') return;
  const pairs = [['Thu 29 Jan', 'Fri 29 Jan'], ['Fri 30 Jan', 'Sat 30 Jan'], ['Sat 31 Jan', 'Sun 31 Jan'], ['Sun 1 Feb', 'Mon 1 Feb'],
    ['Thursday 29 January', 'Friday 29 January'], ['Friday 30 January', 'Saturday 30 January'], ['Saturday 31 January', 'Sunday 31 January'], ['Sunday 1 February', 'Monday 1 February'],
    ['Friday 30 & Saturday 31', 'Saturday 30 & Sunday 31']];
  // Replace later dates first so no text is changed twice.
  pairs.slice().reverse().forEach(function (p) {
    ss_().getSheets().forEach(function (sh) { if (sh.getName() !== 'Access' && sh.getLastRow() > 0) sh.createTextFinder(p[0]).replaceAllWith(p[1]); });
  });
  setMeta_('weekdays_v', '1');
}

/** Finished guest guides (PDFs carried in LOCAL) go into the sheet's Drive folder, view-only by link, and onto the Documents page. Once per version. */
function uploadGuides_() {
  const G = local_().guides || [];
  if (!G.length) return;
  const meta = meta_();
  const parents = DriveApp.getFileById(ss_().getId()).getParents();
  const dir = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  G.forEach(function (g) {
    const key = 'file_' + g.row.id + '_' + g.v;
    let url = g.url || meta[key];
    if (!url && g.b64) {
      const f = dir.createFile(Utilities.newBlob(Utilities.base64Decode(g.b64), 'application/pdf', g.name));
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      url = f.getUrl();
      setMeta_(key, url);
    }
    if (url) upsert_('Docs', Object.assign({}, g.row, { link: url }));
  });
}

/** Adds tracker items and task edits listed in LOCAL (paste file only). Skips anything already there. */
function applyLocalUpdates_() {
  const L = local_();
  const T = read_('Tasks');
  (L.newTasks || []).forEach(function (o) {
    if (T.some(function (t) { return t.title === o.title; })) return;
    const n = T.reduce(function (m, x) { return Math.max(m, Number(x.n) || 0); }, 0) + 1;
    const row = Object.assign({ id: 't' + ('00' + n).slice(-3), n: String(n), type: 'task', status: 'open', priority: 'normal', created: today_(), updated: today_(), updatedBy: 'Claude' }, o);
    upsert_('Tasks', row); T.push(row);
    log_({ name: 'Claude' }, row.id, row.title, 'added');
  });
  (L.upserts || []).forEach(function (o) { upsert_(o.tab, o.row); });
  const D = read_('Dates');
  (L.newDates || []).forEach(function (o) {
    if (D.some(function (d) { return d.what === o.what; })) return;
    const n = D.reduce(function (m, x) { return Math.max(m, Number(String(x.id).slice(1)) || 0); }, 0) + 1;
    const row = Object.assign({ id: 'k' + ('0' + n).slice(-2) }, o);
    upsert_('Dates', row); D.push(row);
  });
  (L.taskEdits || []).forEach(function (o) {
    const t = T.find(function (x) { return x.id === o.id; });
    if (!t || (o.ifNext && (t.next || '').indexOf(o.ifNext) < 0)) return;
    if (Object.keys(o.set).every(function (k) { return String(t[k] || '') === String(o.set[k]); })) return;
    const body = Object.assign({}, o.set, { id: o.id, updated: today_(), updatedBy: 'Claude' });
    upsert_('Tasks', body);
    log_({ name: 'Claude' }, o.id, t.title, o.log || 'updated');
  });
}

/** Reads the Vedding "final guest list": three side-by-side lists, a "C" mark starts a couple (that row + the next). */
function readVedding_(id) {
  const rng = SpreadsheetApp.openById(id).getSheetByName('final guest list').getDataRange();
  const v = rng.getValues(), bg = rng.getBackgrounds();
  // Core family rows are highlighted orange in Vedding: they don't get a form link.
  const isOrange = function (hex) {
    const m = String(hex || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return false;
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return r >= 0xE0 && g >= 0x60 && g <= 0xD8 && b <= 0x80;
  };
  const blocks = [{ c: 0, list: 'Yash & Anna' }, { c: 11, list: 'Sparsh' }, { c: 22, list: 'Rajiv & Shalini' }];
  const out = [];
  blocks.forEach(function (b) {
    let group = '';
    for (let i = 6; i < v.length; i++) {
      const r = v[i], name = String(r[b.c] || '').trim();
      if (!name) continue;
      const c1 = String(r[b.c + 1] || '').trim(), c2 = String(r[b.c + 2] || '').trim();
      if (/save date sent/i.test(c1) || /^rsvp$/i.test(c2)) { group = name; continue; }
      if (/total|list$/i.test(name)) continue;
      out.push({ list: b.list, group: group, name: name, rsvp: c2, sex: String(r[b.c + 3] || '').trim(), couple: /^c$/i.test(String(r[b.c + 4] || '').trim()), core: isOrange(bg[i][b.c]) ? 'Y' : '' });
    }
  });
  return out;
}

/** Keeps Guests in step with Vedding (the source of truth for who is invited and who comes together):
 *  adds new names, refreshes RSVP for rows nobody has edited in the HQ, and sets `household` (the id of the
 *  first person on each invitation). An invitation is a "C" row plus the next row, plus any following rows that
 *  start with the first person's name (e.g. "Irina Kid #1", "Rita +1 Irina"). Nobody else is ever added. */
function syncVedding_() {
  const meta = meta_();
  if (!meta.source_vedding_id) return 'No Vedding id';
  const V = readVedding_(meta.source_vedding_id);
  const gs = sh_('Guests'), gh = headers_('Guests');
  ['household', 'core'].forEach(function (k) { if (headers_('Guests').indexOf(k) < 0) gs.getRange(1, gs.getLastColumn() + 1).setValue(k).setFontWeight('bold').setBackground('#5A1A1C').setFontColor('#FFFFFF'); });
  const guests = read_('Guests');
  const norm = function (x) { return String(x || '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  const listOf = function (l) { return l === 'Yash & Ana' ? 'Yash & Anna' : l; };
  const used = {}, seen = {};
  const LISTS = ['Yash & Anna', 'Sparsh', 'Rajiv & Shalini'];
  let nextN = guests.reduce(function (m, x) { return Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0); }, 0);
  let added = 0, renamed = 0, dropped = 0;
  // 1. Exact name matches (the nth "Will" in a list matches the nth "Will").
  V.forEach(function (r) {
    const k = r.list + '|' + norm(r.name);
    seen[k] = (seen[k] || 0) + 1;
    let n = 0;
    const g = guests.find(function (x) { if (listOf(x.list) !== r.list || norm(x.name) !== norm(r.name)) return false; n++; return n === seen[k]; });
    if (g) { r.id = g.id; r.g = g; used[g.id] = true; }
  });
  // 2. Renamed rows ("Bob's partner" → "Antonia", "Rita +1" → "Rita +1 Irina"): match to a leftover row in the same list.
  const paren = function (x) { const m = norm(x).match(/\(.*\)/); return m ? m[0] : ''; };
  V.forEach(function (r, i) {
    if (r.g) return;
    const prev = V[i - 1] && V[i - 1].list === r.list ? V[i - 1] : null;
    const prevFirst = prev ? norm(prev.name).split(' ')[0] : '';
    const nr = norm(r.name);
    const g = guests.find(function (x) {
      if (used[x.id] || listOf(x.list) !== r.list) return false;
      const nx = norm(x.name);
      return (nx && (nr.indexOf(nx + ' ') === 0 || nx.indexOf(nr + ' ') === 0))
        || (paren(nx) && paren(nx) === paren(nr))
        || (prevFirst && nx === prevFirst + '\'s partner');
    });
    if (g) { used[g.id] = true; r.id = g.id; r.g = g; renamed++; upsert_('Guests', { id: g.id, name: r.name, updated: today_(), updated_by: 'Vedding sync' }); r.g.updated_by = 'Vedding sync'; }
  });
  // 3. New names.
  V.forEach(function (r) {
    if (r.g) return;
    nextN++; added++;
    r.id = 'g' + ('00' + nextN).slice(-3);
    upsert_('Guests', { id: r.id, name: r.name, list: r.list, group: r.group, side: r.list, rsvp: r.rsvp, sex: r.sex, updated: today_(), updated_by: 'Vedding sync' });
  });
  // 4. Rows no longer in Vedding: marked not coming (unless they already sent the form), so counts stay right.
  guests.forEach(function (x) {
    if (used[x.id] || LISTS.indexOf(listOf(x.list)) < 0 || x.form_at || x.group === 'Not in Vedding') return;
    upsert_('Guests', { id: x.id, rsvp: 'N', group: 'Not in Vedding', household: '', updated: today_(), updated_by: 'Vedding sync' });
    dropped++;
  });
  // RSVP and sex follow Vedding unless someone edited that guest in the HQ.
  V.forEach(function (r) {
    if (!r.g) return;
    const fromSheet = /^(import from vedding|vedding sync)$/i.test(String(r.g.updated_by || ''));
    if (fromSheet && (String(r.g.rsvp || '') !== r.rsvp || String(r.g.sex || '') !== r.sex)) upsert_('Guests', { id: r.id, rsvp: r.rsvp, sex: r.sex, updated: today_(), updated_by: 'Vedding sync' });
  });
  // Invitations (households).
  const hh = {};
  for (let i = 0; i < V.length; i++) {
    const r = V[i];
    if (hh[r.id]) continue;
    const members = [r];
    let j = i + 1;
    if (r.couple && V[j] && V[j].list === r.list && !hh[V[j].id]) { members.push(V[j]); j++; }
    const pre = norm(r.name) + ' ';
    while (V[j] && V[j].list === r.list && norm(V[j].name).indexOf(pre) === 0 && !hh[V[j].id]) { members.push(V[j]); j++; }
    members.forEach(function (m) { hh[m.id] = members.length > 1 ? r.id : ''; });
  }
  const now = read_('Guests');
  let changed = 0;
  const coreOf = {};
  V.forEach(function (r) { coreOf[r.id] = r.core; });
  now.forEach(function (g) {
    if (!(g.id in hh)) return;
    const body = {};
    if (String(g.household || '') !== hh[g.id]) { body.household = hh[g.id]; changed++; }
    if (String(g.core || '') !== (coreOf[g.id] || '')) body.core = coreOf[g.id] || '';
    if (Object.keys(body).length) { body.id = g.id; upsert_('Guests', body); }
  });
  const msg = 'Vedding sync: ' + V.length + ' names, ' + added + ' added, ' + renamed + ' renamed, ' + dropped + ' no longer listed, ' + changed + ' invitation links updated';
  setMeta_('vedding_synced', new Date().toISOString());
  Logger.log(msg);
  return msg;
}

/** Runs the Vedding sync (also on a timer every 6 hours, set up by `setup`). */
function syncVedding() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { return syncVedding_(); } finally { lock.releaseLock(); }
}

/** Creates the tabs from SEED (defined in Seed.gs) if they don't exist yet. Never overwrites data. */
function seed_() {
  const ss = ss_();
  const S = (typeof SEED !== 'undefined') ? SEED : {};
  TABS.forEach(function (name) {
    let s = ss.getSheetByName(name);
    if (s && s.getLastRow() > 0) return;
    if (!s) s = ss.insertSheet(name);
    const rows = S[name];
    if (!rows || !rows.length) return;
    const w = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    const vals = rows.map(function (r) { const x = r.slice(); while (x.length < w) x.push(''); return x; });
    s.getRange(1, 1, vals.length, w).setNumberFormat('@').setValues(vals);
    s.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#5A1A1C').setFontColor('#FFFFFF');
    s.setFrozenRows(1);
  });
  const acc = ss.getSheetByName('Access');
  if (acc) { acc.setTabColor('#9A3322'); acc.getRange('F1').setValue('← Passwords live here. Blank password = no access. Roles: admin, editor, viewer.'); }
}

/** Imports the Vedding "final guest list" (read only). Skips if Guests already has rows. */
function importGuests_(id) {
  const out = sh_('Guests');
  if (out.getLastRow() > 1 || !id) return 0;
  const src = SpreadsheetApp.openById(id).getSheetByName('final guest list');
  if (!src) return 0;
  const v = src.getDataRange().getValues();
  const blocks = [{ c: 0, list: 'Yash & Anna', side: 'Yash & Anna' }, { c: 11, list: 'Sparsh', side: 'Sparsh' }, { c: 22, list: 'Rajiv & Shalini', side: 'Rajiv & Shalini' }];
  const h = headers_('Guests');
  const rows = [];
  let n = 0;
  blocks.forEach(function (b) {
    let group = '';
    for (let i = 6; i < v.length; i++) {
      const r = v[i];
      const name = String(r[b.c] || '').trim();
      if (!name) continue;
      const c1 = String(r[b.c + 1] || '').trim(), c2 = String(r[b.c + 2] || '').trim();
      if (/save date sent/i.test(c1) || /^rsvp$/i.test(c2)) { group = name; continue; }
      if (/total|list$/i.test(name)) continue;
      n++;
      const g = {
        id: 'g' + ('00' + n).slice(-3), name: name, list: b.list, group: group, side: b.side,
        rsvp: c2 || '', sex: String(r[b.c + 3] || ''),
        arrive_date: cell_(r[b.c + 5]), arrive_mode: String(r[b.c + 6] || ''),
        depart_date: cell_(r[b.c + 7]), depart_mode: String(r[b.c + 8] || ''),
        updated: today_(), updated_by: 'Import from Vedding',
      };
      rows.push(h.map(function (k) { return g[k] == null ? '' : String(g[k]); }));
    }
  });
  if (rows.length) out.getRange(2, 1, rows.length, h.length).setNumberFormat('@').setValues(rows);
  return rows.length;
}

/** Imports the room-block plan from "Final_Yash Marriage" → Guest List (read only). */
function importRooms_(id) {
  const out = sh_('Rooms');
  if (out.getLastRow() > 1 || !id) return 0;
  const src = SpreadsheetApp.openById(id).getSheetByName('Guest List');
  if (!src) return 0;
  const v = src.getDataRange().getValues();
  const rows = [], blocks = [];
  let n = 0;
  v.forEach(function (r) {
    const grp = r[1], party = String(r[2] || '').trim();
    if (party && grp !== '' && !isNaN(Number(grp)) && !/^group$/i.test(party)) {
      n++;
      rows.push(['r' + ('00' + n).slice(-3), String(grp), party.replace(/\s*\n\s*/g, ', '), String(r[3]), String(r[4]), 'Block ' + String(r[5]), String(r[6]), '']);
    }
    const bl = String(r[9] || '').trim();
    if (/^block \d+$/i.test(bl) && r[11] !== '') blocks.push([bl.replace(/^block/i, 'Block'), String(r[11]), '']);
  });
  if (rows.length) out.getRange(2, 1, rows.length, 8).setNumberFormat('@').setValues(rows);
  const bs = sh_('Blocks');
  if (bs.getLastRow() < 2 && blocks.length) bs.getRange(2, 1, blocks.length, 3).setNumberFormat('@').setValues(blocks);
  return rows.length;
}
