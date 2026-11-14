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
    .night[data-status]         none | maybe | yes | confirmed | full | cancelled | past
                                (past = the night has happened: greyed out, no rsvp, menu still opens)
                                (yes = said yes, not confirmed yet; confirmed = yes + a VENMO amount on the sheet)
    .night[data-state]          idle | saving | saved | error
    #confirm-remove[data-state] idle | removing | error
*/

const CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbwSjVPNsGCrdR3SdLMgMFEQZsdchESi4QKHcbo-u65Bx4xi0LEWQECnOV9I9rqusrIQTg/exec",
  tokenKey: "evening.token",
  readKey: "evening.read",
  goodbyeMs: 2600,
  venmoUrl: "https://venmo.com/u/archipelaga",
  timeoutMs: 60000                // apps script can take 20 to 40 seconds when it's been idle
};

/* ---------- menus ----------
   edited here by hand (the sheet doesn't hold menus). keyed by the night's SESSION ID on the
   Sessions tab, e.g. "S03", so a menu stays with its dinner when the date moves. an older
   "month day" key ("oct 19") still works. a night with no entry shows "menu still being written".
     {dek, intro: [paragraph, ...], items: [item, ...]}   items render in order
     item: {name, alt, sub, lines: [..]}   dish  -> "name / alt", italic sub, plain lines
           {kind:"drink", name, desc}      drink -> "name // desc"
           {kind:"tbd"}                    a "??" slot */
