# Video Guild — Spec vs Implementation Delta

What we have vs what the spec requires.

## Done

### Incarcerated Person Interface
- [x] PIN authentication
- [x] View scheduled video calls (with countdown timer)
- [x] Join video call at scheduled time (5-min join window)
- [x] Video toggle (camera on/off)
- [x] Audio toggle (mute/unmute)
- [x] Call timer display (with yellow/red warnings)
- [x] Auto-disconnect at limit
- [x] End call manually
- [x] Call history
- [x] Legal video call (attorney flag, "No Monitoring" banner, hides terminate button for admin)

### Family/Loved One Interface
- [x] Authentication (email/password login)
- [x] View approved contacts (with facility info)
- [x] Request video call (3-step wizard: contact → date → time slot)
- [x] View available time slots
- [x] Scheduled calls list
- [x] Join video call
- [x] Video toggle
- [x] Audio toggle
- [x] End call
- [x] Call history

### Facility Administrator Interface
- [x] Authentication (admin login)
- [x] View active video calls
- [x] Terminate active call
- [x] View call logs
- [x] View pending requests queue
- [x] Approve/deny requests (endpoints + UI)
- [x] Automated scheduling (auto-approve for approved contacts when `ADMIN_APPROVAL_REQUIRED=false`)

### Infrastructure
- [x] WebRTC peer-to-peer video via signaling server (socket.io + Redis)
- [x] STUN servers for NAT traversal
- [x] Time slot validation with concurrent call limits
- [x] `TEST_MODE` for instant test calls
- [x] `ADMIN_APPROVAL_REQUIRED` env toggle for approval flow

## Not Done — Required by Spec

### Background blur (both interfaces)
- [ ] "Video background blur — Blur background (so kids don't see the prison environment)"
- Spec lists this for both incarcerated and family interfaces
- It's also demo item #6
- **Approach:** MediaPipe SelfieSegmentation → canvas → processed MediaStream
- Add a blur toggle button next to the camera toggle in the call controls

### Alert for scheduled call (incarcerated)
- [ ] "Notification when a loved one schedules a call"
- Currently the incarcerated side polls every 30s and shows upcoming calls
- No push notification or real-time alert when a NEW call is scheduled
- **Approach:** Socket.io event from server when a call is created targeting the incarcerated person's facility. Or a simple "New call scheduled" toast that appears on next poll.

### Account registration (family)
- [ ] "Create account (shared with voice/messaging)"
- The auth system has a `/api/auth/register` endpoint and the `AuthContext` has a `register` method
- But we don't have a registration page/form in the video guild UI (it exists in the shared app layer — needs verification that it works end-to-end)

### Manage scheduling capacity (admin)
- [ ] "Set max concurrent calls"
- The `maxConcurrentVideoCalls` value exists on `housingUnitType` and is enforced during scheduling
- But there's no admin UI to change it — it's only set via seed data
- **Approach:** Add a settings section to the admin dashboard with an input to update `housingUnitType.maxConcurrentVideoCalls`

## Not Done — Optional Scope

These are explicitly listed as optional in the spec.

- [ ] **Ambient noise cancelling** — Chrome already enables `noiseSuppression: true` by default via getUserMedia. For stronger suppression: RNNoise WASM via AudioWorklet.
- [ ] **Voice captioning** — Real-time speech-to-text. Would need Web Speech API or a service like Deepgram/AssemblyAI.
- [ ] **Real-time translation** — Depends on captioning being done first.
- [ ] **Technical requirements check** — Verify camera, mic, bandwidth before call. Could be a pre-call screen that tests getUserMedia + measures a ping to the signaling server.
- [ ] **Reschedule/cancel call** — Cancel endpoint exists implicitly (could add a status transition). No UI for it yet.
- [ ] **Monitor/record hooks** — The legal call flag and admin terminate are building blocks. No actual recording infrastructure.
- [ ] **Quality metrics** — Could track ICE connection time, packet loss via `pc.getStats()`. No implementation yet.

## Easy Wins (quick to add)

1. **Background blur** — Required, well-solved with MediaPipe, add toggle button to call controls
2. **Notification toast** — Show "New call scheduled!" when poll detects a new call on incarcerated side
3. **Cancel/reschedule** — Add a "Cancel" button on scheduled calls + API endpoint
4. **Pre-call device check** — Quick getUserMedia test + "Your camera is ready" confirmation before joining
5. **Registration page verification** — Confirm the existing register flow works for family signup

## Architecture Notes

- `useCurrentUser()` in family/incarcerated UIs manually parses JWT instead of using `useAuth()` from AuthContext. Works fine but noted as tech debt — requires extracting auth context to a shared package.
- WebRTC uses STUN only (no TURN server). Works on same network / localhost. For production across firewalls/NATs, a TURN server is needed.
- Signaling server rooms are in-memory. If the signaling server restarts mid-call, the connection is lost. Redis adapter is connected but room state isn't persisted to Redis.
