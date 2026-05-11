# Feature catalog — main app (frontend/apps/main)

Living catalog of user-visible behaviors, in BDD-ish "Role / Given / When / Then" form. Scope: `frontend/apps/main` only (technician + lead + admin app). The separate `labeling` PWA is out of scope here.

Notes:
- Roles: `admin`, `lead_technician`, `technician`, `viewer`, `partner`. `lead_or_admin` is used as shorthand where both qualify.
- Shift status: `INVITING → READY_TO_START → IN_PROGRESS → CLOSE_REQUESTED → READY_TO_COMMIT → COMMITTED` (or `CANCELLED`).
- Participant status: `INVITED → CACHE_READY → CLOSE_CONFIRMED` (or `DECLINED`). `ACCEPTED` was collapsed away on `remove-accepted-participant-state`.
- Maintenance work status: `IN_PROGRESS → FINISHED | ABORTED`.
- Verified against the current branch's pages and `backend/src/main.rs` route table. Open questions marked with **?**.

---

## A. Authentication & session

### A1 — Unauthenticated user lands on protected route
- Given: no session cookie
- When: user navigates to any path under `/` (other than `/login`)
- Then: redirect to `/login`, preserve original path in router state (`location.state.from`), restore after login

### A2 — Authenticated user lands on login page
- Given: valid session cookie
- When: user navigates to `/login`
- Then: redirect to original path (`location.state.from.pathname`) or `/home`

### A3 — Login with Google
- Given: user on `/login`, valid Google client ID configured
- When: user completes Google sign-in
- Then: backend `POST /auth/google` issues session cookie; toast "Sikeres bejelentkezés."; redirect per A2

### A4 — Login failure
- Given: user on `/login`
- When: Google credential is rejected by backend
- Then: error toast with the backend's error message (or "Sikertelen Google bejelentkezés.")

### A5 — Google script fails to load
- Given: user on `/login`, network blocks Google sign-in script
- When: script load errors
- Then: toast "A Google bejelentkezési script nem tölthető be."

### A6 — Logout
- Given: any authenticated user
- When: user opens header avatar menu → "Kijelentkezés"
- Then: `clearUser()` runs, session cookie invalidated, redirect to `/login`

### A7 — Session bootstrap pending
- Given: hydration in progress on page load
- When: a guarded route is rendered
- Then: full-page centered spinner (no redirect until hydration finishes)

---

## B. Navigation & layout

### B1 — Logo navigates home
- Role: any authenticated user
- When: user clicks the NoMa logo in the header
- Then: navigate to `/home`

### B2 — Header is sticky
- Given: any page with `<Layout>` wrapper
- Then: header stays pinned during scroll (`position: sticky; top: 0`)

### B3 — Drawer toggle visibility
- When: user is `lead_or_admin` in admin view, OR viewport ≥ md outside admin view
- Then: hamburger button is visible; otherwise hidden

### B4 — Side drawer (non-admin view)
- Given: drawer opened on `/home`/`/shifts/current`/etc.
- Then: list shows "Műszak", "Karbantartás", "Munka indítása"/"Munka folytatása", plus "Munkalapok" with badge if `lead_or_admin`

### B5 — Side drawer (admin view)
- Given: drawer opened inside `/admin/*`
- Then: shows "Műszakok", "Berendezések", "Felhasználók"

### B6 — Toggle Admin ↔ Technician view
- Role: `lead_or_admin`
- When: user clicks "Admin nézet" / "Karbantartói nézet" in header menu
- Then: navigate to `/admin/shifts` ↔ `/home`

### B7 — Pending worksheets badge auto-refresh
- Role: `lead_or_admin`
- When: any page is open
- Then: `/api/shifts/pending` polled every 30s; drawer badge shows count

### B8 — Bottom-bar (mobile only) on shift pages
- Given: user has an active shift access AND on `/shifts/current` or `/shifts/current/maintenances`
- Then: sticky bottom bar shows: Műszak link, FAB (scan or resume), Karbantartás link
- Note: bottom bar is hidden on `xs/sm` on other pages and always on md+

### B9 — FAB icon & target
- When: a maintenance work is in progress and editable by the current user
- Then: FAB shows ▶ Play icon, links to `/maintenance/:workId`
- Otherwise: FAB shows scan-barcode icon, links to `/new-maintenance`

### B10 — FAB disabled state
- Given: no active work AND shift `status === CLOSE_REQUESTED`
- Then: FAB is rendered as a non-link div with opacity 0.45

### B11 — Page enter animation
- When: route changes
- Then: main content runs `fadeIn` + `slideUp` 220ms; user can disable via reduced-motion (?) — **? not implemented today**

### B12 — Not-found route
- When: user visits a path that matches no defined route
- Then: render `NotFound` page (no redirect)

---

## C. Home page (`/home`)

### C1 — No active shift, non-lead
- Role: `technician`/`viewer`/`partner`
- Given: no current shift
- Then: card "Nincs aktív műszak" with explanatory subtext, NO "Új műszak indítása" button

### C2 — No active shift, lead/admin
- Role: `lead_or_admin`
- Given: no current shift
- Then: card with "Új műszak indítása" button that routes to `/shifts/start`

### C3 — Existing shift summary card (non-invited)
- Given: current shift exists, user's participant_status ≠ `INVITED`
- When: user clicks the card
- Then: navigate to `/shifts/current`

### C4 — Existing shift card status labels
- Then: subtitle text varies by `my_participant_status`:
  - INVITED → "Meghívást kapott egy műszakhoz."
  - CACHE_READY → "A műszak előkészítése kész."
  - DECLINED → "A műszak meghívása elutasítva."
  - CLOSE_CONFIRMED → "A műszak lezárása megerősítve."

