/*
  evening: site logic (vanilla js, no build).

  talks to the google apps script web app in the planning sheet (Code.gs).
  paste the web app's /exec url into CONFIG.apiUrl below.

  browser storage (localStorage, nothing else):
    evening.token  the guest's signed token
    evening.read   "1" once the guest has scrolled to "iii. the mondays"

  state hooks:
    body[data-view]             gate | letter | not-listed | goodbye
    body[data-drawer]           open | closed
    body[data-entry]            first | returning  (letter opened at the top vs at iii.)
    #view-gate[data-state]      boot | default | error | loading | failed
    .field[data-state]          default | error
    .profile-form[data-state]   idle | dirty | invalid | saving | saved | error   (#profile-form, #nl-form)
    .night[data-status]         none | asked | offered | confirmed | waitlisted | cancelled
    .night[data-state]          idle | saving | saved | error
    #confirm-remove[data-state] idle | removing | error
*/

const CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbwSjVPNsGCrdR3SdLMgMFEQZsdchESi4QKHcbo-u65Bx4xi0LEWQECnOV9I9rqusrIQTg/exec",
  tokenKey: "evening.token",
  readKey: "evening.read",
  goodbyeMs: 2600,
  deposit: 25,                    // replaced by the sheet's Settings > DEPOSIT once signed in
  venmoUrl: "https://venmo.com/u/archipelaga",
  timeoutMs: 60000                // apps script can take 20 to 40 seconds when it's been idle
};

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const digits = (s) => String(s || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const firstName = (n) => (n || "").trim().split(/\s+/)[0].toLowerCase() || "friend";
const money = (n) => `$${n}`;
const listWords = (a) => (a.length < 2 ? a[0] || "" : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- api (apps script web app) ----------
   POST with a text/plain body so the browser skips the CORS preflight apps script can't answer. */
async function call(action, payload = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.timeoutMs);
  try {
    const res = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...payload }),
      redirect: "follow",
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
const api = {
  enter: ({ name, email, phone }) => call("enter", { name, email, phone }),
  session: (token) => call("session", { token }),
  listSessions: (token) => call("listSessions", { token }),
  saveProfile: (token, profile) => call("saveProfile", { token, profile }),
  setRsvp: (token, sessionId, value) => call("setRsvp", { token, sessionId, value }),
  setRsvpNote: (token, sessionId, note) => call("setRsvpNote", { token, sessionId, note }),
  removeMe: (token) => call("removeMe", { token })
};

/* ---------- browser storage: token + read flag only ---------- */
const K = CONFIG;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

/* ---------- app state ---------- */
const app = { token: null, role: null, guest: null, sessions: [], signers: [], run: 0 };
const body = document.body;
const gate = $("#view-gate");
const gateForm = $("#gate-form");
const profileForm = $("#profile-form");
const nlForm = $("#nl-form");
const toggle = $("#drawer-toggle");
const confirmDlg = $("#confirm-remove");

/* ---------- validation ---------- */
const rules = {
  name: (v) => v.trim().length >= 2 || "we'll need your name.",
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || (v.trim() ? "that email doesn't look right." : "we'll need an email."),
  phone: (v) => digits(v).length >= 10 || (v.trim() ? "a full number with area code, please." : "we'll need a phone number.")
};
function setFieldError(form, name, msg) {
  const field = $(`.field[data-field="${name}"]`, form);
  if (!field) return;
  field.dataset.state = msg ? "error" : "default";
  $("input, textarea", field).setAttribute("aria-invalid", msg ? "true" : "false");
  const err = $(".field__error", field);
  if (err) err.textContent = msg || "";
}
function validate(form, names) {
  let firstBad = null;
  names.forEach((n) => {
    const res = rules[n](form.elements.namedItem(n).value);
    const msg = res === true ? "" : res;
    setFieldError(form, n, msg);
    if (msg && !firstBad) firstBad = form.elements.namedItem(n);
  });
  return firstBad;
}
const clearErrors = (form) => $$(".field", form).forEach((f) => setFieldError(form, f.dataset.field, ""));
const readFields = (form, names) => Object.fromEntries(names.map((n) => [n, form.elements.namedItem(n).value.trim()]));

/* ---------- views ---------- */
function setView(v) {
  if (v !== "letter") closeDrawer(false);
  body.dataset.view = v;
  window.scrollTo(0, 0);
  bindGuest();
}
function setGateState(state) {
  gate.dataset.state = state;
  const busy = state === "loading";
  $$("input, button", gateForm).forEach((el) => (el.disabled = busy));
  gateForm.setAttribute("aria-busy", String(busy));
}
function bindGuest() {
  const g = app.guest || {};
  $$('[data-bind="guest.first"]').forEach((el) => (el.textContent = firstName(g.name)));
  const credit = $("#credit-line");
  credit.hidden = !(g.credit > 0);
  credit.textContent = g.credit > 0 ? `${money(g.credit)} credit toward your next night` : "";
}
const INKS = ["tomato", "leaf", "hi", "ink"];
const inkFor = (name) => INKS[[...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % INKS.length];
function renderSigners() {
  const wrap = $("#signers");
  const list = $("#signers-list");
  const people = app.signers.map((s) => (typeof s === "string" ? { name: s } : s)).filter((s) => s && s.name);
  list.innerHTML = "";
  people.forEach((p, i) => {
    const li = $("#tpl-signer").content.firstElementChild.cloneNode(true);
    const name = p.name.trim().toLowerCase();
    li.dataset.ink = inkFor(name);
    li.style.setProperty("--tilt", `${[-4, 3, -2, 5, -5, 2][i % 6]}deg`);
    $('[data-bind="name"]', li).textContent = name;
    const initial = $('[data-bind="initial"]', li);
    if (p.icon) {
      const img = document.createElement("img");
      img.src = p.icon; img.alt = "";
      initial.replaceWith(img);
    } else {
      initial.textContent = name.charAt(0);
    }
    list.append(li);
  });
  wrap.hidden = !people.length;
  list.setAttribute("aria-label", people.length ? `with ${listWords(people.map((p) => p.name.toLowerCase()))}` : "");
}

function openLetter(entry) {
  body.dataset.entry = entry;
  setView("letter");
  if (entry === "returning") {
    requestAnimationFrame(() => {
      const y = $("#reread").getBoundingClientRect().top + window.scrollY - 24;
      window.scrollTo(0, y);
    });
  }
}
function showNotListed() {
  fillForm(nlForm, ["name", "email", "phone", "referredBy"]);
  setView("not-listed");
}
async function admit({ token, role, guest }) {
  app.token = token; app.role = role; app.guest = guest;
  if (role === "waitlist") { showNotListed(); return; }
  const ok = await loadSessions();
  if (!ok) { clearSession(); resetToGate(); return; }
  openLetter(store.get(K.readKey) ? "returning" : "first");
}
// returns false only when the sheet says the token is no longer good
async function loadSessions() {
  let r;
  try { r = await api.listSessions(app.token); } catch { r = { status: "offline" }; }
  if (r.status === "invalid") return false;
  if (r.status === "ok") {
    if (r.deposit) K.deposit = r.deposit;
    if (r.example) renderExample(r.example);
    $$('[data-bind="deposit-amount"]').forEach((el) => (el.textContent = money(K.deposit)));
  }
  app.sessions = r.sessions || [];
  app.signers = r.signers || [];
  renderNights(r.status !== "ok");
  renderSigners();
  return true;
}
// the money figure in iv. uses the sheet's numbers for a night of EXAMPLE GUESTS
function renderExample(ex) {
  const fig = $("#tier-figure");
  if (!fig || !ex.full) return;
  const a = Math.round((ex.plate / ex.full) * 1000) / 10;
  const b = Math.round((ex.half / ex.full) * 1000) / 10;
  const segs = $$(".tier-fig__seg", fig);
  if (segs.length === 3) {
    segs[0].style.width = `${a}%`;
    segs[1].style.left = `${a}%`; segs[1].style.width = `${b - a}%`;
    segs[2].style.left = `${b}%`;
  }
  const amts = [ex.plate, ex.half, ex.full];
  $$(".tier-fig__mark", fig).forEach((m, i) => {
    if (i < 2) m.style.setProperty("--at", `${[a, b][i]}%`);
    $(".tier-fig__amt", m).textContent = money(amts[i]);
  });
  $$(".tier-fig__legend b", fig).forEach((el, i) => (el.textContent = money(amts[i])));
  const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  const n = words[ex.guests - 1] || ex.guests;
  $("figcaption", fig).textContent = `a night of ${n} · ${amts.map(money).join(" · ")}`;
  $(".tier-fig__chart", fig).setAttribute("aria-label", `a bar with three marks: ${money(ex.plate)} covers your plate, ${money(ex.half)} half the crew's time, ${money(ex.full)} everyone paid`);
}
function clearSession() {
  store.del(K.tokenKey); store.del(K.readKey);
  app.token = app.role = app.guest = null;
}
function resetToGate() {
  gateForm.reset(); clearErrors(gateForm);
  setGateState("default");
  setView("gate");
}

/* ---------- gate ---------- */
gateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const bad = validate(gateForm, ["name", "email", "phone"]);
  if (bad) { setGateState("error"); bad.focus(); return; }
  const data = readFields(gateForm, ["name", "email", "phone"]);
  const run = ++app.run;
  setGateState("loading");
  let res = null;
  try { res = await api.enter(data); } catch {}
  if (run !== app.run) return;
  if (!res || !res.token) {
    $("#gate-failed").textContent = res && res.reason === "slow down"
      ? "too many tries. wait a few minutes and try again."
      : "something went wrong on our end. try again in a moment.";
    setGateState("failed");
    return;
  }
  store.set(K.tokenKey, res.token);
  await admit({ token: res.token, role: res.status === "ok" ? "guest" : "waitlist", guest: res.guest });
  gateForm.reset(); setGateState("default");
});
gateForm.addEventListener("input", (e) => {
  const f = e.target.closest(".field");
  if (f && f.dataset.state === "error") setFieldError(gateForm, f.dataset.field, "");
  if (["error", "failed"].includes(gate.dataset.state) && !$('.field[data-state="error"]', gateForm)) setGateState("default");
});

