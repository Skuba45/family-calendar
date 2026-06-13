/* Family Calendar — static GitHub Pages app
   Loads config + events, fetches DE(Bayern)/HR holidays, renders a
   merged, filterable calendar, and provides an add-event JSON helper. */

const HOLIDAY_YEARS = [2026, 2027];
const state = {
  config: null,
  fileEvents: [], // events loaded from Supabase
  seedEvents: [], // data/events.json, used to seed an empty table
  manualEvents: [], // FullCalendar-ready events
  holidayEvents: [],
  filters: {}, // key -> boolean
};

let sb = null; // Supabase client

const $ = (sel) => document.querySelector(sel);

/* ---------- Supabase persistence (shared across everyone) ---------- */
function initSupabase() {
  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    throw new Error("Supabase is not configured (check supabase-config.js).");
  }
  sb = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
  );
}

// Map a database row to the app's event shape.
function dbToEvent(r) {
  const e = {
    id: r.id,
    title: r.title,
    category: r.category,
    start: r.start,
    allDay: r.all_day !== false,
  };
  if (r.person) e.person = r.person;
  if (r.end) e.end = r.end;
  if (r.location) e.location = r.location;
  if (r.note) e.note = r.note;
  return e;
}

// Map an app event to a database row.
function eventToDb(e) {
  return {
    id: e.id,
    title: e.title,
    category: e.category || null,
    person: e.person || null,
    start: e.start,
    end: e.end || null,
    all_day: e.allDay !== false,
    location: e.location || null,
    note: e.note || null,
  };
}

// Load all events from Supabase; seed the table from events.json if empty.
async function loadEvents() {
  const { data, error } = await sb.from("events").select("*").order("start");
  if (error) throw error;
  let rows = data || [];
  if (rows.length === 0 && state.seedEvents.length) {
    const seed = state.seedEvents.map(eventToDb);
    const { error: seedErr } = await sb.from("events").insert(seed);
    if (seedErr) console.warn("Seeding failed", seedErr);
    else rows = seed;
  }
  state.fileEvents = rows.map(dbToEvent);
}

function getRawEvents() {
  return state.fileEvents;
}

function rebuildManualEvents() {
  state.manualEvents = buildManualEvents(state.config, getRawEvents());
  if (window.calendar) window.calendar.refetchEvents();
}

// Insert or update an event locally, then sync to Supabase.
async function saveEventObj(evt) {
  const existing = state.fileEvents.findIndex((e) => e.id === evt.id);
  if (existing >= 0) state.fileEvents[existing] = evt;
  else state.fileEvents.push(evt);
  rebuildManualEvents();
  const { error } = await sb.from("events").upsert(eventToDb(evt));
  if (error) {
    console.error(error);
    $("#status").textContent = `Could not save: ${error.message}`;
  }
}

// Delete an event locally and in Supabase.
async function deleteEventById(id) {
  state.fileEvents = state.fileEvents.filter((e) => e.id !== id);
  rebuildManualEvents();
  const { error } = await sb.from("events").delete().eq("id", id);
  if (error) {
    console.error(error);
    $("#status").textContent = `Could not delete: ${error.message}`;
  }
}

// Refresh from Supabase when another device changes data (needs Realtime on).
function subscribeRealtime() {
  try {
    sb.channel("events-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        async () => {
          await loadEvents();
          rebuildManualEvents();
          updateStatusCount();
        }
      )
      .subscribe();
  } catch (e) {
    console.warn("Realtime subscription failed", e);
  }
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

