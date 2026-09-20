# The Taylored Plate cooking classes

Python backend and two Second Life LSL terminals for manual enrollment, private check-in, attendance, cohorts, and six stations. Payment processing and graduation dispensing are intentionally outside this build.

## Quick start

Requires Python 3.11 or newer. From this folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

Generate **two different** secret tokens with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Set configuration in the service environment; do not commit secrets:

```powershell
$env:PLATE_DB = 'plate.sqlite3'
$env:PLATE_ADMINS = 'YOUR-INSTRUCTOR-AVATAR-UUID,ANOTHER-INSTRUCTOR-UUID'
$env:PLATE_DEVICES = '[{"terminal":"classroom-1","role":"student","token":"YOUR-STUDENT-SECRET-AT-LEAST-32-CHARACTERS"},{"terminal":"classroom-1","role":"admin","token":"YOUR-DIFFERENT-ADMIN-SECRET-AT-LEAST-32-CHARACTERS"}]'
python run.py
```

Replace the UUID placeholders with actual UUIDs. Remove the second admin if unnecessary. The service binds to `127.0.0.1:8080`. Put it behind an HTTPS reverse proxy on your host and forward requests to this loopback port. Second Life cannot reach your computer's localhost directly. Configure your host to restart the service, persist the database directory, limit inbound request rates and body sizes, and avoid logging tokens. Use one writable SQLite database on local disk; do not put it on a network share or run separate database copies behind a load balancer.

## Install in Second Life

1. Create a student terminal object. Insert `lsl/student_terminal.lsl`, replace BASE_URL, TOKEN, and TERMINAL, and compile using Mono.
2. Create an instructor terminal or attach it as a HUD. Insert `lsl/admin_terminal.lsl`, using the distinct admin token and the same terminal ID.
3. The admin object owner must also be in PLATE_ADMINS. Add other instructors' UUID strings to the LSL ADMINS list and the server list.
4. Keep token-bearing scripts and objects under trusted control. Do not give students modifiable scripts or admin devices. Rotate tokens if a script is exposed.
5. Touch the admin terminal, choose a category, and enter commands from the reference below. Each response closes the session; touch again for another action. `BACK` returns to the main menu. Sessions and HTTP requests expire automatically.
6. Create a cohort, enroll students after payment is confirmed separately, select the cohort and week, then explicitly open check-in.

The student terminal privately replies using `llRegionSayTo`. It supports 16 pending students per object, handles simultaneous touches separately, and asks excess users to retry. HTTP responses map to the original avatar; late responses are discarded. No public check-in announcements are made. The admin terminal accepts one operator at a time and removes listeners after submission or timeout.

## Admin command reference

Use `|` between fields, with no literal pipes in names or titles. Cohort IDs are chosen by you, up to 40 characters. Names/titles are up to 100 characters. UUID means the avatar's UUID, not their name. Text boxes allow 250 characters: use concise names for couple entry; the API accepts longer commands up to 2000 characters. Empty display-name fields fall back to legacy names. Pages begin at **0**; request successive pages until empty.

| Menu | Command | Purpose |
|---|---|---|
| COURSE | `course` | Current cohort, week, title, active enrollment and check-in counts |
| COURSE | `cohort|oct2026` | Select cohort; clears week and closes check-in |
| COURSE | `week|1` | Select week 1–4; closes check-in |
| COURSE | `open` / `close` | Explicitly open or close check-in |
| COHORTS | `create|oct2026|October 2026 Cohort` | Create a new historical cohort |
| COHORTS | `cohorts|0` | List five cohorts per page |
| STUDENTS | `individual|oct2026|1|UUID|Legacy Name|Display Name|NORMAL` | Enroll individual |
| STUDENTS | `couple|oct2026|2|UUID1|Legacy1|Display1|UUID2|Legacy2|Display2|NORMAL` | Atomically enroll two partners into one reservation |
| STUDENTS | `student|oct2026|UUID` | Enrollment and recorded attendance; missing weeks are unmarked |
| STUDENTS | `status|oct2026|UUID|Withdrawn|NORMAL` | Set Active, Completed, or Withdrawn; never deletes history |
| ATTENDANCE | `roster|oct2026|1|0` | Five students per page, including status and station |
| ATTENDANCE | `mark|oct2026|UUID|1|Present` | Manual check-in; works even when student check-in is closed |
| ATTENDANCE | `mark|oct2026|UUID|1|Absent` | Mark absent, keeping old attendance in audit |
| ATTENDANCE | `mark|oct2026|UUID|1|Unmarked` | Undo check-in, retaining history |
| ATTENDANCE | `history|oct2026|UUID|0` | Three audit events per page, newest first |
| STATIONS | `stations|oct2026|1` | Show active students assigned to station 1–6 |
| STATIONS | `station|oct2026|UUID|3|NORMAL` | Move the entire reservation, including both partners |
| SETTINGS | `title|oct2026|1|Orientation & Fundamentals` | Rename a week without changing LSL |

