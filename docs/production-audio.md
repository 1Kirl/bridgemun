# AI speech audio in production — options (decision pending)

Current production state (2026-11-25): **captions only**. ElevenLabs audio is generated and played in sync
only in local development (files under `.data/audio`). No plan or subscription was changed.

Size estimate: mp3_44100_128 ≈ 16 KB/s → a 30–45 s AI speech ≈ 0.5–0.7 MB. A 60-minute forum with
~40 AI speeches ≈ 25 MB written, read once per listening member (5 members ≈ 125 MB egress).

| Option | Setup | Cost factors | Notes |
|---|---|---|---|
| A. Firestore chunks (implemented, off) | Vercel env `AUDIO_STORE=firestore`, redeploy | Existing Firestore quota: Spark free tier ≈ 1 GiB stored, 10 GiB/month egress, 20k writes and 50k reads per day (check current Firebase pricing). ~2 writes and ~2 reads per speech per listener. | No new plan. Audio docs are server-only (rules deny clients); served through the members-only route. Old audio should be deleted after the forum ends (not yet automated). |
| B. Cloud Storage for Firebase | Upgrade project to **Blaze** (pay-as-you-go), create bucket, implement store | Storage per GB-month, download egress per GB, operations; asia-northeast3 has no "always free" bucket tier | Standard choice for larger files; needs your billing decision. |
| C. Vercel Blob | Enable Blob store on the Vercel project, implement store | Plan limits on storage/transfer (check Hobby limits) | Keeps everything on Vercel. |
| D. No storage (captions only) | none | none | Current state. |

Recommendation for a classroom pilot: A (no plan change), with a cleanup job; move to B if usage grows.
Enabling A in production is your decision; it has been tested on the emulator only
(`tests/emulator/audio-store.test.ts`).