/* ---------- Holidays (Nager.Date) ---------- */
async function fetchHolidays(config) {
  const out = [];
  const { germany, croatia } = config.holidays;

  for (const year of HOLIDAY_YEARS) {
    // Germany — filter to the configured subdivision (DE-BY) + national.
    try {
      const de = await loadJSON(
        `https://date.nager.at/api/v3/PublicHolidays/${year}/${germany.countryCode}`
      );
      de.filter(
        (h) => !h.counties || h.counties.includes(germany.subdivision)
      ).forEach((h) =>
        out.push(holidayEvent(h, "hol-de", germany.color, germany.name))
      );
    } catch (e) {
      console.warn("Germany holidays failed", year, e);
    }

    // Extra Germany/Bavaria holidays the API omits (e.g. Mariä Himmelfahrt,
    // which Nager.Date only lists for Saarland).
    (germany.extraHolidays || []).forEach((ex) => {
      const date = `${year}-${String(ex.month).padStart(2, "0")}-${String(
        ex.day
      ).padStart(2, "0")}`;
      out.push(
        holidayEvent(
          { date, localName: ex.localName, name: ex.name },
          "hol-de",
          germany.color,
          germany.name
        )
      );
    });

    // Croatia — all national holidays.
    try {
      const hr = await loadJSON(
        `https://date.nager.at/api/v3/PublicHolidays/${year}/${croatia.countryCode}`
      );
      hr.forEach((h) =>
        out.push(holidayEvent(h, "hol-hr", croatia.color, croatia.name))
      );
    } catch (e) {
      console.warn("Croatia holidays failed", year, e);
    }
  }
  return out;
}

function holidayEvent(h, layerKey, color, layerName) {
  return {
    id: `${layerKey}-${h.date}`,
    title: h.localName,
    start: h.date,
    allDay: true,
    backgroundColor: color,
    borderColor: color,
    extendedProps: { layerKey, layerName, note: h.name },
  };
}

/* ---------- Manual events -> FullCalendar events ---------- */
function buildManualEvents(config, events) {
  const peopleById = Object.fromEntries(config.people.map((p) => [p.id, p]));
  const catById = Object.fromEntries(config.categories.map((c) => [c.id, c]));

  return events.map((ev) => {
    const cat = catById[ev.category];
    const person = ev.person ? peopleById[ev.person] : null;
    // Person color wins when set; otherwise category color.
    const color = (person && person.color) || (cat && cat.color) || "#607d8b";
    const isLocation = ev.category === "location";

    const fcEvent = {
      id: ev.id,
      title: ev.title,
      start: ev.start,
      allDay: ev.allDay !== false,
      extendedProps: {
        layerKey: `cat-${ev.category}`,
        personKey: ev.person ? `person-${ev.person}` : null,
        note: ev.note || "",
      },
    };
    // Stored end is the inclusive last day; FullCalendar all-day end is
    // EXCLUSIVE, so add one day when handing it to the calendar.
    if (ev.end) fcEvent.end = ev.allDay !== false ? addDays(ev.end, 1) : ev.end;

    if (isLocation) {
      const loc = ev.location && config.locations[ev.location];
      const bg = (loc && loc.color) || "#cfd8dc";
      fcEvent.display = "background";
      fcEvent.backgroundColor = bg;
    } else {
      fcEvent.backgroundColor = color;
      fcEvent.borderColor = color;
    }
    return fcEvent;
  });
}

/* ---------- Filtering ---------- */
function isVisible(ev) {
  const p = ev.extendedProps || {};
  if (p.layerKey && state.filters[p.layerKey] === false) return false;
  if (p.personKey && state.filters[p.personKey] === false) return false;
  return true;
}

function visibleEvents() {
  return [...state.manualEvents, ...state.holidayEvents].filter(isVisible);
}

/* ---------- Filter UI ---------- */
function buildFilters(config) {
  const container = $("#filters");
  container.innerHTML = "";

  const addGroup = (title) => {
    const h = document.createElement("div");
    h.className = "filter-group-title";
    h.textContent = title;
    container.appendChild(h);
  };

  const addToggle = (key, label, color) => {
    state.filters[key] = true;
    const lbl = document.createElement("label");
    lbl.className = "filter-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.addEventListener("change", () => {
      state.filters[key] = cb.checked;
      window.calendar.refetchEvents();
    });
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = color;
    const text = document.createElement("span");
    text.textContent = label;
    lbl.append(cb, sw, text);
    container.appendChild(lbl);
  };

  addGroup("People");
  config.people.forEach((p) => addToggle(`person-${p.id}`, p.name, p.color));

  addGroup("Categories");
  config.categories.forEach((c) => addToggle(`cat-${c.id}`, c.name, c.color));

  addGroup("Public holidays");
  addToggle("hol-de", config.holidays.germany.name, config.holidays.germany.color);
  addToggle("hol-hr", config.holidays.croatia.name, config.holidays.croatia.color);
}