Replace `NORMAL` with `OVERRIDE` only when you deliberately want unrelated reservations to share a station. Withdrawn/completed enrollments retain their station for history but do not reserve capacity. Reactivating a student checks capacity again. Withdraw each partner separately if both withdraw. Marking Completed is an instructor decision; it does not set graduation eligibility. Students in multiple cohorts have separate enrollments and attendance. Re-enrollment in the same cohort uses status Active rather than a new duplicate record.

## API

All requests are POST with `Content-Type: application/json` and `X-Plate-Token: DEVICE_SECRET`. The service binds each token to a role and terminal ID. All bodies require a fresh `request_id` UUID and matching `terminal`. Retrying the **same request ID and body** returns the saved response; reusing an ID with different content returns 409. A new student request after successful check-in returns the already-checked-in message without a second attendance event.

### POST /v1/check-in

```json
{"request_id":"REQUEST-UUID","terminal":"classroom-1","avatar":"AVATAR-UUID","legacy":"Student Resident","display":"Student"}
```

Student token only. UUIDs are authoritative. Display and legacy names never grant permissions. The supplied display name is used for the welcome message; enrollment identity names remain instructor-managed.

### POST /v1/admin/command

```json
{"request_id":"REQUEST-UUID","terminal":"classroom-1","actor":"INSTRUCTOR-UUID","command":"course"}
```

Admin token plus authorized actor UUID required on **every** command, including reads. The command table above is the complete operation contract. Success is `{"ok":true,"message":"..."}`; check-in also includes `duplicate`. Failure is `{"ok":false,"message":"..."}` with HTTP 400, 401, 403, 404, 409, 413, 415, or 503. All errors are JSON and do not reveal traces. The API uses one versioned admin command endpoint to keep the first LSL interface small; the Python modules can support typed resource endpoints later.

The shared device-token design trusts protected instructor/student scripts to report the actual touching avatar. A token holder can impersonate avatars within that device role. UUID validation and an allowlist do not authenticate an avatar independently of the device. Separate role tokens prevent a compromised student terminal from granting admin access. This is a trusted-device API, not a public browser login system.

## Database and file structure

| Table | Purpose |
|---|---|
| cohorts / weeks | Historical course IDs, names, and four editable titles |
| avatars | UUID identity, legacy and display names |
| reservations | Individual or Couple reservation and station 1–6 |
| enrollments | Per-cohort student record, partner UUID, status/date, reserved graduation fields |
| terminals | One selected cohort/week and explicit open flag per classroom terminal ID |
| attendance | Current state per cohort/avatar/week; status, timestamp, source and admin |
| audit | Append-only attendance before/after records and administrative changes |
| requests | Committed request results for retry deduplication |

`plate/db.py` owns schema/transactions; `common.py` validation and audit; `enrollment.py` reservations and capacity; `attendance.py` check-in and corrections; `admin.py` course management and admin interface; `api.py` authentication, JSON transport, and idempotency. `run.py` serves WSGI through Waitress. `tests/test_system.py` tests backend workflows. `lsl/` contains separately compilable terminal scripts.

All mutations use SQLite write transactions, so simultaneous enrollment attempts cannot silently consume the same station. Couples are created atomically. No delete operation is exposed. Audit update/delete is blocked by database triggers. Back up using SQLite's backup API (or stop the service and copy the database); copying a live main file alone can miss WAL transactions. Audit and idempotency records currently have no retention pruning: monitor disk usage. Future schema changes should use explicit migrations, not replace an existing cohort database.

## Graduation and future connections

Completion for each week can be derived from attendance status Present. Each enrollment contains nullable graduation_eligible plus gift_received and certificate_received flags. Eligibility remains null, and receipt flags remain false; there is no inferred attendance threshold or dispenser. A future policy module should add configurable graduation rules and audited fulfillment writes before using these fields operationally. New trusted backend integrations can reuse enrollment, station, and attendance modules. No student-facing graduation authorization endpoint is exposed yet.

## Verification and limits

Run `python -m unittest discover -s tests -v`. Tests cover separate couple attendance, station collision/override, concurrent reservations/check-ins, role/UUID authorization, closed sessions, cohort history, idempotency, audit corrections, title changes, graduation defaults, and JSON errors.

LSL compilation and live Second Life behavior must be tested in the viewer: no simulator/compiler is bundled. In-world acceptance: compile both scripts as Mono; verify two simultaneous students receive only their own reply; check duplicate touch, closed check-in, unknown/withdrawn student, unauthorized instructor, invalid backend JSON, backend outage, 65-second recovery, listener cleanup, couple station moves, and all four weeks. Run against a test cohort before enrolling the real class. This package has not been deployed to a public server.

LSL transport implementation follows official Second Life references: [llHTTPRequest](https://wiki.secondlife.com/wiki/LlHTTPRequest), [HTTP response body limits](https://wiki.secondlife.com/wiki/HTTP_BODY_MAXLENGTH), and [private region messages](https://create.secondlife.com/script/lsl-reference/functions/llregionsayto/).
