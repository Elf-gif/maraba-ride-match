# Maraba Ride Match

Automatic daily transport pairing for UITH nursing students on clinical
posting.

## What it does

- Students create one account (name, phone, password, gender, transport tag).
- Each time they have duty, they add just the date and shift.
- The system auto-matches them with a compatible student: same date, same
  shift, same gender, and a compatible transport tag (only Lapper+Lapper is
  blocked).
- Both sides must accept before phone numbers are revealed.
- If a duty passes to within 20 minutes of its shift start with no match, the
  dashboard shows a manual pick list of everyone else still available.
- Manual picks are confirmed immediately (no accept step), but either side can
  decline with one tap, which sends both back into matching.
- Admins can view all students/duties/matches, manually pair or unpair
  people, suspend or delete accounts, and see match stats.

Shift start times (trip must have started by then):
- Morning: 6:45am (notification/manual list at 6:25am)
- Afternoon: 1:45pm (manual list at 1:25pm)
- Night: 5:45pm (manual list at 5:25pm)

## Running it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

Data is stored in `data.json` in the project folder (created automatically).
This is fine for a single small cohort; for anything larger, swap `db.js` for
a real database using `schema.sql` as the reference schema (PostgreSQL).

## Creating the first admin

There's no signup checkbox for admin (by design, so students can't self
promote). Instead, after someone signs up normally, promote them with:

```bash
curl -X POST http://localhost:3000/api/admin/promote \
  -H "Content-Type: application/json" \
  -d '{"phone":"THEIR_PHONE_NUMBER","secret":"change-me"}'
```

Set a real secret before deploying:

```bash
ADMIN_SECRET=your-long-random-secret npm start
```

and use that same secret in the promote call above.

## Deploying

This is a plain Node/Express app with no native build dependencies, so it
runs on Render, Railway, Fly.io, or a basic VPS. Set the `PORT` and
`ADMIN_SECRET` environment variables and run `npm start`. If you deploy
somewhere with an ephemeral filesystem (like some free tiers), `data.json`
will not persist between restarts, so pick a host with a persistent disk, or
move to a real database.

## What's intentionally left out

Per the spec: no OTP, no transport cost, no route selection, no permanent
partners, no in-app chat, no GPS/maps, no payments. The app does one thing:
pair people up for the same ride.

## Known limitations to be aware of

- Auth is basic (bcrypt-hashed passwords, no sessions or tokens). The
  frontend just remembers `userId` in localStorage. Fine for an internal
  tool used by a known cohort, not bank-grade security.
- `data.json` is not safe for concurrent write-heavy traffic at scale. It's
  fine for a class-sized cohort of dozens to a few hundred students.
- No SMS/push notifications yet. The "notification" 20 minutes before duty is
  currently a banner that appears on the dashboard, not a phone alert.
