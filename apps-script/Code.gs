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
const TABS = ['Tasks', 'Activity', 'Programme', 'Dates', 'Docs', 'People', 'Meta', 'Access', 'Guests', 'Rooms', 'Blocks'];
const TEXT_TABS = ['Tasks', 'Activity', 'Programme', 'Dates', 'Docs', 'People', 'Meta', 'Access', 'Guests', 'Rooms', 'Blocks'];
const TASK_FIELDS = ['area', 'title', 'type', 'waitingOn', 'next', 'due', 'status', 'priority', 'notes'];
const GUEST_EDIT = ['rsvp', 'phone', 'email', 'from_city', 'party_size', 'party_names', 'arrive_date', 'arrive_time', 'arrive_mode', 'arrive_ref', 'pickup',
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
  if (u.role !== 'viewer') pub.form_entry_name = meta.form_entry_name || '', pub.form_entry_code = meta.form_entry_code || '';
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

const FORM_MAP = {
  'Your full name': 'name',
  'Guest code': 'code',
  'Phone / WhatsApp': 'phone',
  'Email': 'email',
  'Travelling from': 'from_city',
  'How many people are in your party, including you?': 'party_size',
  'Who else is in your party?': 'party_names',
  'How are you getting to Jaisalmer?': 'arrive_mode',
  'Arrival date in Jaisalmer': 'arrive_date',
  'Arrival time (roughly)': 'arrive_time',
  'Arrival flight or train number': 'arrive_ref',
  'Would you like a pickup from the airport or station?': 'pickup',
  'How are you leaving Jaisalmer?': 'depart_mode',
  'Departure date': 'depart_date',
  'Departure time (roughly)': 'depart_time',
  'Departure flight or train number': 'depart_ref',
  'Would you like a drop to the airport or station?': 'drop',
  'Extra nights at Fort Rajwada': 'extra_nights',
  'Who would you like to share a room with?': 'room_with',
  'Food preference': 'diet',
  'Allergies or other dietary needs': 'diet_notes',
  'Anything else we should know?': 'notes',
};

function createForm_() {
  const meta = meta_();
  if (meta.form_id) { try { FormApp.openById(meta.form_id); return meta.form_url; } catch (e) { /* recreate */ } }
  const f = FormApp.create('Ana & Yash · Jaisalmer · Your travel details');
  f.setDescription('30 & 31 January 2027 · Fort Rajwada, Jaisalmer\n\n' +
    'So we can plan pickups, rooms and food, please tell us how and when you’re arriving. It takes about 3 minutes. ' +
    'If you’re filling this in for your partner or family too, one form for your party is enough.\n\nThank you! Ana & Yash');
  f.setCollectEmail(false).setAllowResponseEdits(true).setShowLinkToRespondAgain(false).setProgressBar(true);
  f.setConfirmationMessage('Thank you! We’ve got your details and will be in touch closer to the date. Ana & Yash');

  f.addSectionHeaderItem().setTitle('About you');
  f.addTextItem().setTitle('Your full name').setHelpText('As on your passport or ID').setRequired(true);
  f.addTextItem().setTitle('Guest code').setHelpText('Filled in for you if you used your personal link. Leave it as it is, or blank.');
  f.addTextItem().setTitle('Phone / WhatsApp').setHelpText('With country code, e.g. +44 7700 900123 or +91 98100 00000').setRequired(true);
  f.addTextItem().setTitle('Email');
  f.addTextItem().setTitle('Travelling from').setHelpText('City and country');
  f.addListItem().setTitle('How many people are in your party, including you?').setChoiceValues(['1', '2', '3', '4', '5', '6 or more']).setRequired(true);
  f.addParagraphTextItem().setTitle('Who else is in your party?').setHelpText('Names of everyone travelling with you, and ages of any children');

  f.addPageBreakItem().setTitle('Arriving in Jaisalmer').setHelpText('The welcome lunch is at noon on Friday 30 January. Jaisalmer airport has a few flights a day from Delhi; there are also overnight trains.');
  f.addMultipleChoiceItem().setTitle('How are you getting to Jaisalmer?').setChoiceValues(['Flight', 'Train', 'Car', 'Not sure yet']).setRequired(true);
  f.addDateItem().setTitle('Arrival date in Jaisalmer').setIncludesYear(true);
  f.addTimeItem().setTitle('Arrival time (roughly)');
  f.addTextItem().setTitle('Arrival flight or train number').setHelpText('If you have it already. You can edit your answers later.');
  f.addMultipleChoiceItem().setTitle('Would you like a pickup from the airport or station?').setChoiceValues(['Yes please', 'No, we’ve got it covered']);

  f.addPageBreakItem().setTitle('Leaving Jaisalmer').setHelpText('Checkout is on the morning of Sunday 1 February.');
  f.addMultipleChoiceItem().setTitle('How are you leaving Jaisalmer?').setChoiceValues(['Flight', 'Train', 'Car', 'Not sure yet']);
  f.addDateItem().setTitle('Departure date').setIncludesYear(true);
  f.addTimeItem().setTitle('Departure time (roughly)');
  f.addTextItem().setTitle('Departure flight or train number');
  f.addMultipleChoiceItem().setTitle('Would you like a drop to the airport or station?').setChoiceValues(['Yes please', 'No, we’ve got it covered']);

  f.addPageBreakItem().setTitle('Stay and food');
  f.addCheckboxItem().setTitle('Extra nights at Fort Rajwada')
    .setHelpText('The wedding nights of 30 and 31 January are taken care of. If you’d like to arrive early or stay on, tick the nights and we’ll check availability with the hotel (₹30,000 + tax per room per night, breakfast included).')
    .setChoiceValues(['Wed 28 Jan', 'Thu 29 Jan', 'Sun 1 Feb', 'No extra nights']);
  f.addTextItem().setTitle('Who would you like to share a room with?');
  f.addMultipleChoiceItem().setTitle('Food preference').setChoiceValues(['Vegetarian', 'Jain (no onion, garlic or root vegetables)', 'Vegan', 'Non-vegetarian']).setRequired(true);
  f.addTextItem().setTitle('Allergies or other dietary needs');
  f.addParagraphTextItem().setTitle('Anything else we should know?').setHelpText('Accessibility needs, questions, anything at all');

  f.setDestination(FormApp.DestinationType.SPREADSHEET, ss_().getId());
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'onTravelForm') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onTravelForm').forForm(f).onFormSubmit().create();

  // Entry ids for personal pre-filled links (name + guest code).
  const ids = {};
  f.getItems().forEach(function (it) { ids[it.getTitle()] = it.getId(); });
  const pre = f.createResponse();
  pre.withItemResponse(f.getItemById(ids['Your full name']).asTextItem().createResponse('__NAME__'));
  pre.withItemResponse(f.getItemById(ids['Guest code']).asTextItem().createResponse('__CODE__'));
  const url = pre.toPrefilledUrl();
  const m1 = url.match(/entry\.(\d+)=__NAME__/), m2 = url.match(/entry\.(\d+)=__CODE__/);
  setMeta_('form_id', f.getId());
  setMeta_('form_url', f.getPublishedUrl());
  setMeta_('form_edit_url', f.getEditUrl());
  if (m1) setMeta_('form_entry_name', m1[1]);
  if (m2) setMeta_('form_entry_code', m2[1]);
  return f.getPublishedUrl();
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
    });
    if (a.pickup) a.pickup = /^yes/i.test(a.pickup) ? 'yes' : 'no';
    if (a.drop) a.drop = /^yes/i.test(a.drop) ? 'yes' : 'no';
    if (a.diet) a.diet = a.diet.split(' (')[0];
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
    body.form_at = new Date().toISOString();
    body.updated = today_();
    body.updated_by = 'Travel form';
    if (g) {
      body.id = g.id;
      upsert_('Guests', body);
    } else {
      const n = guests.reduce(function (m, x) { return Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0); }, 0) + 1;
      body.id = 'g' + ('00' + n).slice(-3);
      body.name = a.name || 'Unknown';
      body.list = 'From the form';
      body.group = 'Not matched yet';
      body.rsvp = 'Y';
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
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  const msg = 'Setup done. Guests imported: ' + gN + '. Room-plan rows: ' + rN + '. Travel form: ' + url;
  Logger.log(msg);
  return msg;
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
  const blocks = [{ c: 0, list: 'Yash & Ana', side: 'Yash & Ana' }, { c: 11, list: 'Sparsh', side: 'Sparsh' }, { c: 22, list: 'Rajiv & Shalini', side: 'Rajiv & Shalini' }];
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