### C5 — Accept invitation
- Given: card showing `INVITED` state
- When: user clicks "Elfogadás"
- Then: client first rebuilds the building snapshot in IndexedDB (cache), then `POST /api/shifts/:id/join-ready`, then refreshes shift state
- Failure: inline error alert with backend message

### C6 — Decline invitation
- Given: same as C5
- When: user clicks "Elutasítás"
- Then: `POST /api/shifts/:id/decline`, refresh shift state

### C7 — Invitation buttons mutex
- Given: an accept or decline action is in-flight
- Then: both buttons are disabled; clicked one shows progress label ("Elfogadás...", "Elutasítás...")

### C8 — Pending worksheets card (lead/admin only)
- Role: `lead_or_admin`
- Then: second card showing live count from `/api/shifts/pending`; clicking navigates to `/pending-worksheets`
- Count text: 0 → "Nincs aláírandó munkalap.", 1 → "1 műszak munkalapja vár aláírásra.", N → "N műszak munkalapja vár aláírásra.", null → "Betöltés..."

### C9 — Pending worksheets card hidden for technicians
- Role: `technician`/`viewer`/`partner`
- Then: card is not rendered at all

---

## D. Starting a shift (`/shifts/start`)

### D1 — Page access
- Role: `lead_or_admin` only (technicians redirected to `/home` by `RequireRoles`)

### D2 — Initial load
- When: page mounts
- Then: `GET /api/labeling/buildings`; first building auto-selected
- Failure: alert with backend error

### D3 — Building selector
- Then: autocomplete labeled "Épület kiválasztása", option text `"<name> (<address>)"`

### D4 — Create shift, happy path
- Given: building selected
- When: user clicks "Műszak létrehozása"
- Then: prune non-retryable maintenance sync items → rebuild IndexedDB snapshot of building → `POST /api/shifts {building_id}` → on success, store admin-devices state for the building → refresh current shift → navigate to `/shifts/current`

### D5 — Create shift loading state
- Then: while preparing, show spinner + "Műszak előkészítése folyamatban..." and the explanatory copy "Várunk, amíg az épület eszközei gyorsítótárba kerülnek, és a műszakvezető cache állapota elkészül."

### D6 — Missing tenant id
- Given: user object lacks `tenantId` (anomalous state)
- When: user clicks create
- Then: error "Hiányzik a tenant azonosító, ezért a műszak nem készíthető elő."

### D7 — Backend rejects create
- When: `POST /api/shifts` 4xx/5xx
- Then: error alert with backend error text (or "Nem sikerült létrehozni a műszakot.")

### D8 — Lead is sole participant initially
- Then: helper text "A műszak létrehozásakor csak a műszakvezető kerül a résztvevők közé."
- Behavior: created shift has exactly one participant — the lead

---

## E. Current shift (`/shifts/current`)

### E1 — Page access
- Given: `hasActiveShiftAccess(currentShift)` true
- Otherwise: redirect to `/home`

### E2 — Initial load
- When: page mounts
- Then: read cached payload from `localStorage` key `noma:shift-details:<userId>` (instant), then `GET /api/shifts/:id/waiting-room` to refresh
- Failure with cache available: keep showing the cached payload, no error
- Failure with no cache: error alert

### E3 — Building header
- Then: shows building name + building address

### E4 — Participants list order
- Then: lead is always first; everyone else sorted by `full_name` using `localeCompare("hu-HU")`

### E5 — Participant status icons
- INVITED → spinning loader icon (waiting)
- DECLINED → red X icon
- CLOSE_CONFIRMED + shift in `CLOSE_REQUESTED`/`READY_TO_COMMIT` → green check
- Other in CLOSE_REQUESTED/READY_TO_COMMIT → grey cloud-upload

### E6 — Lead crown
- Then: lead participant shown with HardHat icon, bold primary-colored name, "Műszakvezető" caption

### E7 — Call participant
- Given: participant has phone_number (or is lead with `lead_user_phone`)
- Then: phone icon → `tel:` link

### E8 — Reinvite declined participant
- Role: shift lead
- Given: participant `status === DECLINED` AND shift `status !== CLOSE_REQUESTED`
- When: user clicks the Repeat icon
- Then: `POST /api/shifts/:id/participants {user_id}` → refresh payload

### E9 — Remove participant
- Role: shift lead
- Given: shift `status === READY_TO_START` AND participant is not the lead
- When: user clicks the trash icon
- Then: `DELETE /api/shifts/:id/participants/:userId` → refresh
- Constraint: removal is only possible before the shift starts

### E10 — Reinvite/Remove during in-flight action
- Then: while any participant action is in flight, all reinvite/remove icons disabled; the active row shows "(újrahívás...)" or "(eltávolítás...)" suffix

### E11 — "Résztvevő hozzáadása" button
- Role: shift lead only
- Then: button visible at the bottom of the participants list
- Disabled if: offline OR an add/cancel action is in-flight

### E12 — Add participant dialog
- When: user clicks "Résztvevő hozzáadása"
- Then: dialog opens, `GET /api/users/invite-candidates` populates an autocomplete
- Filter rule: hide users already listed in the shift's non-`DECLINED` participants (the lead is also excluded server-side — confirm? **?**)

### E13 — Submit add participant
- When: user picks a candidate and clicks "Hozzáadás"
- Then: `POST /api/shifts/:id/participants {user_id}` → close dialog → refresh
- Failure: keep dialog open, toast error