/* ---------- nights (inline rsvp in iii.) ---------- */
const STATUS_LABEL = {
  none: "not asked yet",
  asked: "asked · hosts choosing",
  offered: "seat offered",
  confirmed: "seat confirmed",
  waitlisted: "waitlisted",
  cancelled: "night cancelled"
};
function renderNights(failed) {
  const list = $("#nights");
  list.innerHTML = "";
  if (failed) {
    const li = document.createElement("li");
    li.className = "nights__empty";
    li.textContent = "we couldn't load the mondays just now. refresh the page to try again.";
    list.append(li);
    return;
  }
  const rsvps = (app.guest && app.guest.rsvps) || {};
  app.sessions.forEach((s) => {
    const row = $("#tpl-night").content.firstElementChild.cloneNode(true);
    const when = `${s.dow} ${s.month} ${s.day}`;
    const a = s.amounts || {};
    row.dataset.sessionId = s.id;
    $('[data-bind="month"]', row).textContent = s.month;
    $('[data-bind="day"]', row).textContent = s.day;
    $('[data-bind="dow"]', row).textContent = s.dow;
    $('[data-bind="theme"]', row).textContent = s.theme;
    $('[data-bind="meta"]', row).textContent = `${when} · ${s.time || "time tba"} · host · ${s.host}`;
    const amt = $('[data-bind="amounts"]', row);
    amt.textContent = `${money(a.plate)} · ${money(a.half)} · ${money(a.full)}`;
    amt.setAttribute("aria-label", `${money(a.plate)} covers your plate, ${money(a.half)} half the crew's time, ${money(a.full)} everyone paid`);
    $('[data-bind="group-label"]', row).setAttribute("aria-label", `rsvp for ${when}, ${s.theme}`);
    $('[data-bind="deposit"]', row).textContent = `a ${money(K.deposit)} deposit holds your seat`;
    $('[data-action="venmo-deposit"]', row).href = K.venmoUrl;
    const note = (app.guest && app.guest.notes && app.guest.notes[s.id]) || "";
    const noteInput = $('[data-bind="note"]', row);
    noteInput.value = note;
    noteInput.id = `note-${s.id}`;
    $('[data-bind="note-a11y"]', row).setAttribute("for", noteInput.id);
    $('[data-bind="note-label"]', row).textContent = note ? "your note" : "add a note";
    if (s.address) $('[data-bind="where"]', row).textContent = s.address;
    setNightStatus(row, s.status);
    setRowChoice(row, rsvps[s.id]);
    list.append(row);
  });
}
function setNightStatus(row, status) {
  row.dataset.status = status;
  const b = $(".badge", row);
  b.dataset.status = status;
  b.textContent = STATUS_LABEL[status] || status;
}
function setRowChoice(row, value) {
  $$("[data-rsvp]", row).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rsvp === value)));
}
$("#nights").addEventListener("click", async (e) => {
  const saveNote = e.target.closest('[data-action="save-note"]');
  if (saveNote && app.guest) {
    const row = saveNote.closest(".night");
    const id = row.dataset.sessionId;
    const value = $('[data-bind="note"]', row).value.trim();
    const status = $('[data-part="save-status"]', row);
    saveNote.disabled = true; row.dataset.state = "saving"; status.textContent = "saving note…";
    let res; try { res = await api.setRsvpNote(app.token, id, value); } catch { res = { status: "error" }; }
    saveNote.disabled = false;
    if (res.status === "ok") {
      app.guest.notes = { ...(app.guest.notes || {}), [id]: value };
      $('[data-bind="note-label"]', row).textContent = value ? "your note" : "add a note";
      row.dataset.state = "saved"; status.textContent = "note saved. the host will see it.";
    } else {
      row.dataset.state = "error"; status.textContent = "that didn't save. try again?";
    }
    return;
  }
  const btn = e.target.closest("[data-rsvp]");
  if (!btn || !app.guest) return;
  const row = btn.closest(".night");
  const id = row.dataset.sessionId;
  const value = btn.dataset.rsvp;
  const prev = app.guest.rsvps[id] || null;
  if (prev === value && row.dataset.state !== "error") return;
  const status = $('[data-part="save-status"]', row);
  setRowChoice(row, value);
  row.dataset.state = "saving"; status.textContent = "saving…";
  let res; try { res = await api.setRsvp(app.token, id, value); } catch { res = { status: "error" }; }
  if (res.status === "ok") {
    app.guest.rsvps[id] = value;
    const s = app.sessions.find((x) => x.id === id);
    // a yes/maybe puts you in the ask; hosts move you to offered/confirmed
    if (s && (s.status === "none" || s.status === "asked")) {
      s.status = value === "no" ? "none" : "asked";
      setNightStatus(row, s.status);
    }
    row.dataset.state = "saved"; status.textContent = "saved.";
  } else {
    setRowChoice(row, prev);
    row.dataset.state = "error"; status.textContent = "that didn't save. tap again?";
  }
});

