# AI speech audio in production — Cloud Storage for Firebase (implemented, on)

Production state (2026-11-27, commit c33bcb3): **ElevenLabs audio is generated, stored in Cloud Storage and played
automatically**, in sync with the server clock. Vercel Production env: `AUDIO_STORE=storage`, `TTS_PROVIDER=elevenlabs`,
`ELEVENLABS_MODEL_ID=eleven_multilingual_v2`. Firebase project `bridgemun` is on Blaze.

## Storage
- Bucket: default bucket `bridgemun.firebasestorage.app`, location ASIA-NORTHEAST3 (Seoul).
- Object path: `forums/{forumId}/audio/{audioId}` (mp3_44100_128, `Cache-Control: private`), written only by the
  server (Admin SDK, `StorageAudioStore` in `src/server/speech/audioStore.ts`).
- Access: never public. Browsers fetch through `GET /api/forums/{id}/audio/{audioId}` (Firebase ID token + forum
  membership; 401 signed out, 403 other forum). `storage.rules`: member read of `forums/{id}/audio/**`, all client
  writes denied. A direct public URL returns 403.

## Playback
- `AiSpeechAudio` stays mounted for the whole meeting; position = now − `playStartMs` (server clock offset); a refresh
  resumes mid-speech; a speech already over is not replayed; re-renders/duplicate events do not restart it.
- Autoplay blocked → a one-time **Turn on audio** button in the speaker card (also joins Zoom audio, mic muted).
- Failures are distinguished and captions always stay: `tts_failed` (generation), `store_failed` (storage write —
  the speech still goes ahead with captions), `tts_off`, and browser-side load/playback errors.
- AI audio is played locally in each browser; it is not sent into the Zoom session.

## Retention / cleanup
1. On `forum_closed` (any reason: session over, adjourned, voting completed, H1 idle close) the server deletes the
   forum's `forums/{id}/audio/` prefix.
2. Safety net: bucket lifecycle rule deletes objects under `forums/` **7 days after creation**. Forums run at most a
   few hours, so an active forum's audio is never removed by this rule.
3. Deleting a forum's test data should also delete its Storage prefix.

## Cost (Blaze, pay-as-you-go; check current Google pricing)
- Size ≈ 16 KB/s → a 30–45 s speech ≈ 0.5–0.7 MB; a 60-min forum with ~40 AI speeches ≈ 25 MB stored for ≤ 7 days,
  read once per listening member (5 members ≈ 125 MB egress). Regional bucket in Seoul: no always-free tier, so it is
  billed from the first byte, but at this volume the amounts are cents per forum.
- ElevenLabs (Starter): characters per month are the real limit — one AI speech ≈ 600 characters.