/* ---------- Add / edit event form ---------- */
function resetForm() {
  $("#add-form").reset();
  $("#f-id").value = "";
  if (state.fpStart) state.fpStart.clear();
  if (state.fpEnd) state.fpEnd.clear();
  $("#form-title").textContent = "Add event";
  $("#save-btn").textContent = "Add event";
  $("#delete-btn").hidden = true;
  $("#cancel-btn").hidden = true;
  toggleLocationField();
}

function toggleLocationField() {
  const cat = $("#f-category").value;
  const isLocation = cat === "location";
  $("#f-location-wrap").style.display = isLocation ? "flex" : "none";
  // For "Who is where", the title is generated automatically.
  $("#f-title-wrap").style.display = isLocation ? "none" : "flex";
}

// Build the auto title for a "Who is where" event: "<person> in <location>".
function locationTitle(config, personId, locationCode) {
  const ids = personId ? personId.split(",") : [];
  const names = ids.map((id) => {
    const p = config.people.find((x) => x.id === id);
    return p ? p.name : id;
  });
  const who = names.length ? names.join(" & ") : "Someone";
  const loc = config.locations[locationCode];
  const where = loc ? loc.label : locationCode;
  return `${who} in ${where}`;
}

/* Open the form pre-filled to edit an existing event. */
function openEditor(raw) {
  $("#f-id").value = raw.id;
  $("#f-title").value = raw.title || "";
  $("#f-category").value = raw.category || "";
  $("#f-person").value = raw.person || "";
  if (state.fpStart) state.fpStart.setDate(raw.start || null, true);
  else $("#f-start").value = raw.start || "";
  // Stored end is already the inclusive last day.
  if (state.fpEnd) state.fpEnd.setDate(raw.end || null, true);
  else $("#f-end").value = raw.end || "";
  $("#f-location").value = raw.location || "";
  $("#f-note").value = raw.note || "";
  toggleLocationField();
  $("#form-title").textContent = "Edit event";
  $("#save-btn").textContent = "Save changes";
  $("#delete-btn").hidden = false;
  $("#cancel-btn").hidden = false;
  $("#add-form").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setupForm(config) {
  const catSel = $("#f-category");
  config.categories.forEach((c) => {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name;
    catSel.appendChild(o);
  });

  const personSel = $("#f-person");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— none —";
  personSel.appendChild(none);
  config.people.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    personSel.appendChild(o);
  });
  // Combined option so an event can cover both parents at once.
  const both = document.createElement("option");
  both.value = "igor,natasa";
  both.textContent = "Igor & Nataša";
  personSel.appendChild(both);

  catSel.addEventListener("change", toggleLocationField);
  toggleLocationField();

  // Date pickers: DD.MM.YYYY display, Monday-first week. The underlying input
  // keeps the YYYY-MM-DD value so the rest of the code is unchanged.
  if (window.flatpickr) {
    const fpOpts = {
      dateFormat: "Y-m-d",
      altInput: true,
      altFormat: "d.m.Y",
      allowInput: true,
      locale: { firstDayOfWeek: 1 },
    };
    state.fpStart = flatpickr("#f-start", fpOpts);
    state.fpEnd = flatpickr("#f-end", fpOpts);
  }

  $("#add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = $("#f-id").value;
    const category = catSel.value;
    const person = personSel.value;
    const start = $("#f-start").value;
    const endInput = $("#f-end").value;
    const note = $("#f-note").value.trim();
    const location = $("#f-location").value;
    // "Who is where" gets an auto title; everything else uses the typed title.
    const title =
      category === "location"
        ? locationTitle(config, person, location)
        : $("#f-title").value.trim();

    if (category !== "location" && !title) {
      $("#f-title").focus();
      return;
    }

    const obj = {
      id: id || `${category}-${start}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      category,
    };
    if (person) obj.person = person;
    obj.start = start;
    // Store the end as the inclusive last day (what the user typed).
    if (endInput) obj.end = endInput;
    obj.allDay = true;
    if (category === "location" && location) obj.location = location;
    if (note) obj.note = note;

    saveEventObj(obj);
    resetForm();
    updateStatusCount();
    // Jump the calendar to the new/edited event so it's visible.
    if (window.calendar && obj.start) window.calendar.gotoDate(obj.start);
  });

  $("#cancel-btn").addEventListener("click", resetForm);

  $("#delete-btn").addEventListener("click", () => {
    const id = $("#f-id").value;
    if (id && confirm("Delete this event?")) {
      deleteEventById(id);
      resetForm();
      updateStatusCount();
    }
  });

  setupExport();
}

/* ---------- Export (share across devices) ---------- */
function setupExport() {
  $("#export-btn").addEventListener("click", () => {
    const data = { events: getRawEvents() };
    $("#export-json").value = JSON.stringify(data, null, 2);
    $("#export-output").hidden = false;
  });

  $("#copy-export-btn").addEventListener("click", async () => {
    const ta = $("#export-json");
    try {
      await navigator.clipboard.writeText(ta.value);
      $("#copy-export-btn").textContent = "Copied!";
      setTimeout(() => ($("#copy-export-btn").textContent = "Copy to clipboard"), 1500);
    } catch {
      ta.select();
      document.execCommand("copy");
    }
  });
}

function updateStatusCount() {
  $("#status").textContent = `Loaded ${state.manualEvents.length} events + ${state.holidayEvents.length} holidays.`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Format a FullCalendar date as DD.MM.YYYY.
function ddmmyyyy(arg) {
  const d = arg.date;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.day)}.${pad(d.month + 1)}.${d.year}`;
}

/* ---------- Init ---------- */
async function init() {
  const status = $("#status");
  try {
    status.textContent = "Loading events…";
    const [config, eventsData] = await Promise.all([
      loadJSON("data/config.json"),
      loadJSON("data/events.json"),
    ]);
    state.config = config;
    state.seedEvents = eventsData.events || [];
    initSupabase();
    await loadEvents();
    state.manualEvents = buildManualEvents(config, getRawEvents());

    buildFilters(config);
    setupForm(config);

    window.calendar = new FullCalendar.Calendar($("#calendar"), {
      initialView: "dayGridMonth",
      initialDate: "2026-08-01",
      firstDay: 1,
      height: "auto",
      titleFormat: { year: "numeric", month: "long" },
      views: {
        listMonth: {
          listDayFormat: ddmmyyyy,
          listDaySideFormat: { weekday: "long" },
        },
      },
      headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,listMonth",
      },
      events: (info, success) => success(visibleEvents()),
      eventDidMount: (arg) => {
        const note = arg.event.extendedProps.note;
        if (note) arg.el.setAttribute("title", note);
      },
      eventClick: (arg) => {
        const id = arg.event.id;
        // Holidays are auto-fetched and not editable.
        if (id.startsWith("hol-")) return;
        const raw = getRawEvents().find((e) => e.id === id);
        if (raw) {
          arg.jsEvent.preventDefault();
          openEditor(raw);
        }
      },
    });
    window.calendar.render();

    status.textContent = "Loading public holidays…";
    state.holidayEvents = await fetchHolidays(config);
    window.calendar.refetchEvents();
    status.textContent = `Loaded ${state.manualEvents.length} events + ${state.holidayEvents.length} holidays.`;
    subscribeRealtime();
  } catch (err) {
    console.error(err);
    status.textContent = `Error: ${err.message}`;
  }
}

init();