/* ---------- read flag + reread link ---------- */
new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (en.isIntersecting && body.dataset.view === "letter" && app.token) store.set(K.readKey, "1");
  });
}).observe($("#mondays"));
$("#reread-link").addEventListener("click", (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
});

/* ---------- profile forms (drawer + not-on-the-list) ---------- */
function fillForm(form, names) {
  const g = app.guest || {};
  names.forEach((n) => (form.elements.namedItem(n).value = g[n] || ""));
  clearErrors(form);
  setFormState(form, "idle");
}
function setFormState(form, state, msg = "") {
  form.dataset.state = state;
  $('[data-role="status"]', form).textContent = msg;
  $('[data-role="save"]', form).disabled = state === "saving";
}
async function confirmSaved(sent) {
  const s = await api.session(app.token).catch(() => null);
  if (!s || s.status !== "ok") return { status: "error" };
  const g = s.guest || {};
  const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  const ok = Object.keys(sent).every((k) => (k === "phone" ? digits(g[k]) === digits(sent[k]) : same(g[k], sent[k])));
  return ok ? { status: "ok", guest: g } : { status: "error" };
}
const SAVE_ERROR = "that didn't save. give it another try in a moment.";
function wireProfileForm(form, names) {
  let timer;
  form.addEventListener("input", (e) => {
    const f = e.target.closest(".field");
    if (f && f.dataset.state === "error") setFieldError(form, f.dataset.field, "");
    if (form.dataset.state !== "saving") setFormState(form, "dirty");
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearTimeout(timer);
    const bad = validate(form, ["name", "email", "phone"]);
    if (bad) { setFormState(form, "invalid", "check the marked fields."); bad.focus(); return; }
    setFormState(form, "saving");
    const sent = readFields(form, names);
    let res; try { res = await api.saveProfile(app.token, sent); } catch { res = { status: "error" }; }
    // a slow response can fail here even though the sheet saved it, so check before showing an error
    if (res.status !== "ok") res = await confirmSaved(sent);
    if (res.status === "ok") {
      app.guest = { ...app.guest, ...res.guest };
      bindGuest();
      setFormState(form, "saved", form.dataset.savedMsg || "saved.");
      timer = setTimeout(() => { if (form.dataset.state === "saved") setFormState(form, "idle"); }, 3200);
    } else {
      setFormState(form, "error", SAVE_ERROR);
    }
  });
}
wireProfileForm(profileForm, ["name", "email", "phone", "allergies", "offers"]);
wireProfileForm(nlForm, ["name", "email", "phone", "referredBy"]);

