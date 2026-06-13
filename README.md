# Family Calendar

A simple, free, read-only family planning calendar hosted on **GitHub Pages**. It merges
into one color-coded view:

- **Igor**, **Nataša** — who is where (Germany / Croatia) and work away/busy days
- **Niki** — American International School of Zagreb (AISZ) calendar, 2026–2027 (Grade 11)
- **Shared family events**
- **Germany (Bayern)** and **Croatia** public holidays — added automatically

No backend, no login, no cost. Holidays come live from the free
[Nager.Date](https://date.nager.at) API. Everything else lives in `data/events.json`.

## How to view it

Open `index.html` — locally with a small web server, or via your GitHub Pages URL.

> The page loads `data/*.json` with `fetch`, which browsers block from `file://`.
> So **don't** just double-click `index.html`. Use one of these:

**Local preview (pick one):**

```powershell
# Python
python -m http.server 8000
# then open http://localhost:8000

# or Node
npx serve .
```

In VS Code you can also use the **Live Server** extension.

## How to publish on GitHub Pages

1. Create a GitHub repo and push these files.
2. Repo → **Settings → Pages**.
3. Under **Build and deployment**, set **Source = Deploy from a branch**,
   **Branch = main / (root)**, save.
4. After a minute the site is live at `https://<user>.github.io/<repo>/`.

## How to add or change events

You can edit live in the browser, or edit the shared file directly.

### Option A — Live editing in the browser (easiest, works on phone)

- **Add:** fill in **Add event** in the sidebar and press **Add event**. It appears on the
  calendar immediately.
- **Edit / delete:** **click any event** on the calendar. The form fills in with its
  details. Change it and press **Save changes**, or press **Delete** to remove it.
  (Public holidays are auto-fetched and can't be edited.)

> **Important:** live edits are saved in **this browser only** (via `localStorage`).
> They do **not** automatically appear on your husband's phone or another device, and
> they're lost if you clear the browser's data. To make changes permanent and shared,
> use the **Export** step below.

### Option B — Share changes across devices (Export → commit)

1. In the sidebar press **Export all events**.
2. Press **Copy to clipboard**.
3. Open `data/events.json` on GitHub (open the file → pencil icon to edit).
4. Select all and replace the contents with what you copied.
5. Commit. Now everyone who opens the site sees the same events.

### Option C — Edit `data/events.json` directly

Each event looks like this:

```json
{ "id": "fam-2026-08-22", "title": "Family trip", "category": "family",
  "person": "igor", "start": "2026-08-22", "end": "2026-08-24", "allDay": true,
  "location": "HR", "note": "optional detail" }
```

Field notes:

- `category` — one of `school`, `family`, `location`, `work` (see `data/config.json`).
- `person` — `igor`, `natasa`, or `niki` (optional; person color overrides category color).
- `start` — `YYYY-MM-DD`.
- `end` — **optional and inclusive**: the actual last day of the event. A trip Aug 22–24
  uses `"end": "2026-08-24"`. (The on-page form takes the same inclusive end.)
- `location` — `DE` or `HR`, only for `category: "location"`. These render as a soft
  background band across the days.

## Changing people, colors, or holiday region

Edit `data/config.json`:

- `people` — names and colors.
- `holidays.germany.subdivision` — currently `DE-BY` (Bayern). Change for another
  Bundesland (e.g. `DE-NW` for NRW).
- `locations` — background colors for Germany / Croatia.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page structure |
| `styles.css` | Styling / responsive layout |
| `app.js` | Loads data, fetches holidays, renders calendar, runs the form |
| `data/config.json` | People, categories, colors, holiday region |
| `data/events.json` | All hand-entered events (incl. AISZ school year) |

## Notes

- Holidays are fetched for the years 2026 and 2027. To extend, edit `HOLIDAY_YEARS`
  in `app.js`.
- The school calendar is pre-loaded from the AISZ 2026–2027 outline, including the
  **Grade 11 Unity Trip (Sep 5–13)**, all breaks, no-school days, half-days, and
  semester boundaries.
