# Deadline scheduler — Google Cloud Tasks

Every meeting deadline (step timer, response window, vote window, idle-hold expiry) is one Cloud Tasks HTTP task
that calls `POST /api/engine/tick` at that time. There is no per-minute scan of all forums.

## Flow
1. The engine applies a command and emits `schedule(atMs)` for the new deadline (`src/engine/machine.ts`).
2. `CloudTasksScheduler` (`src/server/scheduler/index.ts`) creates task
   `tick-<forumId>-<phaseId>-<atMs>` with `scheduleTime = max(atMs + 500 ms, now)`, body `{forumId, phaseId, atMs}`,
   and an OIDC token for the invoker service account, audience `<APP_BASE_URL>/api/engine/tick`.
   - Same deadline registered twice → HTTP 409 (task name exists) → counted as success; no duplicate task.
   - 429 / 5xx / network → up to 3 attempts (0.3 s, 1 s); other 4xx → fail at once.
   - Still failing → the forum doc gets `schedulerPending: true` and `schedulerError` (phase, deadline, message).
3. `/api/engine/tick` verifies the OIDC token (`src/server/scheduler/oidc.ts`): Google signature, expiry, audience =
   the tick URL, issuer `accounts.google.com`, `email` = `CLOUD_TASKS_INVOKER_EMAIL` and `email_verified`. Headers
   alone are never trusted (401 otherwise; 404 when the driver is not `cloudtasks`). Then `advanceIfDue`: a stale
   tick (old phase) or an early tick changes nothing; a tick up to 5 s early waits once and retries (clock skew).
4. Queue retries: a tick that fails (5xx / timeout) is retried by Cloud Tasks (queue retryConfig below).
5. Repair: Cloud Scheduler job `engine-repair` calls `POST /api/engine/repair` every 5 min (same OIDC check,
   audience `<APP_BASE_URL>/api/engine/repair`). It never scans every meeting; it reads at most 25 + 25 documents:
   - forums flagged `schedulerPending == true` (registration failed): closed / no deadline → flag cleared; deadline
     passed → applied now (`advanceIfDue`); deadline in the future → registered again under a fresh task name
     (`…-r<time>`), because Cloud Tasks keeps the name of a deleted or executed task reserved (~1 h) and would
     answer 409. Success clears the flag; failure keeps it with `schedulerRepairAttempts` / `schedulerRepairError`.
   - forums whose `nextWakeAtMs` (stored on `engineState/current` in the same write as the state) is more than
     2 min in the past — a task that was registered but never delivered (queue retries exhausted, task deleted,
     queue purged): applied now. Collection-group index on `engineState.nextWakeAtMs` (firestore.indexes.json).
     A tick that changes nothing clears the marker so the forum is not picked up again every run.
6. Secondary recovery only: an open page's nudge / presence heartbeat also applies a due deadline.

## Google Cloud resources (project `bridgemun`, number 534451119531)
| Resource | Setting |
|---|---|
| Queue `projects/bridgemun/locations/asia-northeast3/queues/engine-ticks` | maxDispatchesPerSecond 20, maxConcurrentDispatches 20; retry maxAttempts 5, minBackoff 2 s, maxBackoff 60 s, maxDoublings 3, maxRetryDuration 900 s |
| Service account `bridgemun-tasks-invoker@bridgemun.iam.gserviceaccount.com` | No keys. Only used as the OIDC identity of tasks and of the repair job. No project roles. |
| App service account (firebase-adminsdk, already used by the server) | `roles/cloudtasks.enqueuer` on the queue only; `roles/iam.serviceAccountUser` on the invoker SA only |
| Cloud Scheduler job `projects/bridgemun/locations/asia-northeast3/jobs/engine-repair` | `*/5 * * * *` Asia/Seoul, POST `https://bridgemun.vercel.app/api/engine/repair`, OIDC as invoker, retryCount 1 |

The server gets its Cloud Tasks access token from the existing Firebase Admin credential (`FIREBASE_SERVICE_ACCOUNT_BASE64`,
scope cloud-platform) — no new key.

## Environment
| Name | Production | Local / emulator |
|---|---|---|
| `SCHEDULER_DRIVER` | `cloudtasks` | `local` (in-process timers; refused in production) |
| `APP_BASE_URL` | `https://bridgemun.vercel.app` | — |
| `CLOUD_TASKS_LOCATION` | `asia-northeast3` | — |
| `CLOUD_TASKS_QUEUE` | `engine-ticks` | — |
| `CLOUD_TASKS_INVOKER_EMAIL` | invoker SA e-mail | — |

`npm run check:project` reports missing values (never prints them).

## Operations
- Deploy: push to `main` (Vercel auto-deploy). Changing env needs a redeploy.
- Inspect queued tasks: Cloud Console → Cloud Tasks → `engine-ticks` (or REST `GET …/queues/engine-ticks/tasks`).
- Repair runs: Cloud Scheduler → `engine-repair` (last run status); Vercel logs `[repair]` / `[tick] <forumId> <result>`.
- If the queue was paused or deleted: recreate it with the settings above; forums whose registration failed in the
  meantime carry `schedulerPending` and are re-armed by the repair job on its next run.
- A different domain: update `APP_BASE_URL` and the repair job's URI and audience (OIDC audience must equal the URL).

## Retired: QStash
QStash (Upstash) was used until 2026-11-28 (KST). Code (`qstashVerify.ts`, `scripts/qstash-smoke.ts`,
`scripts/e2e/dup-ticks.mjs`), Vercel env (`QSTASH_*`, production + preview) and local env lines are removed; no
messages or schedules remained in the account. `/api/engine/tick` now accepts only Cloud Tasks OIDC tokens, so an
old QStash callback would get 401. The Upstash account / token itself was not deleted (owner's choice).