/* ---------- drawer ---------- */
function openDrawer() {
  if (!app.guest) return;
  fillForm(profileForm, ["name", "email", "phone", "allergies", "offers"]);
  bindGuest();
  body.dataset.drawer = "open";
  toggle.setAttribute("aria-expanded", "true");
  $("#view-letter").inert = true;
  setTimeout(() => $("#drawer-close").focus(), 60);
}
function closeDrawer(returnFocus = true) {
  if (body.dataset.drawer !== "open") return;
  body.dataset.drawer = "closed";
  toggle.setAttribute("aria-expanded", "false");
  $("#view-letter").inert = false;
  if (returnFocus) toggle.focus();
}
toggle.addEventListener("click", openDrawer);
$$('[data-action="close-drawer"]').forEach((el) => el.addEventListener("click", () => closeDrawer()));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !confirmDlg.open) closeDrawer(); });

$("#sign-out").addEventListener("click", () => { clearSession(); app.run++; resetToGate(); });

/* ---------- remove me ---------- */
function setConfirmState(state, msg = "") {
  confirmDlg.dataset.state = state;
  $("#confirm-status").textContent = msg;
  $$("button", confirmDlg).forEach((b) => (b.disabled = state === "removing"));
}
function openRemove() {
  setConfirmState("idle");
  if (!confirmDlg.open) confirmDlg.showModal();
  $("#confirm-no").focus();
}
$$('[data-action="remove-me"]').forEach((b) => b.addEventListener("click", openRemove));
$("#confirm-no").addEventListener("click", () => confirmDlg.close());
$("#confirm-yes").addEventListener("click", async () => {
  setConfirmState("removing");
  let res; try { res = await api.removeMe(app.token); } catch { res = { status: "error" }; }
  // same check: if the sheet no longer knows this token, the removal went through
  if (res.status !== "ok") {
    const s = await api.session(app.token).catch(() => null);
    if (s && s.status === "invalid") res = { status: "ok" };
  }
  if (res.status === "ok") {
    confirmDlg.close();
    clearSession();
    showGoodbye();
  } else {
    setConfirmState("error", "that didn't go through. try again in a moment.");
  }
});
function showGoodbye() {
  const run = ++app.run;
  setView("goodbye");
  setTimeout(() => { if (run === app.run && body.dataset.view === "goodbye") resetToGate(); }, K.goodbyeMs);
}

/* ---------- boot ---------- */
async function boot() {
  $("#venmo-link").href = K.venmoUrl;
  const t = store.get(K.tokenKey);
  if (t) {
    setGateState("boot");
    const s = await api.session(t).catch(() => ({ status: "offline" }));
    if (s.status === "ok") {
      // someone moved from the waitlist to guests gets a new token
      const token = s.token || t;
      if (s.token) store.set(K.tokenKey, s.token);
      await admit({ token, role: s.role, guest: s.guest });
      setGateState("default");
      return;
    }
    // only forget the sign-in when the sheet says it's no longer good, not on a network blip
    if (s.status === "invalid") clearSession();
  }
  setGateState("default");
}

boot();