const MENUS = {
  "S03": {
    dek: "",
    intro: [
      "we start at 11 pm, the part of a wake when the visitors have gone home and the ones staying up with the dead pull their chairs in closer. the way death tends to get handled in this country, quietly and kept out of sight, has always felt foreign to me. for filipinos who keep our old traditions, death is something we keep close: we feed our dead, we talk to them, we set food out for them. they’re never really gone. in the old belief, our dead become anito, ancestor spirits who stay close and keep watch over us. our wakes are long, social and full of food. at undas, families spend the night at the cemetery with candles, cards and a feast laid out on the graves, more reunion than mourning. for one night, let’s talk about death out loud, and celebrate the people who’ve passed on the way they deserve: with food, drink and stories.",
      "the focus here will be of ritual. i’ve been thinking about this one since 2019, and if there’s one i’m really asking you to come to it’s this one."
    ],
    items: [
      { name: "pinikpikan", alt: "tinola ampon etag", sub: "a dish, an offering, divination. for when one is looking for guidance regarding a difficult decision.", lines: ["chicken, upo, kamote leaves in a ginger and salted pork broth."] },
      { name: "tidtad", alt: "dinuguan", sub: "connecting pampanga to the cordilleras", lines: ["blood stew with pork belly, shoulder, ear and serrano chilies. served with traditionally fermented putong puti rice cake."] },
      { name: "atang", alt: "offering to the dead", lines: ["black rice suman, sticky rice with coconut milk and ginger", "busi-inspired black sesame rice krispie treat"] },
      { name: "nasi", alt: "steamed white rice" },
      { kind: "drink", name: "basi", desc: "tamarind, salted lime, soda" },
      { kind: "drink", name: "riesling", desc: "mosel, germany" }
    ]
  },
  "S04": {
    dek: "filipino cosmology and our spiritual ancestors",
    intro: [
      "it was only after my grandmother on my dad's side passed that i started to hear about a depth of knowledge she held quietly. here and there, i would hear stories. like how my dad would wake in the night to her hand on his center, whispering something he couldn’t make out. how she would ferry the sick out onto the river when the fog was thick and the night was dark, and immerse them in the healing waters of our precolonial god.",
      "people with all kinds of ailments came from across the baryo to see her before they saw a doctor. it’s been almost ten years since she died, and i’m only just beginning to gather slivers of what she knew and practiced.",
      "the title of the evening, babaylan and the three realms, is a sort of shorthand that refers to our spiritual intercessors and the planes of being that exist beyond the one we ground ourselves in. at 8 pm, on monday october 26, we come together to share in a cosmology that insists the universe is alive with spirit and that all things exist in relationship. i welcome the chance to blur the lines, to remember those who show us to see beyond, and to pull together what’s in between."
    ],
    items: [
      { name: "pu-erh tea smoked duck humba", lines: ["sweet, tangy, savory with star anise. saba banana, tausi (fermented black beans), ginger rice porridge"] },
      { name: "laing atin langka", lines: ["young jackfruit and taro leaves, simmered in coconut milk and chilis"] },
      { name: "tiyula itum", lines: ["tausug black soup. beef simmered with burnt coconut, ginger, turmeric, lemongrass and bird’s eye chilies."] },
      { name: "nasi", alt: "steamed white rice" },
      { kind: "tbd" },
      { kind: "tbd" }
    ]
  },
  "S05": {
    dek: "what we inherit, what we bring forth, our place in time",
    intro: [
      "while our present experiences have us looking to who came before, someday, we’ll be the ones being visited. what people bring and what stories they tell will depend on what we do, create, relate.",
      "we ask: what does it look like to be a good ancestor, especially in this time? what does it mean to decolonize the future? where do rest and fallow seasons fit?",
      "these are big questions without definitive answers. i don’t know what will come up when we ask them together, and that’s part of why i want to.",
      "on monday november 9, at 8 pm, come tell us: what have you received whole that you hope to hand on whole?"
    ],
    items: [
      { name: "kinilaw", alt: "ceviche", lines: ["salmon, mango, red onion, ginger, sugarcane vinegar"] },
      { name: "almusal", alt: "morning meal", lines: ["daing bangus (marinated and fried milkfish), ebun buru (salted duck egg), tomato, onion, rice"] },
      { name: "kare-kare", lines: ["oxtail and brisket, in a toasted rice and peanut sauce with annatto. eggplant, green beans, bokchoy. served with baguk (fermented shrimp paste)"] },
      { name: "nasi", alt: "steamed white rice" },
      { kind: "tbd" },
      { kind: "tbd" }
    ]
  },
  "S06": {
    dek: "love songs",
    intro: [],
    items: [
      { name: "tortang talong", alt: "charred eggplant omelette", lines: ["battered and deep-fried. served with dressed tomato salad."] },
      { name: "pancit dagat", alt: "seafood noodles", lines: ["egg noodles with shrimp, bay scallops, snow peas and green onion in a soy calamansi butter sauce."] },
      { name: "relleno", alt: "stuffed fish", lines: ["ballotine of sea bass, carrot, celery, onion, fish sauce, lemon"] },
      { name: "nasi", alt: "steamed white rice" },
      { name: "buko pie", sub: "a laguna answer to apple pie", lines: ["young coconut, condensed milk, baked in a flaky crust"] },
      { kind: "tbd" },
      { kind: "tbd" }
    ]
  },
  "S07": {
    dek: "west african and taino roots in the puerto rican kitchen · everything is dairy-free",
    intro: [
      "this is what thanksgiving (day of mourning) tastes like in a puerto rican house.",
      "thanksgiving arrived in the diaspora after the united states colonized our islas too. we could not stand the dry bird and the canned sides, so we made the day ours: a cheap turkey rubbed down like a lechón, a day off spent with the people we love, our own music, our own instruments, dominoes slapped down on a folding table. nothing about how we spend it is american except the date. this is a small way we practice resistance.",
      "november 16 is that, for you. look at the ingredients on the table and touch them. the achiote came from my mother’s and my aunt’s garden. dance if you want. sit down at the dominoes table AND PLAY. eat a lot. everything tonight is dairy-free: coconut milk, vegan butter, vegan cheese. this is what our joy and our resilience taste like.",
      "— jazz"
    ],
    items: [
      { name: "plantain chips", lines: ["garlic mojo with lime and lemon."] },
      { name: "tostón cups", lines: ["twice-fried plantain, pico, shrimp a la criolla."] },
      { name: "pavochón with mofongo stuffing", lines: ["turkey seasoned like a whole roast pig, stuffing made of green plantains fried and mashed with garlic, vegan butter, chicharrón and seasonings, carved on banana leaf."] },
      { name: "arroz con gandules", lines: ["rice and pigeon peas, fresh sofrito, achiote oil."] },
      { name: "guineos en escabeche", lines: ["boiled green bananas under pickled onion."] },
      { name: "canoas de plátano", lines: ["sweet plantain boats, picadillo, vegan cheese, dairy-free cilantro-lime crema."] },
      { name: "ensalada de papa", lines: ["potato salad, our way."] },
      { name: "arroz con dulce", lines: ["spiced tea, coconut, rum-soaked raisins."] },
      { kind: "drink", name: "tamarindo", desc: "tamarind pod juice, over ice" },
      { kind: "drink", name: "coquito", desc: "coconut, rum, spice" },
      { kind: "drink", name: "ginger tea", desc: "ginger, cinnamon, clove, star anise" },
      { kind: "drink", name: "cafecito", desc: "brewed in a greca" },
      { kind: "drink", name: "cocktails", desc: "by jiin cruz" }
    ]
  },
  "S08": {
    dek: "an iraqi family dinner from the land between the rivers",
    intro: [
      "a traditional family-style iraqi dinner, built on ingredients native to the region and locally raised lamb.",
      "iraq, the region known as the cradle of agriculture, is home to the earliest written recipes. in a globalized food world, we’re honoring these dishes with a focus on the ingredients that belonged to the land before the colonization of the americas brought tomatoes, peppers and squash to asia and europe.",
      "these recipes are rooted in our shared iraqi lineage, in stories from our elders, and in lala’s childhood in baghdad.",
      "please bring your own bowl for the pacha.",
      "aly lopez leads the kitchen tonight, with support from nubs.",
      "— nubs and lala"
    ],
    items: [
      { name: "dolma", alt: "iraqi style", sub: "known across southwest asia by many names, mahshi and yabragh among them.", lines: ["onions, chard and grape leaves stuffed with spiced rice and herbs, slow-cooked in a sour pomegranate-tamarind lamb broth (or a vegetarian one). the whole pot is flipped over at the table, maqlouba style."] },
      { name: "pacha", sub: "bring your own bowl.", lines: ["a simple iraqi lamb broth."] },
      { name: "iraqi pickles", lines: ["spiced cauliflower (turshi), pink turnips (mukhalal), and amba, pickled mango."] },
      { name: "arugula salad" },
      { name: "saffron panna cotta" },
      { kind: "tbd" },
      { kind: "drink", name: "basra tea", desc: "dried lime" }
    ]
  },
  "S11": {
    dek: "with aly lopez of open hearth gatherings",
    intro: [
      "aly is still shaping this one, so the menu is coming. if you caught her día de los muertos mushroom dinner last year, you know to say yes early."
    ],
    items: [{ kind: "tbd" }]
  }
};
const menuKey = (s) => `${String(s.month || "").toLowerCase()} ${Number(s.day) || s.day}`;

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
// every action is safe to repeat, so a failed or busy request is tried once more before the site shows an error
async function call(action, payload = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await callOnce(action, payload);
      if (res && res.status === "busy" && attempt < 3) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      return res;
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
}
async function callOnce(action, payload) {
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
  openFromHash();
}
// returns false only when the sheet says the token is no longer good
async function loadSessions() {
  let r;
  try { r = await api.listSessions(app.token); } catch { r = { status: "offline" }; }
  if (r.status === "invalid") return false;
  if (r.status === "ok" && r.example) renderExample(r.example);
  app.sessions = (r.sessions || []).map((s) => {
    const past = isPast(s);
    return { ...s, past, status: past ? "past" : s.status, menu: MENUS[s.id] || MENUS[menuKey(s)] || null };
  });
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
  none: "not answered",
  maybe: "maybe",
  yes: "yes · confirm to hold",
  confirmed: "seat confirmed",
  full: "full",
  cancelled: "night cancelled",
  past: "done"
};
// a night counts as past from 5 am the day after (late dinners run past midnight).
// the sheet sends month and day only; the year is whichever puts the night within ~6 months of today.
const PAST_HOUR = 5;
function isPast(s) {
  const m = MONTHS.indexOf(String(s.month).toLowerCase());
  const d = Number(s.day);
  if (m < 0 || !d) return false;
  const now = new Date();
  let y = now.getFullYear();
  const half = 182 * 86400000;
  const at = (yr) => new Date(yr, m, d + 1, PAST_HOUR);
  if (at(y) - now > half) y -= 1;
  else if (now - at(y) > half) y += 1;
  return now >= at(y);
}
// seats left, from the sheet's SEATS minus confirmed guests
const spotsText = (s) => (s.spotsLeft == null || s.status === "cancelled" || s.past ? "" : s.spotsLeft > 0 ? ` · ${s.spotsLeft} of ${s.seats} seats left` : " · full");
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
  if (!app.sessions.length) {
    const li = document.createElement("li");
    li.className = "nights__empty";
    li.textContent = "no mondays are posted yet. dates go up here as hosts set them, so check back soon.";
    list.append(li);
    return;
  }
  const rsvps = (app.guest && app.guest.rsvps) || {};
  app.sessions.forEach((s) => {
    const row = $("#tpl-night").content.firstElementChild.cloneNode(true);
    const when = `${s.dow} ${s.month} ${s.day}`;
    const a = s.amounts || {};
    row.dataset.sessionId = s.id;
    row.dataset.menu = s.menu ? "yes" : "no";
    $('[data-action="open-menu"]', row).setAttribute("aria-label", `see the menu for ${when}, ${s.theme}`);
    $('[data-bind="month"]', row).textContent = s.month;
    $('[data-bind="day"]', row).textContent = s.day;
    $('[data-bind="dow"]', row).textContent = s.dow;
    $('[data-bind="theme"]', row).textContent = s.theme;
    $('[data-bind="meta"]', row).textContent = `${when} · ${s.time || "time tba"} · host · ${s.host}${spotsText(s)}`;
    const amt = $('[data-bind="amounts"]', row);
    amt.textContent = `${money(a.plate)} · ${money(a.half)} · ${money(a.full)}`;
    amt.setAttribute("aria-label", `${money(a.plate)} covers your plate, ${money(a.half)} half the crew's time, ${money(a.full)} everyone paid`);
    $('[data-bind="group-label"]', row).setAttribute("aria-label", `rsvp for ${when}, ${s.theme}`);
    $('[data-bind="pay"]', row).textContent =
      `to hold your seat, venmo any amount with "${s.month} ${s.day} ${firstName(app.guest && app.guest.name)}" in the note, or reply to your reminder email to say you're coming. contributions are welcome and never required; $0 holds a seat the same as any amount.`;
    $('[data-action="venmo-pay"]', row).href = K.venmoUrl;
    const note = (app.guest && app.guest.notes && app.guest.notes[s.id]) || "";
    const noteInput = $('[data-bind="note"]', row);
    noteInput.value = note;
    noteInput.id = `note-${s.id}`;
    $('[data-bind="note-a11y"]', row).setAttribute("for", noteInput.id);
    $('[data-bind="note-label"]', row).textContent = note ? "your note" : "add a note";
    if (s.address) $('[data-bind="where"]', row).textContent = s.address;
    setNightStatus(row, s.status);
    setRowChoice(row, rsvps[s.id]);
    if (s.past) $$('[data-rsvp], [data-action="save-note"], [data-bind="note"]', row).forEach((el) => { el.disabled = true; });
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
  const menuBtn = e.target.closest('[data-action="open-menu"]');
  if (menuBtn) openMenu(menuBtn.closest(".night").dataset.sessionId);
});
// any [data-rsvp-unit] (a night row, the menu card footer) answers for its data-session-id;
// every unit showing that night updates together.
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-rsvp-unit] [data-rsvp]");
  if (!btn || !app.guest) return;
  const unit = btn.closest("[data-rsvp-unit]");
  const id = unit.dataset.sessionId;
  if (app.sessions.some((x) => x.id === id && x.past)) return;
  const value = btn.dataset.rsvp;
  const prev = app.guest.rsvps[id] || null;
  if (prev === value && unit.dataset.state !== "error") return;
  const units = () => $$(`[data-rsvp-unit][data-session-id="${id}"]`);
  const set = (state, msg, choice) => units().forEach((u) => {
    setRowChoice(u, choice);
    u.dataset.state = state;
    const s = $('[data-part="save-status"]', u);
    if (s) s.textContent = msg;
  });
  set("saving", "saving…", value);
  let res; try { res = await api.setRsvp(app.token, id, value); } catch { res = { status: "error" }; }
  if (res.status === "ok") {
    app.guest.rsvps[id] = value;
    const s = app.sessions.find((x) => x.id === id);
    // a confirmed seat only changes when the sheet's VENMO changes; everything else follows the answer
    if (s && !["confirmed", "cancelled", "full", "past"].includes(s.status)) {
      s.status = value === "yes" ? "yes" : value === "maybe" ? "maybe" : "none";
      const row = $(`.night[data-session-id="${id}"]`);
      if (row) setNightStatus(row, s.status);
    }
    set("saved", "saved.", value);
  } else {
    set("error", "that didn't save. tap again?", prev);
  }
});

