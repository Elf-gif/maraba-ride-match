const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const matching = require('./matching');

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

function findUser(state, userId) {
  return state.users.find((u) => u.id === Number(userId));
}

function requireAdmin(state, adminUserId, res) {
  const admin = findUser(state, adminUserId);
  if (!admin || !admin.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return admin;
}

// Cancel a match: revert both duties to finding_partner (unless they are
// themselves being cancelled) and try to re-match the side that stays active.
function cancelMatch(state, match, keepDutyIdActive) {
  match.status = 'cancelled';
  match.cancelledAt = new Date().toISOString();

  [match.dutyIdA, match.dutyIdB].forEach((dutyId) => {
    const duty = state.duties.find((d) => d.id === dutyId);
    if (duty && duty.status !== 'cancelled') {
      duty.status = 'finding_partner';
    }
  });

  if (keepDutyIdActive) {
    tryAutoMatch(state, keepDutyIdActive);
  }
}

function activeMatchForDuty(state, dutyId) {
  return state.matches.find(
    (m) =>
      (m.dutyIdA === dutyId || m.dutyIdB === dutyId) &&
      (m.status === 'pending' || m.status === 'confirmed')
  );
}

function tryAutoMatch(state, dutyId) {
  const duty = state.duties.find((d) => d.id === dutyId);
  if (!duty || duty.status !== 'finding_partner') return null;

  const user = findUser(state, duty.userId);
  const candidateDuty = matching.findCandidate(state, duty, user);
  if (!candidateDuty) return null;

  const match = {
    id: db.nextId(state, 'matches'),
    dutyIdA: duty.id,
    dutyIdB: candidateDuty.id,
    matchType: 'auto',
    acceptedA: false,
    acceptedB: false,
    status: 'pending',
    createdAt: new Date().toISOString(),
    confirmedAt: null,
    cancelledAt: null
  };
  state.matches.push(match);
  duty.status = 'match_found';
  candidateDuty.status = 'match_found';
  return match;
}

function dutyView(state, duty) {
  const match = activeMatchForDuty(state, duty.id);
  const view = {
    id: duty.id,
    dutyDate: duty.dutyDate,
    shift: duty.shift,
    status: duty.status,
    cutoffAt: matching.cutoffDateTime(duty.dutyDate, duty.shift).toISOString(),
    startAt: matching.shiftStartDateTime(duty.dutyDate, duty.shift).toISOString(),
    isPastCutoff:
      duty.status === 'finding_partner' &&
      matching.isPastCutoff(duty.dutyDate, duty.shift),
    match: null
  };

  if (match) {
    const partnerDutyId = match.dutyIdA === duty.id ? match.dutyIdB : match.dutyIdA;
    const partnerDuty = state.duties.find((d) => d.id === partnerDutyId);
    const partnerUser = partnerDuty ? findUser(state, partnerDuty.userId) : null;
    const iAccepted = match.dutyIdA === duty.id ? match.acceptedA : match.acceptedB;
    const partnerAccepted = match.dutyIdA === duty.id ? match.acceptedB : match.acceptedA;

    view.match = {
      id: match.id,
      type: match.matchType,
      status: match.status,
      iAccepted,
      partnerAccepted,
      partnerName: partnerUser ? partnerUser.fullName : null,
      // phone only revealed once the match is confirmed
      partnerPhone: match.status === 'confirmed' && partnerUser ? partnerUser.phone : null
    };
  }

  return view;
}

// ---------- auth ----------

app.post('/api/signup', (req, res) => {
  const { fullName, phone, password, gender, transportTag } = req.body;

  if (!fullName || !phone || !password || !gender || !transportTag) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!['Male', 'Female'].includes(gender)) {
    return res.status(400).json({ error: 'Invalid gender' });
  }
  if (!['Lapper', 'Lapped', 'Both'].includes(transportTag)) {
    return res.status(400).json({ error: 'Invalid transport tag' });
  }

  const state = db.load();
  if (state.users.some((u) => u.phone === phone)) {
    return res.status(409).json({ error: 'Phone number already registered' });
  }

  const user = {
    id: db.nextId(state, 'users'),
    fullName,
    phone,
    passwordHash: bcrypt.hashSync(password, 10),
    gender,
    transportTag,
    isAdmin: false,
    isSuspended: false,
    createdAt: new Date().toISOString()
  };
  state.users.push(user);
  db.save(state);

  res.status(201).json({ user: sanitizeUser(user) });
});

