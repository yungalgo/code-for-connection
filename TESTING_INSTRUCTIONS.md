# Video Calls — Testing Instructions

## Prerequisites

- Docker Desktop running (`docker compose up -d` for Postgres + Redis)
- `npm run prisma:migrate` and `npm run prisma:seed` completed
- `npm run dev` running (starts API on :3000, signaling on :3001, web on :5173)
- **Use Chrome** for all test windows (Safari private mode blocks WebRTC)

## Test Accounts

| Role | URL | Credentials |
|------|-----|-------------|
| Family (Alice) | `/login` | `alice@example.com` / `password123` |
| Incarcerated (John Doe) | `/pin-login` | PIN `1234`, select "Sing Sing Correctional Facility" |
| Admin | `/login` | `admin@nydocs.gov` / `admin123` |

Other family accounts: `bob@example.com`, `carol@example.com`, `diana@example.com`, `eva@example.com`, `frank@example.com`, `grace@example.com`, `attorney@lawfirm.com` — all use password `password123`.

Other admin accounts: `admin@singsingcf.gov`, `admin@bedfordhillscf.gov` — all use password `admin123`.

## Quick Test: Instant Video Call (TEST_MODE)

`TEST_MODE=true` is set in `.env`. This enables an instant-call button and bypasses time slot validation.

1. Open **Chrome window 1** → http://localhost:5173/login
2. Login as Alice (`alice@example.com` / `password123`)
3. Navigate to **Video Calls**
4. Click the yellow **"Call John Doe NOW"** button (TEST MODE box)
5. Allow camera/mic when prompted — you'll see yourself and "Waiting for the other person..."
6. Open **Chrome window 2** (incognito) → http://localhost:5173/pin-login
7. Login as John Doe (PIN `1234`, Sing Sing)
8. Go to **Video Call** tab
9. The call should appear — click **"Join Video Call"** (refresh if it doesn't appear immediately)
10. Allow camera/mic — both windows should now show each other's video

## Full Flow: Schedule + Join

### 1. Family schedules a call

1. Login as Alice → Video Calls → **"Schedule a Call"**
2. Select contact: **John Doe**
3. Pick a date and time within a valid slot:
   - Slots are daily **9:00–12:00** and **14:00–17:00** (UTC)
   - Convert to your local timezone (e.g., EST = UTC-5, so 4:00–7:00 AM and 9:00 AM–12:00 PM)
   - With `TEST_MODE=true`, time slot validation is bypassed — any time works
4. Submit → call auto-approves (Alice is already an approved contact for John)
5. Call appears as **"scheduled"** in the list

### 2. Incarcerated person sees and joins

1. Login as John Doe (PIN `1234`, Sing Sing)
2. Video Call tab → scheduled call appears with countdown timer
3. **"Join Video Call"** button appears 5 minutes before the scheduled start
4. Click Join → allow camera/mic → enters the call

### 3. Family joins

1. On Alice's window, the call should show a **"Join Call"** button (5 min before start)
2. Click Join → both sides see each other's video
3. Timer counts down from the call duration (30 min)

## Admin Dashboard

1. Login as admin (`admin@nydocs.gov` / `admin123`)
2. Navigate to **Video Calls**
3. Dashboard shows:
   - **Active calls** — currently in-progress calls with a "Terminate" button
   - **Pending requests** — calls awaiting approval with Approve/Deny buttons
   - **Stats** — active call count, today's total, pending count
4. Dashboard auto-refreshes every 15 seconds
5. Legal calls show "Legal — No Monitoring" and cannot be terminated

## What to Verify

- [ ] Family can see approved contacts and schedule a call
- [ ] Scheduled call appears on both family and incarcerated sides
- [ ] Join button appears within 5 min of scheduled start
- [ ] Both sides get camera/mic access and see each other's video
- [ ] Timer counts down correctly
- [ ] Mic/camera toggle buttons work (icons change, peer sees mute indicator)
- [ ] End call button works (both sides return to call list)
- [ ] Admin dashboard shows active calls and stats
- [ ] Admin can terminate an active call
- [ ] Call history shows completed calls with duration
