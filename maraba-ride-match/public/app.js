const app = document.getElementById('app');
let currentUser = JSON.parse(localStorage.getItem('mrm_user') || 'null');

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function setUser(user) {
  currentUser = user;
  localStorage.setItem('mrm_user', JSON.stringify(user));
}

function logout() {
  currentUser = null;
  localStorage.removeItem('mrm_user');
  render();
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
}

function statusLabel(status) {
  return {
    finding_partner: 'Finding Partner',
    match_found: 'Match Found',
    confirmed: 'Confirmed',
    cancelled: 'Cancelled'
  }[status] || status;
}

// ---------- auth screens ----------

function renderAuth() {
  app.innerHTML = `
    <h1>Maraba Ride Match</h1>
    <div class="subtitle">Automatic daily transport pairing for UITH clinical posting</div>
    <div class="row">
      <button id="tabLogin" style="width:48%">Log in</button>
      <button id="tabSignup" class="secondary" style="width:48%">Sign up</button>
    </div>
    <div id="authForm"></div>
    <div class="error" id="authError"></div>
  `;
  document.getElementById('tabLogin').onclick = () => renderLoginForm();
  document.getElementById('tabSignup').onclick = () => renderSignupForm();
  renderLoginForm();
}

function renderLoginForm() {
  document.getElementById('authForm').innerHTML = `
    <label>Phone number</label>
    <input id="phone" type="tel" />
    <label>Password</label>
    <input id="password" type="password" />
    <button id="submitLogin">Log in</button>
  `;
  document.getElementById('submitLogin').onclick = async () => {
    try {
      const phone = document.getElementById('phone').value.trim();
      const password = document.getElementById('password').value;
      const { user } = await api('POST', '/api/login', { phone, password });
      setUser(user);
      render();
    } catch (e) {
      document.getElementById('authError').textContent = e.message;
    }
  };
}

function renderSignupForm() {
  document.getElementById('authForm').innerHTML = `
    <label>Full name</label>
    <input id="fullName" />
    <label>Phone number</label>
    <input id="phone" type="tel" />
    <label>Password</label>
    <input id="password" type="password" />
    <label>Gender</label>
    <select id="gender">
      <option value="Female">Female</option>
      <option value="Male">Male</option>
    </select>
    <label>Transport tag</label>
    <select id="transportTag">
      <option value="Lapper">Lapper</option>
      <option value="Lapped">Lapped</option>
      <option value="Both">Both</option>
    </select>
    <button id="submitSignup">Create account</button>
  `;
  document.getElementById('submitSignup').onclick = async () => {
    try {
      const payload = {
        fullName: document.getElementById('fullName').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        password: document.getElementById('password').value,
        gender: document.getElementById('gender').value,
        transportTag: document.getElementById('transportTag').value
      };
      const { user } = await api('POST', '/api/signup', payload);
      setUser(user);
      render();
    } catch (e) {
      document.getElementById('authError').textContent = e.message;
    }
  };
}

// ---------- dashboard ----------

async function renderDashboard() {
  app.innerHTML = `
    <div class="top-nav">
      <div>
        <h1>Hi, ${currentUser.fullName.split(' ')[0]}</h1>
        <div class="subtitle">${currentUser.transportTag} &middot; ${currentUser.gender}</div>
      </div>
      <div>
        ${currentUser.isAdmin ? '<button class="secondary" id="goAdmin" style="width:auto;margin-right:8px;">Admin</button>' : ''}
        <button class="secondary" id="logoutBtn" style="width:auto;">Log out</button>
      </div>
    </div>

    <div class="card">
      <strong>Add duty</strong>
      <label>Duty date</label>
      <input id="dutyDate" type="date" />
      <label>Shift</label>
      <select id="shift">
        <option value="Morning">Morning (trip by 6:45am)</option>
        <option value="Afternoon">Afternoon (trip by 1:45pm)</option>
        <option value="Night">Night (trip by 5:45pm)</option>
      </select>
      <button id="addDuty">Add duty</button>
      <div class="error" id="dutyError"></div>
    </div>

    <h3 style="margin-top:24px;">Upcoming Duties</h3>
    <div id="duties">Loading...</div>
  `;

  document.getElementById('logoutBtn').onclick = logout;
  if (currentUser.isAdmin) {
    document.getElementById('goAdmin').onclick = () => renderAdmin();
  }
  document.getElementById('addDuty').onclick = async () => {
    try {
      const dutyDate = document.getElementById('dutyDate').value;
      const shift = document.getElementById('shift').value;
      if (!dutyDate) throw new Error('Pick a date');
      await api('POST', '/api/duties', { userId: currentUser.id, dutyDate, shift });
      loadDuties();
    } catch (e) {
      document.getElementById('dutyError').textContent = e.message;
    }
  };

  loadDuties();
}