app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  const state = db.load();
  const user = state.users.find((u) => u.phone === phone);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid phone or password' });
  }
  if (user.isSuspended) {
    return res.status(403).json({ error: 'This account has been suspended' });
  }

  res.json({ user: sanitizeUser(user) });
});

// ---------- duties ----------

app.get('/api/duties', (req, res) => {
  const { userId } = req.query;
  const state = db.load();
  const user = findUser(state, userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const duties = state.duties
    .filter((d) => d.userId === user.id && d.status !== 'cancelled')
    .sort((a, b) => (a.dutyDate < b.dutyDate ? 1 : -1))
    .map((d) => dutyView(state, d));

  res.json({ duties });
});

app.post('/api/duties', (req, res) => {
  const { userId, dutyDate, shift } = req.body;
  if (!userId || !dutyDate || !shift) {
    return res.status(400).json({ error: 'userId, dutyDate and shift are required' });
  }
  if (!['Morning', 'Afternoon', 'Night'].includes(shift)) {
    return res.status(400).json({ error: 'Invalid shift' });
  }

  const state = db.load();
  const user = findUser(state, userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const existing = state.duties.find(
    (d) => d.userId === user.id && d.dutyDate === dutyDate && d.shift === shift && d.status !== 'cancelled'
  );
  if (existing) {
    return res.status(409).json({ error: 'You already have a duty for that date and shift' });
  }

  const duty = {
    id: db.nextId(state, 'duties'),
    userId: user.id,
    dutyDate,
    shift,
    status: 'finding_partner',
    createdAt: new Date().toISOString()
  };
  state.duties.push(duty);

  tryAutoMatch(state, duty.id);
  db.save(state);

  res.status(201).json({ duty: dutyView(state, duty) });
});

// Switching a duty (changing date/shift) auto-cancels the existing match.
app.put('/api/duties/:id', (req, res) => {
  const dutyId = Number(req.params.id);
  const { userId, dutyDate, shift } = req.body;

  const state = db.load();
  const duty = state.duties.find((d) => d.id === dutyId && d.userId === Number(userId));
  if (!duty) return res.status(404).json({ error: 'Duty not found' });

  const existingMatch = activeMatchForDuty(state, duty.id);
  if (existingMatch) {
    cancelMatch(state, existingMatch, null);
  }

  duty.dutyDate = dutyDate || duty.dutyDate;
  duty.shift = shift || duty.shift;
  duty.status = 'finding_partner';

  tryAutoMatch(state, duty.id);
  db.save(state);

  res.json({ duty: dutyView(state, duty) });
});

// Student-initiated cancellation.
app.delete('/api/duties/:id', (req, res) => {
  const dutyId = Number(req.params.id);
  const { userId } = req.body;

  const state = db.load();
  const duty = state.duties.find((d) => d.id === dutyId && d.userId === Number(userId));
  if (!duty) return res.status(404).json({ error: 'Duty not found' });

  const existingMatch = activeMatchForDuty(state, duty.id);
  duty.status = 'cancelled';

  if (existingMatch) {
    const partnerDutyId =
      existingMatch.dutyIdA === duty.id ? existingMatch.dutyIdB : existingMatch.dutyIdA;
    cancelMatch(state, existingMatch, partnerDutyId);
  }

  db.save(state);
  res.json({ ok: true });
});

// ---------- manual pick list (near/after cutoff) ----------

app.get('/api/duties/:id/manual-candidates', (req, res) => {
  const dutyId = Number(req.params.id);
  const { userId } = req.query;

  const state = db.load();
  const duty = state.duties.find((d) => d.id === dutyId && d.userId === Number(userId));
  if (!duty) return res.status(404).json({ error: 'Duty not found' });

  if (duty.status !== 'finding_partner') {
    return res.json({ eligible: false, reason: 'Already matched', candidates: [] });
  }
  if (!matching.isPastCutoff(duty.dutyDate, duty.shift)) {
    return res.json({
      eligible: false,
      reason: 'Not within 20 minutes of duty yet',
      cutoffAt: matching.cutoffDateTime(duty.dutyDate, duty.shift).toISOString(),
      candidates: []
    });
  }

  const user = findUser(state, duty.userId);
  const candidates = matching
    .findManualCandidates(state, duty, user)
    .map((d) => {
      const candidateUser = findUser(state, d.userId);
      return {
        dutyId: d.id,
        fullName: candidateUser.fullName,
        transportTag: candidateUser.transportTag
      };
    });

  res.json({ eligible: true, candidates });
});

// Manual pick is confirmed immediately, no accept step.
app.post('/api/duties/:id/manual-pick', (req, res) => {
  const dutyId = Number(req.params.id);
  const { userId, targetDutyId } = req.body;

  const state = db.load();
  const duty = state.duties.find((d) => d.id === dutyId && d.userId === Number(userId));
  const targetDuty = state.duties.find((d) => d.id === Number(targetDutyId));

  if (!duty || !targetDuty) return res.status(404).json({ error: 'Duty not found' });
  if (duty.status !== 'finding_partner' || targetDuty.status !== 'finding_partner') {
    return res.status(409).json({ error: 'One of these duties is no longer available' });
  }

  const match = {
    id: db.nextId(state, 'matches'),
    dutyIdA: duty.id,
    dutyIdB: targetDuty.id,
    matchType: 'manual',
    acceptedA: true,
    acceptedB: true,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    cancelledAt: null
  };
  state.matches.push(match);
  duty.status = 'confirmed';
  targetDuty.status = 'confirmed';

  db.save(state);
  res.status(201).json({ duty: dutyView(state, duty) });
});

// ---------- match accept / decline ----------

app.post('/api/matches/:id/accept', (req, res) => {
  const matchId = Number(req.params.id);
  const { userId } = req.body;

  const state = db.load();
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const dutyA = state.duties.find((d) => d.id === match.dutyIdA);
  const dutyB = state.duties.find((d) => d.id === match.dutyIdB);
  const isA = dutyA.userId === Number(userId);
  const isB = dutyB.userId === Number(userId);
  if (!isA && !isB) return res.status(403).json({ error: 'Not part of this match' });

  if (isA) match.acceptedA = true;
  if (isB) match.acceptedB = true;

  if (match.acceptedA && match.acceptedB) {
    match.status = 'confirmed';
    match.confirmedAt = new Date().toISOString();
    dutyA.status = 'confirmed';
    dutyB.status = 'confirmed';
  }

  db.save(state);
  res.json({ duty: dutyView(state, isA ? dutyA : dutyB) });
});

// One-tap decline. Works for pending auto-matches and as a safety net on
// manual picks that were already confirmed.
app.post('/api/matches/:id/decline', (req, res) => {
  const matchId = Number(req.params.id);
  const { userId } = req.body;

  const state = db.load();
  const match = state.matches.find((m) => m.id === matchId);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const dutyA = state.duties.find((d) => d.id === match.dutyIdA);
  const dutyB = state.duties.find((d) => d.id === match.dutyIdB);
  const decliningDuty = dutyA.userId === Number(userId) ? dutyA : dutyB;
  const otherDuty = decliningDuty.id === dutyA.id ? dutyB : dutyA;

  match.status = 'declined';
  match.cancelledAt = new Date().toISOString();
  decliningDuty.status = 'finding_partner';
  otherDuty.status = 'finding_partner';

  // Try to re-match the other student right away.
  tryAutoMatch(state, otherDuty.id);

  db.save(state);
  res.json({ ok: true });
});

// ---------- admin ----------

app.post('/api/admin/promote', (req, res) => {
  const { phone, secret } = req.body;
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Invalid secret' });

  const state = db.load();
  const user = state.users.find((u) => u.phone === phone);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.isAdmin = true;
  db.save(state);
  res.json({ user: sanitizeUser(user) });
});

app.get('/api/admin/users', (req, res) => {
  const state = db.load();
  if (!requireAdmin(state, req.query.adminUserId, res)) return;
  res.json({ users: state.users.map(sanitizeUser) });
});

app.get('/api/admin/duties', (req, res) => {
  const state = db.load();
  if (!requireAdmin(state, req.query.adminUserId, res)) return;
  const duties = state.duties.map((d) => ({
    ...dutyView(state, d),
    userId: d.userId,
    ownerName: findUser(state, d.userId)?.fullName
  }));
  res.json({ duties });
});

app.get('/api/admin/matches', (req, res) => {
  const state = db.load();
  if (!requireAdmin(state, req.query.adminUserId, res)) return;
  res.json({ matches: state.matches });
});

app.get('/api/admin/waiting-pool', (req, res) => {
  const state = db.load();
  if (!requireAdmin(state, req.query.adminUserId, res)) return;
  const waiting = state.duties
    .filter((d) => d.status === 'finding_partner')
    .map((d) => ({
      ...dutyView(state, d),
      userId: d.userId,
      ownerName: findUser(state, d.userId)?.fullName,
      gender: findUser(state, d.userId)?.gender,
      transportTag: findUser(state, d.userId)?.transportTag
    }));
  res.json({ waiting });
});

app.post('/api/admin/pair', (req, res) => {
  const { adminUserId, dutyIdA, dutyIdB } = req.body;
  const state = db.load();
  if (!requireAdmin(state, adminUserId, res)) return;

  const dutyA = state.duties.find((d) => d.id === Number(dutyIdA));
  const dutyB = state.duties.find((d) => d.id === Number(dutyIdB));
  if (!dutyA || !dutyB) return res.status(404).json({ error: 'Duty not found' });

  const match = {
    id: db.nextId(state, 'matches'),
    dutyIdA: dutyA.id,
    dutyIdB: dutyB.id,
    matchType: 'manual',
    acceptedA: true,
    acceptedB: true,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    cancelledAt: null
  };
  state.matches.push(match);
  dutyA.status = 'confirmed';
  dutyB.status = 'confirmed';

  state.adminActions.push({
    id: db.nextId(state, 'adminActions'),
    adminId: Number(adminUserId),
    action: 'manual_pair',
    targetMatchId: match.id,
    createdAt: new Date().toISOString()
  });

  db.save(state);
  res.status(201).json({ match });
});

app.post('/api/admin/unpair', (req, res) => {
  const { adminUserId, matchId } = req.body;
  const state = db.load();
  if (!requireAdmin(state, adminUserId, res)) return;

  const match = state.matches.find((m) => m.id === Number(matchId));
  if (!match) return res.status(404).json({ error: 'Match not found' });

  cancelMatch(state, match, null);

  state.adminActions.push({
    id: db.nextId(state, 'adminActions'),
    adminId: Number(adminUserId),
    action: 'manual_unpair',
    targetMatchId: match.id,
    createdAt: new Date().toISOString()
  });

  db.save(state);
  res.json({ ok: true });
});

app.post('/api/admin/suspend', (req, res) => {
  const { adminUserId, userId, suspended } = req.body;
  const state = db.load();
  if (!requireAdmin(state, adminUserId, res)) return;

  const user = findUser(state, userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.isSuspended = Boolean(suspended);

  db.save(state);
  res.json({ user: sanitizeUser(user) });
});

app.delete('/api/admin/users/:id', (req, res) => {
  const { adminUserId } = req.body;
  const state = db.load();
  if (!requireAdmin(state, adminUserId, res)) return;

  const userId = Number(req.params.id);
  state.users = state.users.filter((u) => u.id !== userId);
  state.duties = state.duties.filter((d) => d.userId !== userId);

  db.save(state);
  res.json({ ok: true });
});

app.get('/api/admin/stats', (req, res) => {
  const state = db.load();
  if (!requireAdmin(state, req.query.adminUserId, res)) return;

  res.json({
    totalUsers: state.users.length,
    totalDuties: state.duties.length,
    waiting: state.duties.filter((d) => d.status === 'finding_partner').length,
    matched: state.duties.filter((d) => d.status === 'match_found').length,
    confirmed: state.duties.filter((d) => d.status === 'confirmed').length,
    cancelled: state.duties.filter((d) => d.status === 'cancelled').length,
    autoMatches: state.matches.filter((m) => m.matchType === 'auto').length,
    manualMatches: state.matches.filter((m) => m.matchType === 'manual').length
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Maraba Ride Match running on port ${PORT}`);
});