### E14 — Add participant offline
- Given: `navigator.onLine === false`
- When: user opens dialog or clicks Hozzáadás
- Then: toast "A backend jelenleg nem elérhető, ezért a művelet nem hajtható végre."

### E15 — Cancel shift action
- Role: shift lead only
- Given: shift exists (any non-terminal status)
- When: user opens "⋮" menu → "Műszak megszakítása" → confirms dialog
- Then: `POST /api/shifts/:id/cancel` → success toast → navigate to `/home`
- Dialog copy: "Biztosan meg akarod szakítani a jelenlegi műszakot? Megszakítás esetén minden, a műszakhoz kapcsolódó adat el fog veszni."

### E16 — Reload building cache
- Role: any participant
- When: user opens "⋮" menu → "Berendezés adatok újratöltése"
- Then: prune non-retryable sync items → rebuild snapshot → toast "Berendezés adatok sikeresen újratöltve."
- Offline: toast offline message; action disabled while in flight

### E17 — Close-request button
- Role: shift lead
- Given: shift `status === IN_PROGRESS`
- Then: full-width "Műszak lezárása" button visible
- When: clicked → confirmation dialog "Ha lezárod a műszakot, utána új karbantartás már nem indítható." → confirm → `POST /api/shifts/:id/close-request` → refresh

### E18 — Close-request waiting state
- Given: shift `status === CLOSE_REQUESTED` AND not all non-declined participants have status `CLOSE_CONFIRMED`
- Then: info alert "A műszak lezárása folyamatban van. A műszak összegzéséhez minden résztvevő alkalmazásának szinkronizálnia kell. Új karbantartás nem kezdeményezhető."

### E19 — Shift summary button
- Role: shift lead
- Given: all non-declined participants `CLOSE_CONFIRMED` (shift effectively READY_TO_COMMIT)
- Then: full-width "Műszak összegzése" button visible → navigates to `/shift-summary`

### E20 — SSE participant updates
- Given: page open, browser online
- When: backend pushes `participants-updated` event on `/api/shifts/:id/events`
- Then: page refreshes both `currentShift` and the waiting-room payload (single-flight guarded)

### E21 — Online/offline tracking
- Then: `navigator.onLine` is reflected in actions; SSE reconnect re-triggers when going back online
- Actions menu disabled while offline

---

## F. New maintenance / barcode scan (`/new-maintenance`)

### F1 — Page access
- Gated by `RequireActiveShift` AND `RequireMaintenanceStartAllowed` (i.e. shift status ≠ `CLOSE_REQUESTED`)
- If shift is `CLOSE_REQUESTED`: redirect to `/shifts/current`

### F2 — Default view = camera scanner open
- When: page mounts
- Then: fullscreen scanner dialog opens; camera starts after rAF; "Kamera indítása..." spinner overlays

### F3 — Camera error
- Then: red banner near bottom with error text; auto-clears after 5s

### F4 — Toggle flashlight
- Given: device reports flashlight support
- Then: button enabled; otherwise disabled and tinted muted

### F5 — Switch to manual entry
- When: user clicks the keyboard icon (or "Inkább vonalkód-olvasót használok" toggle on manual page)
- Then: scanner stops, manual entry card visible with subsequence-match autocomplete over the building's valid barcodes

### F6 — Scan happy path (new device)
- When: scanner detects a NoMa-valid barcode that exists in the cached building AND no prior maintenance exists for it
- Then: `startMaintenance(identifier)` → toasts "Beolvasva: X" + "Karbantartás elindítva!" → navigate to `/maintenance/:workId`