async function loadDuties() {
  const container = document.getElementById('duties');
  const { duties } = await api('GET', `/api/duties?userId=${currentUser.id}`);
  if (duties.length === 0) {
    container.innerHTML = '<div class="subtitle">No duties added yet.</div>';
    return;
  }
  container.innerHTML = '';
  duties.forEach((duty) => container.appendChild(renderDutyCard(duty)));
}

function renderDutyCard(duty) {
  const div = document.createElement('div');
  div.className = 'card';

  let matchHtml = '';
  if (duty.match) {
    const m = duty.match;
    if (m.status === 'confirmed') {
      matchHtml = `
        <div style="margin-top:8px;">
          Partner: <strong>${m.partnerName}</strong><br/>
          Phone: <strong>${m.partnerPhone}</strong>
        </div>`;
    } else if (m.status === 'pending') {
      matchHtml = `
        <div style="margin-top:8px;">
          Potential partner: <strong>${m.partnerName}</strong><br/>
          ${m.iAccepted ? 'You accepted, waiting on them.' : ''}
        </div>
        <div class="row" style="margin-top:8px;">
          ${!m.iAccepted ? `<button data-accept="${m.id}" style="width:48%;">Accept</button>` : ''}
          <button data-decline="${m.id}" class="danger" style="width:48%;">Decline</button>
        </div>`;
    }
  } else if (duty.status === 'finding_partner') {
    if (duty.isPastCutoff) {
      matchHtml = `
        <div class="error" style="margin-top:8px;">No partner found yet. Pick someone below.</div>
        <div id="manual-${duty.id}" style="margin-top:8px;">Loading options...</div>`;
    } else {
      matchHtml = `<div class="subtitle" style="margin-top:8px;">Still finding a partner. You'll get manual options 20 minutes before duty if nobody's found by then.</div>`;
    }
  }

  div.innerHTML = `
    <div class="row">
      <div>
        <strong>${duty.dutyDate}</strong> &middot; ${duty.shift}
      </div>
      <span class="badge ${duty.status}">${statusLabel(duty.status)}</span>
    </div>
    <div class="subtitle">Trip must start by ${new Date(duty.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    ${matchHtml}
    ${duty.status !== 'cancelled' && duty.status !== 'confirmed' ? `<button data-cancel="${duty.id}" class="secondary" style="margin-top:8px;">Cancel duty</button>` : ''}
  `;

  const acceptBtn = div.querySelector('[data-accept]');
  if (acceptBtn) {
    acceptBtn.onclick = async () => {
      await api('POST', `/api/matches/${acceptBtn.dataset.accept}/accept`, { userId: currentUser.id });
      loadDuties();
    };
  }
  const declineBtn = div.querySelector('[data-decline]');
  if (declineBtn) {
    declineBtn.onclick = async () => {
      await api('POST', `/api/matches/${declineBtn.dataset.decline}/decline`, { userId: currentUser.id });
      loadDuties();
    };
  }
  const cancelBtn = div.querySelector('[data-cancel]');
  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      await api('DELETE', `/api/duties/${cancelBtn.dataset.cancel}`, { userId: currentUser.id });
      loadDuties();
    };
  }

  if (duty.status === 'finding_partner' && duty.isPastCutoff) {
    loadManualCandidates(duty.id);
  }

  return div;
}

