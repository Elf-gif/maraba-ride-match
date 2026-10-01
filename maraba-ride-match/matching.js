// Shift start times (24-hour). Trips must have started by these times.
const SHIFT_START = {
  Morning: { hour: 6, minute: 45 },
  Afternoon: { hour: 13, minute: 45 },
  Night: { hour: 17, minute: 45 }
};

const CUTOFF_MINUTES_BEFORE = 20;

// Only Lapper + Lapper is blocked. Everything else can pair.
function tagsCompatible(tagA, tagB) {
  return !(tagA === 'Lapper' && tagB === 'Lapper');
}

function shiftStartDateTime(dutyDate, shift) {
  const t = SHIFT_START[shift];
  const [y, m, d] = dutyDate.split('-').map(Number);
  return new Date(y, m - 1, d, t.hour, t.minute, 0);
}

function cutoffDateTime(dutyDate, shift) {
  const start = shiftStartDateTime(dutyDate, shift);
  return new Date(start.getTime() - CUTOFF_MINUTES_BEFORE * 60 * 1000);
}

function isPastCutoff(dutyDate, shift, now = new Date()) {
  return now.getTime() >= cutoffDateTime(dutyDate, shift).getTime();
}

// Find the best waiting duty to auto-pair with a given duty.
// Same date, same shift, same gender, compatible tag, still finding_partner, not the same user.
function findCandidate(state, duty, user) {
  const candidates = state.duties.filter((d) => {
    if (d.id === duty.id) return false;
    if (d.status !== 'finding_partner') return false;
    if (d.dutyDate !== duty.dutyDate) return false;
    if (d.shift !== duty.shift) return false;

    const candidateUser = state.users.find((u) => u.id === d.userId);
    if (!candidateUser || candidateUser.id === user.id) return false;
    if (candidateUser.gender !== user.gender) return false;
    if (!tagsCompatible(user.transportTag, candidateUser.transportTag)) return false;

    return true;
  });

  if (candidates.length === 0) return null;
  // First-come, first-matched: earliest created duty wins.
  candidates.sort((a, b) => a.id - b.id);
  return candidates[0];
}

// All valid manual-pick options for a duty that's past (or near) cutoff and still unmatched.
function findManualCandidates(state, duty, user) {
  return state.duties.filter((d) => {
    if (d.id === duty.id) return false;
    if (d.status !== 'finding_partner') return false;
    if (d.dutyDate !== duty.dutyDate) return false;
    if (d.shift !== duty.shift) return false;

    const candidateUser = state.users.find((u) => u.id === d.userId);
    if (!candidateUser || candidateUser.id === user.id) return false;
    if (candidateUser.gender !== user.gender) return false;
    if (!tagsCompatible(user.transportTag, candidateUser.transportTag)) return false;

    return true;
  });
}

module.exports = {
  SHIFT_START,
  CUTOFF_MINUTES_BEFORE,
  tagsCompatible,
  shiftStartDateTime,
  cutoffDateTime,
  isPastCutoff,
  findCandidate,
  findManualCandidates
};