### F7 — Scan, device already maintained in this shift
- When: scanner detects valid barcode AND a prior maintenance exists for that device (today's or past)
- Then: toast "Ehhez az eszközhöz már van rögzített karbantartás, annak adatlapja nyílik meg." → navigate to that maintenance's detail page

### F8 — Scan invalid barcode (not NoMa)
- When: scanner detects a code that fails `validateNomaBarcode`
- Then: scanner reports failure to user (in the scanner overlay error path) — no maintenance started

### F9 — Scan unknown barcode (NoMa-valid but not in this building's cache)
- Then: scanner failure: "A beolvasott vonalkód nincs hozzárendelve eszközhöz ebben az épületben."

### F10 — Scan with stale cache
- Given: env var `VITE_REFRESH_CACHE_ON_SCAN === "true"`
- When: scanner opens
- Then: silently re-prune sync items + rebuild snapshot + reload barcode options (errors swallowed — user not blocked)

### F11 — Manual entry happy path
- When: user types/picks a valid barcode and clicks "Karbantartás megkezdése"
- Then: same as F6/F7 by branch

### F12 — Manual entry empty
- Given: empty input
- When: user clicks start
- Then: toast "Kérjük, adjon meg vagy olvasson be egy azonosítót"

### F13 — Manual entry unknown barcode
- Then: toast "A megadott vonalkód nincs hozzárendelve eszközhöz ebben az épületben."

### F14 — Manual entry cache miss
- Given: `startMaintenance` returns no work id (snapshot lacks the device)
- Then: toast "A megadott vonalkódhoz nem található gyorsítótárazott eszközadat."

### F15 — Back button
- When: user clicks ◀ in scanner header or manual page header
- Then: navigate back in history

---

## G. Maintenance detail (`/maintenance/:workId`)

### G1 — Work not found
- Then: render "A munka nem található" with "Vissza a kezdőlapra" link

### G2 — Read-only view (other user's in-progress work)
- Given: `work.status === "in-progress"` AND `user.id !== work.executorId`
- Then: all inputs disabled; no Complete/Abort/Edit buttons; meatballs menu hidden

### G3 — Read-only view (completed)
- Given: `work.status === "completed"`
- Then: inputs disabled by default; only the executor sees the "Utólagos szerkesztés" option in the menu (and only while `workdayClosed === false`)

### G4 — Maintenance kind toggle
- Then: ROUTINE/SERVICE toggle group; choosing SERVICE reveals the "Igénylési szám" text field
- Tooltip on info icon: "Az igénylési számot a megbízótól kapott bejelentő emailben találod. Q123456"

### G5 — Issue number required when SERVICE
- Given: kind === SERVICE
- When: user clicks "Karbantartás befejezése" with empty issue number
- Then: toast "Szervíz esetén az igénylési szám megadása kötelező."

### G6 — Follow-up service switch
- When: user toggles "További szervíz szükséges"
- Then: reasons section appears; user can pick from `ROUTINE`/`MEMBRANE`/`COIL`/etc. (`followupServiceReasonOrder` minus OTHER) plus an "Egyéb" button
- If OTHER selected: free-text field "Egyéb ok" required

### G7 — Follow-up service unset clears requirements
- When: user toggles the switch off
- Then: no reasons required for completion; UI hides reasons panel

### G8 — Notes field
- Then: multiline textarea, autoComplete/autoCorrect/autoCapitalize/spellCheck all off, minRows 4, maxRows 10
- Note: this was the workaround for a longtext crash (see commits `5611b3e`, `fd78973`)

### G9 — Photo gallery
- Then: shows all uploaded photos; clickable thumbnails

### G10 — Photo upload requirement
- Given: NOT `followupServiceRequired`
- Then: at least one photo is required to complete

### G11 — Photo upload skipped when followup
- Given: `followupServiceRequired === true`
- Then: photo not strictly required, but follow-up reason(s) are

### G12 — Complete maintenance happy path
- Given: all required fields satisfied
- When: user clicks "Karbantartás befejezése"
- Then: `completeMaintenance(work.id)` runs (locally + queued for sync); toast "Karbantartás befejezve!"; navigate `/shifts/current`

### G13 — Complete blocked, validation feedback
- Then: bottom helper text shows the first unmet requirement:
  - Service & no issue number → "Szervíz esetén az igénylési szám megadása kötelező"
  - Else missing photo → "A munka lezárásához töltsön fel legalább egy fotót"
  - Else missing followup reason → "További szervíz esetén legalább egy ok megadása kötelező"
  - Else missing OTHER text → "Az Egyéb ok kitöltése kötelező a lezáráshoz"

### G14 — Abort maintenance
- Role: executor
- Given: `status === "in-progress"`
- When: user opens meatballs menu → "Karbantartás megszakítása"
- Then: `abortMaintenance(work.id)`; toast "A karbantartás megszakítva."; navigate `/shifts/current`

### G15 — Post-edit happy path
- Role: executor
- Given: `status === "completed"` AND workday not yet closed
- When: user opens menu → "Utólagos szerkesztés" → modifies fields → "Elmentem a módosításokat"
- Then: same validation as G5 (issue number required if SERVICE); `markEdited(work.id)` runs; toast "Módosítások elmentve."

### G16 — Last-edited timestamp
- Given: a previous edit exists
- Then: extra "Legutóbb módosítva" tile in the maintenance card

---

## H. Maintenance dashboard (`/shifts/current/maintenances`)

### H1 — Page access
- Same gate as E1 (`RequireActiveShift`)

### H2 — Close-request banner
- Given: shift `status === CLOSE_REQUESTED` or `READY_TO_COMMIT`
- Then: warning alert "<lead_name> lezárta a műszakot. Új karbantartási munka már nem indítható!"
- If user is allowed to confirm close and not yet confirmed: appends "A szinkron megerősítése folyamatban van."

### H3 — Tabs visibility
- Role: `lead_or_admin` → "Saját Munkák" + "Összes Munka" tabs visible
- Role: `technician`/`viewer`/`partner` → only own works section (no tabs)

### H4 — Own works empty state
- Given: own works list is empty AND shift allows starting work
- Then: "Ebben a műszakban még nincs saját karbantartási munkája." + link "Kezdje el az első munkát" → `/new-maintenance` (disabled if `CLOSE_REQUESTED`)

### H5 — All works tab data source
- Role: `lead_or_admin`
- When: tab "Összes Munka" active
- Then: `GET /api/shifts/:id/maintenance-summary` → render backend rows + any local-only rows from the current user's outbox that aren't yet known to backend

### H6 — Per-work sync indicator
- Then: cloud-upload (synced/green), cloud-cog (waiting/orange), cloud-alert (error/red) — derived from `workSyncStates[id]` with backend rows defaulting to "synced"

### H7 — Sync error tooltip
- Given: sync state is `error` with `lastError` text
- When: user taps the cloud-alert button
- Then: toggle a tooltip with the error message; click-outside closes it

### H8 — Σ counter
- Then: top-right shows total work count; if any unsynced, format `synced+unsynced` (e.g. `5+2`)

### H9 — Work card sort
- Then: sorted by `(completion_time DESC, start_time DESC, id DESC)`. Local-only rows are intermixed.

### H10 — Tap an "all works" row
- Then: if the row belongs to current user (`todaysWorks` has it) → navigate to `/maintenance/:id`; otherwise no navigation (?: not clickable today; **? confirm**)

---

## I. Device detail (technician, `/devices/:id`)

### I1 — Page access
- Same gate as E1 (`RequireActiveShift`)

### I2 — Loading
- When: page mounts
- Then: fetch `/api/shifts/current`, then `/api/shifts/:id/waiting-room` to get building_id, then read cached snapshot for the device

### I3 — Device not found
- Then: "Az eszköz nem található" + "Vissza" link to `/shifts/current/maintenances`

### I4 — Header
- Then: device-kind icon + barcode as title

### I5 — Unit details card
- Then: Modell, Típus, Cím (building address) + Helyszín (composed from floor/wing/room + description)

### I6 — Maintenance history list
- Then: all of this user's local works (today + past) for this barcode, sorted by end/start time DESC
- Empty: "Nincs karbantartás rögzítve ehhez az eszközhöz."

### I7 — Malfunction badge
- Given: `work.isMalfunctioning === true`
- Then: red "Hibát észleltek a karbantartás során." label below the card

---

## J. Shift summary / signing (`/shift-summary` and `/shifts/:shiftId/summary`)

### J1 — Two entry points
- `/shift-summary` reads `currentShift` from context (normal flow)
- `/shifts/:shiftId/summary` reads `shiftId` from URL (used by Pending Worksheets list); back button goes to `/pending-worksheets`

### J2 — Role gate
- Then: page renders error "Csak a műszakvezető láthatja ezt az oldalt." if user is not `lead_or_admin` (?: backend also enforces — confirm via API call **?**)

### J3 — Initial load
- Then: `GET /api/shifts/:id/maintenance-summary` → render building name, date, lead name, maintenances table

### J4 — Maintenance row columns
- Helyszín (composed) + alert icon if `malfunction_description` set, Vonalkód, Karbantartás vége (HH:mm), Márka + modell, Típus

### J5 — Empty maintenance list
- Then: info alert "Ehhez a műszakhoz még nincs szinkronizált karbantartás."

### J6 — Signature pad
- Then: HTML5 canvas; placeholder "Írja alá itt érintéssel vagy egérrel."; "Törlés" button clears

### J7 — Required referent fields
- Then: Név (required), Beosztás (required) both must be non-empty to enable submit

### J8 — Cannot submit empty signature
- When: user clicks "Műszak véglegesítése" with empty pad
- Then: toast "A műszak véglegesítéséhez aláírás szükséges."

### J9 — Commit happy path
- Given: name + role + signature filled
- When: user clicks "Műszak véglegesítése"
- Then: render PNG (1200×360 white background, primary-colored strokes) → `PUT /api/shifts/:id/signature-image` (image/png) → `POST /api/shifts/:id/commit` with reference person + strokes + signature_image_url → refresh current shift → toast "A műszak sikeresen véglegesítve." → navigate to `/pending-worksheets` (if from list) or `/`

### J10 — Upload failure
- Then: error toast with backend message; not committed

### J11 — Commit failure after upload succeeded
- Then: error toast; signature is uploaded but commit row didn't land (**? cleanup story — open question**)

---

## K. Pending worksheets (`/pending-worksheets`)

### K1 — Page access
- Role: `lead_or_admin` only. Technician/Viewer/Partner navigating directly → redirected to `/home` by `RequireRoles` (not 404, not 403).

### K2 — Initial load
- When: page mounts
- Then: `GET /api/shifts/pending` → list of shifts where the user is the lead AND status is `READY_TO_COMMIT`

### K3 — Empty state
- Then: "Nincs aláírandó munkalap" + "Minden lezárt műszak munkalapja aláírva."

### K4 — List row
- Then: building name, lead name, "Lezárva: <datetime>", chip "Aláírás szükséges"

### K5 — Open a worksheet
- When: user clicks a row
- Then: navigate to `/shifts/:shiftId/summary` (same view as J)

### K6 — Worksheet count visible elsewhere
- Then: the same number is shown on `/home`'s "Aláírandó munkalapok" card (C8) and the drawer badge (B7)

### K7 — Listing scope **?**
- ?: confirm — does the listing include shifts led by OTHER users? The page text says "Az alábbi műszakok lezárva, de a munkalapot még nem írták alá." and the endpoint `/api/shifts/pending` may scope by tenant rather than by lead. **? open question**

---

## L. Admin — shifts (`/admin/shifts`)

### L1 — Page access
- Role: `lead_or_admin` (gated by `RequireRoles`).

### L2 — Initial load
- When: page mounts
- Then: `GET /api/admin/shifts` → `{ live: [...], past: [...] }`

### L3 — Live section: cards
- Then: 1 card per live shift; columns by status:
  - `INVITING`/`READY_TO_START` → created_at, "Résztvevők: ready/invited"
  - `IN_PROGRESS` → indult, résztvevők száma, hibásnak jelölt, szinkronizált karbantartások
  - `CLOSE_REQUESTED`/`READY_TO_COMMIT` → above + lezárva timestamp
- Empty live: info alert "Jelenleg nincs aktív vagy előkészítés alatt álló műszak."

### L4 — Status chip color map
- READY_TO_START / READY_TO_COMMIT → accent
- IN_PROGRESS → success
- CLOSE_REQUESTED → primary
- CANCELLED → destructive

### L5 — Past section: table
- Then: columns Dátum, Indítás-Befejezés, Épület, Műszakvezető, Résztvevők, Szervíz, Karbantartások, Átl. tempó
- Empty: "Nincs korábbi műszak."

### L6 — Click a shift (live or past)
- Then: navigate to `/admin/shifts/:shiftId`

---

## M. Admin — shift detail (`/admin/shifts/:shiftId`)

### M1 — Page access
- Role: `lead_or_admin`

### M2 — Initial load
- Then: `GET /api/admin/shifts/:shiftId`

### M3 — Header card
- Then: building name + address, shift lead, status chip, timestamps (created/started/closed/finished), average pace minutes, follow-up count, maintenance count

### M4 — Download worksheet button
- Given: `payload.report_url` set
- When: user clicks "Munkalap letöltése"
- Then: open report_url in new tab (`noopener,noreferrer`)
- Given: status === `COMMITTED` but no URL
- Then: toast "A munkalap letöltése még nincs implementálva." **? — known unimplemented**

### M5 — Download disabled
- Given: status !== `COMMITTED` AND (no report_ready OR no URL)
- Then: button disabled

### M6 — Participants accordion
- Collapsed by default; expand to see table with columns Név, Szerepkör, Státusz, Meghívva, Cache kész, Lezárás megerősítve

### M7 — Maintenances table
- Then: columns Vonalkód, Típus, Márka+típus, Helyszín, Karbantartó, Karbantartás (range)
- Inline icons per row: speech-bubble if notes present, warning if follow-up service required
- Click a row → navigate to `/admin/maintenances/:maintenanceId`

### M8 — Back navigation
- Then: ◀ button always returns to `/admin/shifts`

---

## N. Admin — maintenance detail (`/admin/maintenances/:maintenanceId`)

### N1 — Page access
- Role: `lead_or_admin`

### N2 — Legacy route redirect
- Given: `/admin/shifts/:shiftId/maintenances/:maintenanceId`
- Then: 302 redirect to `/admin/maintenances/:maintenanceId` (handled by `RedirectLegacyAdminMaintenanceRoute`)

### N3 — Initial load
- Then: `GET /api/admin/maintenances/:maintenanceId`

### N4 — Header
- Then: kind icon + barcode (or "Vonalkód nélkül"), status badge (IN_PROGRESS/FINISHED/ABORTED), followup chip if applicable

### N5 — Unit details card
- Then: Márka+típus, Berendezés típusa, Épület+helyszín, Azonosítók (vonalkód, gyári szám, forráskód)

### N6 — Maintenance card
- Then: Karbantartó (name), Kezdete, Befejezése, Megszakítás ideje (red icon if aborted_at set)

### N7 — Follow-up service card
- Given: `followup_service_required === true`
- Then: warning-tinted card with reason list, plus "Egyéb" free-text if reasons include `OTHER`

### N8 — Notes card
- Then: shows note or "Nincs megjegyzés." if empty

### N9 — Photos card
- Then: all maintenance photos (incl. "Hibafotó" label for `MALFUNCTION` type)

---

## O. Admin — users (`/admin/users`)

### O1 — Page access
- Role: `lead_or_admin` (gated). The "+" FAB is only shown to `admin`.

### O2 — Initial load
- Then: `GET /api/admin/users`

### O3 — Grouping
- Then: cards per role: Adminisztrátorok / Vezető technikusok / Technikusok / Megtekintők (sections with empty user lists are skipped)

### O4 — Click a user
- Then: navigate to `/admin/users/:userId`

### O5 — Create user (admin only)
- Role: `admin`
- When: user clicks the floating + button
- Then: modal opens; required fields name + email; role dropdown; phone optional
- Submit: `POST /api/admin/users {full_name, email, phone_number, role}`
- On 4xx, if backend says "e-mail cím már használatban van" → highlight email field; otherwise show top-of-dialog error

### O6 — Empty state
- Given: zero users (shouldn't happen post-onboarding)
- Then: info alert "Nincs aktív felhasználó."

### O7 — Section badge
- Then: each section header shows a small count chip

---

## P. Admin — user detail (`/admin/users/:userId`)

### P1 — Page access
- Role: `lead_or_admin`. Edit pencil only shown to `admin`.

### P2 — Initial load
- Then: `GET /api/admin/users/:userId`

### P3 — Display
- Then: avatar (role icon), name, email, phone (or "-"), role chip, Active/Inaktív chip

### P4 — Quick actions
- Then: mail icon → `mailto:`; phone icon → `tel:` (disabled if no phone)

### P5 — Edit user (admin only)
- When: user clicks the pencil icon
- Then: modal opens, email field disabled; submit `PATCH /api/admin/users/:userId`
- Same email-conflict messaging as O5

### P6 — Back navigation
- Then: ◀ navigates to `/admin/users`

---

## Q. Admin — devices list (`/admin/devices`)

### Q1 — Page access
- Role: `lead_or_admin`

### Q2 — Building selector required
- Then: empty table until a building is picked: "Válasszon ki egy épületet a berendezéslista megjelenítéséhez."

### Q3 — Open building dialog
- When: user clicks the "Kiválasztott épület" button
- Then: dialog opens; `GET /api/admin/buildings`

### Q4 — Select building
- Then: stores selection in `searchParams.buildingId` + sessionStorage; resets page to 1; reload devices

### Q5 — Filters
- Then: each column header opens a popover menu with:
  - Sort (cycle: none → asc → desc → none)
  - Filter (text input or "Van érték"/"Nincs érték" presence toggle, depending on column)
- Filter chips show under the title; X removes one; "Összes szűrő törlése" clears all
- Columns supporting presence filter: barcode, floor, room, brandModel, identifier, maintainedAt
- Columns text-only: wingOrBuilding, deviceType

### Q6 — Filter persistence
- Then: query string is the source of truth; saved to sessionStorage with the building name; restored on next visit (replace, not push)

### Q7 — Devices table render
- Then: columns Vonalkód, Szárny/Épület, Szint, Szoba, Típus, Márka/Modell, Azonosító, Karbantartva (date only)
- N/A placeholder for missing values
- Sort indicator: " ↑" or " ↓" appended to header label

### Q8 — Pagination
- Then: 100 rows per page, mui `TablePagination` at the bottom; "Frissítés..." chip overlays the table while reloading

### Q9 — Click a device row
- Then: navigate to `/admin/devices/:deviceId`

### Q10 — Loading overlay vs full skeleton
- Then: first load → centered spinner; subsequent loads → blurred overlay with "Frissítés..." chip

---

## R. Admin — device detail (`/admin/devices/:deviceId`)

### R1 — Page access
- Role: `lead_or_admin`

### R2 — Initial load
- Then: `GET /api/admin/devices/:deviceId`

### R3 — Header
- Then: device-kind icon + (barcode || source_device_code || "Azonosító nélkül"), kind chip, "Karbantartható"/"Nem karbantartható" chip

### R4 — Details card
- Then: Márka/Modell, Típus, Épület és helyszín (multi-line), Vonalkód, Azonosító, Gyári szám

### R5 — Notes card
- Then: shows `additional_info` if non-empty; otherwise no card rendered

### R6 — Statistics
- Then: Vonalkódok száma, Karbantartások száma, Létrehozva (datetime), Utolsó karbantartás

### R7 — Maintenance history table
- Then: rows Állapot, Karbantartó, Kezdete, Befejezése (end or abort time)
- Click a row → `/admin/maintenances/:maintenanceId`

### R8 — Device photo card
- Given: `device_photo_url` set
- Then: image rendered full-width with border
- Otherwise: dashed placeholder "Ehhez a berendezéshez nincs feltöltött fotó."

---

## S. Cross-cutting — offline & sync

### S1 — Outbox queues mutations
- Given: a maintenance is created/updated/finished offline
- Then: mutation lives in IndexedDB outbox; UI shows "Szinkronra vár" indicator

### S2 — Replay on reconnect
- When: connectivity returns
- Then: outbox replays POST/PATCH with `X-Mutation-Id` header; backend's `processed_mutations` table makes replays idempotent

### S3 — Sync error visible on dashboard
- Then: failing item shows red CloudAlert + tooltip with the last error message (H7)

### S4 — Non-retryable items pruned
- Then: pruning runs before scan/cache-rebuild on `/new-maintenance` and around shift start/cache reload (D4, E16, F10)

### S5 — Offline gating of online-only actions
- Then: actions that require backend (add participant, cancel shift, reinvite, remove participant, cache reload) show "A backend jelenleg nem elérhető..." toast when `navigator.onLine === false`

### S6 — Reading shift detail offline
- Given: previously loaded waiting-room payload exists in `localStorage` key `noma:shift-details:<userId>`
- Then: shown instantly while a background refresh runs; on failure, cached payload stays (E2)

### S7 — IndexedDB building snapshot
- Then: `rebuildBuildingSnapshot(tenantId, buildingId)` is called before any state that needs offline device data (shift start, accept invitation, cache reload, optionally on scan)

---

## T. Cross-cutting — real-time (SSE)

### T1 — Subscribe on shift detail
- Given: `/shifts/current` open, browser online
- When: page mounts
- Then: open `EventSource /api/shifts/:id/events`; listen for `participants-updated`
- On unmount / offline: close

### T2 — Reconnect on offline → online
- Given: SSE closed due to network drop
- When: `online` event fires
- Then: a new EventSource is opened (effect re-runs)

### T3 — SSE error suppression
- Then: native `onerror` clears the error state but doesn't surface a user error (deliberate quiet retry)

### T4 — Other consumers of SSE **?**
- ?: confirm: do other pages (admin shifts list, pending worksheets) subscribe to SSE for live updates? Currently they don't — they re-poll. **? open question (potential follow-up)**

---

## U. Cross-cutting — error UX & i18n

### U1 — Backend error → user message
- All `fetch` calls use a `readApiErrorMessage(response, fallback)` helper that:
  1. Tries to parse JSON `{ error: "..." }`
  2. Falls back to a Hungarian fallback string
- Result is shown either as inline Alert or toast depending on page convention

### U2 — Hungarian only
- All user-facing strings are Hungarian. There is no language switcher.

### U3 — Toast positions and severities
- Centralized in `@/lib/toast` (success/info/error)

### U4 — Loading patterns
- Initial → centered `CircularProgress` ("Karbantartás betöltése..." not shown — just the spinner)
- Inline mutation → button label morphs to "X..." (e.g. "Létrehozás...", "Lezárás...")
- Background refresh on table → blurred overlay + "Frissítés..." chip (Q10)

---

## V. Cross-cutting — role gates (verified)

| Route | Required role | Behavior if unauthorized |
|---|---|---|
| `/login` | none | If already logged in, redirect away |
| `/home`, `/shifts/current`, `/shifts/current/maintenances`, `/maintenance/:id`, `/devices/:id`, `/shift-summary` | any (with active shift access for the gated ones) | Without active shift → redirect to `/home` |
| `/new-maintenance` | any (active shift, not CLOSE_REQUESTED) | If CLOSE_REQUESTED → `/shifts/current` |
| `/shifts/start`, `/pending-worksheets`, `/shifts/:shiftId/summary` | `admin` or `lead_technician` | Non-matching → redirect to `/home` (not 404, not 403) |
| `/admin/*` | `admin` or `lead_technician` | Non-matching → redirect to `/home` |
| Admin create-user FAB | `admin` only | Hidden for `lead_technician` |
| Admin edit-user pencil | `admin` only | Hidden for `lead_technician` |
| Add/remove/reinvite participant on `/shifts/current` | shift lead only (`user.id === payload.lead_user_id`) | Buttons hidden |
| Cancel shift on `/shifts/current` | shift lead only | Menu item hidden |
| Close-request / Commit on `/shifts/current` & `/shift-summary` | shift lead only | Buttons hidden / page shows "Csak a műszakvezető láthatja ezt az oldalt." |
| "Reload building cache" menu | any participant | Menu always present on shift detail |

---

## W. Backend route inventory (for cross-reference)

Mounted under `/api`:

| Method+Path | Handler | UI usage |
|---|---|---|
| `GET  /health-check` | — | infra only |
| `POST /auth/google` | `google_login` | LoginPage |
| `GET  /auth/me` | `get_current_user` | DemoUserContext bootstrap |
| `POST /auth/logout` | `logout` | Layout menu logout |
| `GET  /admin/shifts` | `list_admin_shifts` | Admin shifts list |
| `GET  /admin/buildings` | `list_admin_buildings` | Devices building dialog |
| `GET  /admin/users` | `list_admin_users` | Admin users list |
| `POST /admin/users` | `create_admin_user` | Create user dialog |
| `GET  /admin/users/{user_id}` | `get_admin_user_detail` | User detail |
| `PATCH /admin/users/{user_id}` | `update_admin_user` | Edit user dialog |
| `GET  /admin/devices` | `list_admin_devices` | Devices table |
| `GET  /admin/devices/{device_id}` | `get_admin_device_detail` | Device detail |
| `GET  /admin/shifts/{shift_id}` | `get_admin_shift_detail` | Admin shift detail |
| `GET  /admin/maintenances/{maintenance_id}` | `get_admin_maintenance_detail` | Admin maintenance detail |
| `GET  /users/invite-candidates` | `list_shift_invite_candidates` | Add participant dialog |
| `POST /shifts` | `create_shift` | Start shift |
| `GET  /shifts/current` | `get_current_shift_state` | ShiftContext bootstrap |
| `GET  /shifts/pending` | `get_pending_worksheets` | Pending worksheets (+ home badge + drawer) |
| `POST /shifts/{shift_id}/participants` | `add_shift_participant` | Add / reinvite |
| `DELETE /shifts/{shift_id}/participants/{user_id}` | `remove_shift_participant` | Remove participant |
| `POST /shifts/{shift_id}/join-ready` | `mark_shift_join_ready` | Accept invitation |
| `POST /shifts/{shift_id}/decline` | `decline_shift_invitation` | Decline invitation |
| `POST /shifts/{shift_id}/close-request` | `request_shift_close` | Close-request button |
| `POST /shifts/{shift_id}/close-confirm` | `confirm_shift_close` | Outbox auto-trigger (?) **?** |
| `POST /shifts/{shift_id}/commit` | `commit_shift` | Shift summary commit |
| `PUT  /shifts/{shift_id}/signature-image` | `upload_shift_signature` | Shift summary signature |
| `POST /shifts/{shift_id}/cancel` | `cancel_shift` | Cancel dialog |
| `GET  /shifts/{shift_id}/waiting-room` | `get_shift_waiting_room` | Current shift |
| `GET  /shifts/{shift_id}/events` | `subscribe_shift_events` | SSE participants-updated |
| `GET  /shifts/{shift_id}/maintenance-summary` | `get_shift_maintenance_summary` | Dashboard "all works" tab + Shift summary |
| `GET  /labeling/buildings` | `list_labeling_buildings` | Start shift building list |
| `GET  /labeling/buildings/{building_id}/cache` | `get_labeling_building_cache` | Building snapshot prefetch |
| `POST /maintenance/works/{work_id}/sync` | `sync_maintenance_work` | Outbox flush |

(Plus labeling-app-specific routes that don't apply to main app.)

---

## X. Open questions / spots to clarify

1. **K7**: scope of `/api/shifts/pending` — only own shifts or all tenant shifts in `READY_TO_COMMIT`?
2. **M4**: report download URL — currently no implementation; toast says "még nincs implementálva." How should the worksheet PDF be generated and where stored?
3. **J11**: signature uploaded but commit fails — should the orphaned signature image be GC'd?
4. **E12**: do invite candidates include the lead? Front-end filter excludes already-listed non-DECLINED participants; the lead is one such participant, so effectively the lead never appears. Confirm backend filter aligns.
5. **H10**: clicking a row on the "Összes Munka" tab when it's not your own work — current behavior is no navigation; is that intentional or should lead/admin be able to drill in?
6. **T4**: should `/admin/shifts` and `/pending-worksheets` subscribe to SSE for live updates instead of relying on a 30s poll?
7. **J2**: backend access control for `/api/shifts/:id/maintenance-summary` — what role does it require? UI shows the page only to leads/admins but the request is sent regardless once you hit the URL.
8. **Misc**: `frontend/apps/main/src/pages/Index.tsx` is unused (per project_overview); confirm and delete.

---

## Y. How to use this catalog

- Treat each line as a **candidate test case** for the e2e/integration suite. Most are one-line Playwright/Cypress scenarios.
- When picking which to automate first, follow the priority order in `dev/test_implementation_notes.md` and the "must not break" tier from earlier discussion: **G (maintenance execution)** + **D/E/J (shift lifecycle + commit)** are the spine.
- When the UI changes, update the relevant section here in the same PR. The catalog is a living spec, not a snapshot.