async function loadManualCandidates(dutyId) {
  const el = document.getElementById(`manual-${dutyId}`);
  if (!el) return;
  const { candidates } = await api('GET', `/api/duties/${dutyId}/manual-candidates?userId=${currentUser.id}`);
  if (candidates.length === 0) {
    el.innerHTML = '<div class="subtitle">No one else is waiting right now. Check back shortly.</div>';
    return;
  }
  el.innerHTML = '';
  candidates.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'candidate';
    row.innerHTML = `<span>${c.fullName} (${c.transportTag})</span><button style="width:auto;">Pick</button>`;
    row.querySelector('button').onclick = async () => {
      await api('POST', `/api/duties/${dutyId}/manual-pick`, { userId: currentUser.id, targetDutyId: c.dutyId });
      loadDuties();
    };
    el.appendChild(row);
  });
}

// ---------- admin ----------

async function renderAdmin() {
  app.innerHTML = `
    <div class="top-nav">
      <h1>Admin</h1>
      <button class="secondary" id="backBtn" style="width:auto;">Back</button>
    </div>
    <div id="stats" class="card">Loading stats...</div>
    <h3>Waiting Pool</h3>
    <div id="waitingPool">Loading...</div>
    <h3>All Users</h3>
    <div id="usersTable">Loading...</div>
  `;
  document.getElementById('backBtn').onclick = renderDashboard;

  const stats = await api('GET', `/api/admin/stats?adminUserId=${currentUser.id}`);
  document.getElementById('stats').innerHTML = `
    Users: ${stats.totalUsers} &middot; Waiting: ${stats.waiting} &middot;
    Matched: ${stats.matched} &middot; Confirmed: ${stats.confirmed} &middot;
    Auto matches: ${stats.autoMatches} &middot; Manual matches: ${stats.manualMatches}
  `;

  const { waiting } = await api('GET', `/api/admin/waiting-pool?adminUserId=${currentUser.id}`);
  const poolDiv = document.getElementById('waitingPool');
  if (waiting.length === 0) {
    poolDiv.innerHTML = '<div class="subtitle">Nobody waiting.</div>';
  } else {
    poolDiv.innerHTML = waiting
      .map((w) => `<div class="candidate"><span>${w.ownerName} &middot; ${w.dutyDate} ${w.shift} &middot; ${w.gender} &middot; ${w.transportTag}</span></div>`)
      .join('');
  }

  const { users } = await api('GET', `/api/admin/users?adminUserId=${currentUser.id}`);
  const usersDiv = document.getElementById('usersTable');
  usersDiv.innerHTML = `
    <table>
      <tr><th>Name</th><th>Phone</th><th>Tag</th><th>Status</th><th></th></tr>
      ${users
        .map(
          (u) => `
        <tr>
          <td>${u.fullName}</td>
          <td>${u.phone}</td>
          <td>${u.transportTag}</td>
          <td>${u.isSuspended ? 'Suspended' : 'Active'}</td>
          <td><button class="link" data-suspend="${u.id}" data-value="${!u.isSuspended}">${u.isSuspended ? 'Unsuspend' : 'Suspend'}</button></td>
        </tr>`
        )
        .join('')}
    </table>
  `;
  usersDiv.querySelectorAll('[data-suspend]').forEach((btn) => {
    btn.onclick = async () => {
      await api('POST', '/api/admin/suspend', {
        adminUserId: currentUser.id,
        userId: btn.dataset.suspend,
        suspended: btn.dataset.value === 'true'
      });
      renderAdmin();
    };
  });
}

// ---------- router ----------

function render() {
  if (!currentUser) {
    renderAuth();
  } else {
    renderDashboard();
  }
}

render();