/* ---------- menu card ---------- */
const menuDlg = $("#menu-card");
const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const menuNights = () => app.sessions.filter((s) => s.menu && s.status !== "cancelled");

/* deep links are keyed by date, not by night: #oct-19 opens whatever is on oct 19 right now
   (its menu, or its row if no menu yet). also reads #october-19, #oct19, #10-19, #2026-10-19.
   a date with nothing on it lands on the mondays list. survives the gate (no reload). */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const slugFor = (s) => `${s.month}-${s.day}`;
const setHash = (h) => history.replaceState(null, "", h ? `#${h}` : location.pathname + location.search);
function dateFromHash(h) {
  let m = h.match(/^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/);
  if (m) return { month: MONTHS[+m[1] - 1], day: String(+m[2]) };
  m = h.match(/^([a-z]{3})[a-z]*[-_ ]?(\d{1,2})$/);
  if (m && MONTHS.includes(m[1])) return { month: m[1], day: String(+m[2]) };
  return null;
}
function openFromHash() {
  const h = decodeURIComponent(location.hash.slice(1)).trim().toLowerCase();
  if (!h || !app.guest || app.role !== "guest" || body.dataset.view !== "letter") return;
  const d = dateFromHash(h);
  if (!d) return;
  const s = app.sessions.find((x) => x.month.toLowerCase() === d.month && String(+x.day) === d.day);
  const target = s ? $(`.night[data-session-id="${s.id}"]`) : $("#mondays");
  if (s && s.menu) { openMenu(s.id); return; }
  if (target) requestAnimationFrame(() => window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - 80));
}
window.addEventListener("hashchange", openFromHash);
function renderMenuItems(list, items) {
  list.innerHTML = "";
  items.forEach((it) => {
    const kind = it.kind || "dish";
    const li = node("li", "menu-item");
    li.dataset.kind = kind;
    if (kind === "tbd") {
      li.append(node("span", "menu-item__tbd", "??"));
      li.firstChild.setAttribute("aria-hidden", "true");
      li.append(node("span", "visually-hidden", "still being worked out"));
    } else if (kind === "drink") {
      const p = node("p", "menu-item__name");
      p.append(node("span", "menu-item__native", it.name), node("span", "menu-item__sep", " // "), node("span", "menu-item__alt", it.desc || ""));
      li.append(p);
    } else {
      const p = node("p", "menu-item__name");
      p.append(node("span", "menu-item__native", it.name));
      if (it.alt) p.append(node("span", "menu-item__alt", ` / ${it.alt}`));
      li.append(p);
      if (it.sub) li.append(node("p", "menu-item__sub", it.sub));
      (it.lines || []).forEach((l) => li.append(node("p", "menu-item__desc", l)));
    }
    list.append(li);
  });
}
function openMenu(id) {
  const s = app.sessions.find((x) => x.id === id);
  if (!s || !s.menu) return;
  const m = s.menu;
  menuDlg.dataset.sessionId = id;
  $("#menu-meta").textContent = `${s.dow} ${s.month} ${s.day} · ${s.time || "time tba"} · host · ${(s.host || "tba").toLowerCase()}`;
  $("#menu-title").textContent = s.theme;
  const dek = $("#menu-dek"); dek.textContent = m.dek || ""; dek.hidden = !m.dek;
  const intro = $("#menu-intro"); intro.innerHTML = "";
  (m.intro || []).forEach((p) => intro.append(node("p", null, p)));
  intro.hidden = !(m.intro && m.intro.length);
  renderMenuItems($("#menu-items"), m.items || []);
  const foot = $("#menu-foot");
  foot.dataset.sessionId = id; foot.dataset.state = "idle";
  foot.dataset.past = s.past ? "yes" : "no";
  $('[data-part="save-status"]', foot).textContent = "";
  $(".rsvp-opts", foot).setAttribute("aria-label", `rsvp for ${s.dow} ${s.month} ${s.day}, ${s.theme}`);
  setRowChoice(foot, (app.guest && app.guest.rsvps[id]) || null);
  const list = menuNights(); const i = list.findIndex((x) => x.id === id);
  const prev = list[i - 1], next = list[i + 1];
  const pb = $("#menu-prev"), nb = $("#menu-next");
  pb.hidden = !prev; nb.hidden = !next;
  if (prev) { pb.textContent = `← ${prev.month} ${prev.day}`; pb.dataset.target = prev.id; pb.setAttribute("aria-label", `menu for ${prev.month} ${prev.day}, ${prev.theme}`); }
  if (next) { nb.textContent = `${next.month} ${next.day} →`; nb.dataset.target = next.id; nb.setAttribute("aria-label", `menu for ${next.month} ${next.day}, ${next.theme}`); }
  $("#menu-scroll").scrollTop = 0;
  setHash(slugFor(s));
  if (!menuDlg.open) menuDlg.showModal();
}
$("#menu-close").addEventListener("click", () => menuDlg.close());
let copyTimer;
$("#menu-copy").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  const s = app.sessions.find((x) => x.id === menuDlg.dataset.sessionId);
  if (!s) return;
  const url = `${location.origin}${location.pathname}#${slugFor(s)}`;
  try { await navigator.clipboard.writeText(url); }
  catch {
    const t = Object.assign(document.createElement("textarea"), { value: url });
    menuDlg.append(t); t.select(); document.execCommand("copy"); t.remove();
  }
  b.dataset.state = "copied";
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => (b.dataset.state = "idle"), 2000);
});
$("#menu-prev").addEventListener("click", (e) => openMenu(e.currentTarget.dataset.target));
$("#menu-next").addEventListener("click", (e) => openMenu(e.currentTarget.dataset.target));
menuDlg.addEventListener("click", (e) => { if (e.target === menuDlg) menuDlg.close(); }); // backdrop click
menuDlg.addEventListener("close", () => {
  setHash("");
  const b = $(`.night[data-session-id="${menuDlg.dataset.sessionId}"] [data-action="open-menu"]`);
  if (b && body.dataset.view === "letter") b.focus({ preventScroll: true });
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
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !confirmDlg.open && !menuDlg.open) closeDrawer(); });

$("#sign-out").addEventListener("click", () => { if (menuDlg.open) menuDlg.close(); clearSession(); app.run++; resetToGate(); });

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
