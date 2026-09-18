// User session state
let currentUser = null;
let activeScreen = 'dashboard';
let allPatients = [];
let allInventory = [];
let allAppointments = [];
let selectedPatientId = null;
let rxItemIndex = 0;
let syncCleanup = null;
let apiKeyVisible = false;

// Setup Wizard State (5 Steps)
let wizardCurrentStep = 1;
let allDatabaseRoles = [];
let allSystemModules = [
  { id: 1, name: 'Dashboard', slug: 'dashboard' },
  { id: 2, name: 'Appointments', slug: 'appointments' },
  { id: 3, name: 'Consultations', slug: 'consultations' },
  { id: 4, name: 'Patient Registry', slug: 'patient_registry' },
  { id: 5, name: 'Pharmacy', slug: 'pharmacy' },
  { id: 6, name: 'Financial Reports', slug: 'financial_reports' }
];

// Dynamic list of user accounts to create in Step 2
let wizardUsers = [
  {
    id: 1,
    full_name: 'Dr. John Silva',
    username: 'doctor',
    password: 'doctor123',
    role_slug: 'doctor',
    status: 'active'
  },
  {
    id: 2,
    full_name: 'Jane Perera',
    username: 'receptionist',
    password: 'receptionist123',
    role_slug: 'receptionist',
    status: 'active'
  },
  {
    id: 3,
    full_name: 'Nimal Perera',
    username: 'pharmacist',
    password: 'pharmacist123',
    role_slug: 'pharmacist',
    status: 'active'
  }
];

// Map of username -> array of assigned module slugs
let wizardUserModules = {
  doctor: ['dashboard', 'appointments', 'consultations', 'patient_registry', 'pharmacy', 'financial_reports'],
  receptionist: ['dashboard', 'appointments', 'patient_registry'],
  pharmacist: ['dashboard', 'pharmacy']
};
let selectedWizardModuleUsername = 'doctor';

// Active prescription items for doctor patient profile
let currentPrescriptionItems = [];

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  // Set default dates
  const todayStr = new Date().toISOString().split('T')[0];
  const dateElements = ['dashStartDate', 'dashEndDate', 'repStartDate', 'repEndDate', 'apptDateFilter', 'deskApptDate', 'consultationDateFilter'];
  dateElements.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = todayStr;
  });

  // Initialize theme
  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-theme');
  }

  // Set up sync update listener
  if (window.api && window.api.onSyncUpdate) {
    syncCleanup = window.api.onSyncUpdate((syncData) => {
      updateSyncStatusUI(syncData);
    });
    // Query initial sync status
    window.api.getSyncStatus().then(updateSyncStatusUI);
  }

  // Check initial installation status
  await checkSystemInstallationFlow();
});

// THEME TOGGLE
function toggleTheme() {
  document.body.classList.toggle('light-theme');
  const theme = document.body.classList.contains('light-theme') ? 'light' : 'dark';
  localStorage.setItem('theme', theme);
}

// ==========================================
// FIRST INSTALLATION / SETUP WIZARD (5 STEPS)
// ==========================================

async function checkSystemInstallationFlow() {
  try {
    const isInstalled = await window.api.checkInstallation();
    if (!isInstalled) {
      openInstallationWizard();
    } else {
      showLoginScreen(true);
    }
  } catch (error) {
    console.error('Error checking installation status:', error);
    showLoginScreen(true);
  }
}

async function openInstallationWizard() {
  const wizardOverlay = document.getElementById('installationWizardOverlay');
  const loginOverlay = document.getElementById('loginScreen');
  const appContainer = document.getElementById('appContainer');

  if (wizardOverlay) wizardOverlay.style.display = 'flex';
  if (loginOverlay) loginOverlay.style.display = 'none';
  if (appContainer) appContainer.style.display = 'none';

  try {
    const modules = await window.api.getModules();
    if (modules && modules.length > 0) {
      allSystemModules = modules;
    }
    const roles = await window.api.getRoles();
    if (roles && roles.length > 0) {
      allDatabaseRoles = roles;
    }
  } catch (e) {
    console.warn('Could not retrieve modules or roles:', e);
  }

  goToWizardStep(1);
}

function goToWizardStep(step) {
  wizardCurrentStep = step;

  // Update 5-step indicators and panels
  for (let i = 1; i <= 5; i++) {
    const stepEl = document.getElementById(`wizardStepIndicator-${i}`);
    const lineEl = document.getElementById(`wizardStepLine-${i}`);
    const paneEl = document.getElementById(`wizardPane-${i}`);

    if (stepEl) {
      stepEl.className = 'wizard-step';
      if (i === step) stepEl.classList.add('active');
      if (i < step) stepEl.classList.add('completed');
    }

    if (lineEl) {
      lineEl.className = 'step-line';
      if (i < step) lineEl.classList.add('completed');
    }

    if (paneEl) {
      paneEl.className = 'wizard-step-pane';
      if (i === step) paneEl.classList.add('active');
    }
  }

  if (step === 2) {
    renderWizardUserCards();
  } else if (step === 3) {
    populateWizardModuleUserSelect();
    renderWizardModuleCheckboxes();
  } else if (step === 4) {
    renderWizardReviewSummary();
  }
}

// STEP 2: USER CARDS & DYNAMIC ROLE RENDERING
function renderWizardUserCards() {
  const container = document.getElementById('wizardUserAccountsContainer');
  if (!container) return;
  container.innerHTML = '';

  const roles = allDatabaseRoles.length > 0 ? allDatabaseRoles : [
    { name: 'Doctor', slug: 'doctor' },
    { name: 'Receptionist', slug: 'receptionist' },
    { name: 'Pharmacist', slug: 'pharmacist' }
  ];

  wizardUsers.forEach((u, idx) => {
    const card = document.createElement('div');
    card.className = 'account-card';
    card.id = `wizUserCard-${idx}`;

    let roleOptionsHtml = '';
    roles.forEach(r => {
      const selected = (u.role_slug === r.slug || u.role_slug === r.name.toLowerCase()) ? 'selected' : '';
      roleOptionsHtml += `<option value="${r.slug}" ${selected}>${r.name}</option>`;
    });

    const roleBadgeClass = u.role_slug === 'doctor' ? 'doctor' : (u.role_slug === 'pharmacist' ? 'pharmacist' : 'receptionist');

    card.innerHTML = `
      <div class="account-card-header">
        <span class="account-role-badge ${roleBadgeClass}" id="wizUserBadge-${idx}">${(u.role_slug || 'USER').toUpperCase()}</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          ${wizardUsers.length > 1 ? `<button type="button" class="btn btn-danger btn-xs" onclick="removeWizardUserCard(${idx})" title="Remove user">&times; Remove</button>` : ''}
        </div>
      </div>
      <div class="form-group">
        <label>Full Name *</label>
        <input type="text" id="wizUserFullName-${idx}" placeholder="e.g. Dr. John Silva" value="${u.full_name}" oninput="updateWizardUserData(${idx}, 'full_name', this.value)" required>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex: 1;">
          <label>Username *</label>
          <input type="text" id="wizUserUsername-${idx}" placeholder="username" value="${u.username}" oninput="updateWizardUserData(${idx}, 'username', this.value)" required autocomplete="off">
        </div>
        <div class="form-group" style="flex: 1;">
          <label>Role *</label>
          <select id="wizUserRole-${idx}" onchange="updateWizardUserData(${idx}, 'role_slug', this.value)" style="padding: 7px 10px;">
            ${roleOptionsHtml}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex: 1.5;">
          <label>Password * (Min 6 chars)</label>
          <input type="password" id="wizUserPassword-${idx}" placeholder="••••••••" value="${u.password}" oninput="updateWizardUserData(${idx}, 'password', this.value)" required autocomplete="new-password">
        </div>
        <div class="form-group" style="flex: 1;">
          <label>Account Status</label>
          <select id="wizUserStatus-${idx}" onchange="updateWizardUserData(${idx}, 'status', this.value)" style="padding: 7px 10px;">
            <option value="active" ${u.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="inactive" ${u.status === 'inactive' ? 'selected' : ''}>Inactive</option>
          </select>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function updateWizardUserData(index, field, value) {
  if (!wizardUsers[index]) return;
  const oldUsername = wizardUsers[index].username;
  wizardUsers[index][field] = value;

  if (field === 'role_slug') {
    const badge = document.getElementById(`wizUserBadge-${index}`);
    if (badge) {
      badge.textContent = value.toUpperCase();
      badge.className = `account-role-badge ${value === 'doctor' ? 'doctor' : (value === 'pharmacist' ? 'pharmacist' : 'receptionist')}`;
    }
    // Update default module assignments if not customized yet
    if (!wizardUserModules[wizardUsers[index].username]) {
      if (value === 'doctor') {
        wizardUserModules[wizardUsers[index].username] = allSystemModules.map(m => m.slug);
      } else if (value === 'receptionist') {
        wizardUserModules[wizardUsers[index].username] = ['dashboard', 'appointments', 'patient_registry'];
      } else if (value === 'pharmacist') {
        wizardUserModules[wizardUsers[index].username] = ['dashboard', 'pharmacy'];
      }
    }
  }

  if (field === 'username' && oldUsername !== value) {
    if (wizardUserModules[oldUsername]) {
      wizardUserModules[value] = wizardUserModules[oldUsername];
      delete wizardUserModules[oldUsername];
    }
  }
}

// ==========================================
// DYNAMIC ROLE CREATION & ROLE MANAGEMENT
// ==========================================
let createRoleContext = 'wizard'; // 'wizard' or 'in_app'

function openCreateRoleModal(context = 'wizard') {
  createRoleContext = context;
  const form = document.getElementById('createRoleForm');
  if (form) form.reset();
  
  const errEl = document.getElementById('createRoleError');
  if (errEl) {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }

  // Set default checkboxes (dashboard checked)
  const chks = document.querySelectorAll('.new-role-module-chk');
  chks.forEach(c => {
    c.checked = (c.value === 'dashboard');
  });

  const modal = document.getElementById('createRoleModal');
  if (modal) modal.classList.add('active');
}

async function handleCreateRoleSubmit(event) {
  event.preventDefault();
  const nameInput = document.getElementById('newRoleName');
  const descInput = document.getElementById('newRoleDesc');
  const errEl = document.getElementById('createRoleError');
  if (errEl) errEl.style.display = 'none';

  const name = nameInput ? nameInput.value.trim() : '';
  const desc = descInput ? descInput.value.trim() : '';

  if (!name) {
    if (errEl) {
      errEl.textContent = 'Role name is required.';
      errEl.style.display = 'block';
    }
    return;
  }

  const selectedModules = Array.from(document.querySelectorAll('.new-role-module-chk:checked')).map(c => c.value);

  try {
    const createdRole = await window.api.createRole({
      name: name,
      description: desc,
      default_modules: selectedModules,
      permissions: []
    });

    // Refresh memory cache of database roles
    const updatedRoles = await window.api.getRoles();
    if (updatedRoles && updatedRoles.length > 0) {
      allDatabaseRoles = updatedRoles;
    }

    closeModal('createRoleModal');

    if (createRoleContext === 'wizard') {
      renderWizardUserCards();
      alert(`Role "${createdRole.name}" created successfully!\nYou can now select it from the role dropdown on user account cards.`);
    } else {
      await renderRoleManagementList();
      alert(`Role "${createdRole.name}" created successfully!`);
    }
  } catch (error) {
    console.error('Error creating role:', error);
    if (errEl) {
      errEl.textContent = error.message || 'Failed to create role.';
      errEl.style.display = 'block';
    } else {
      alert(`Failed to create role: ${error.message}`);
    }
  }
}

async function openRoleManagementModal() {
  const modal = document.getElementById('roleManagementModal');
  if (modal) modal.classList.add('active');
  await renderRoleManagementList();
}

async function renderRoleManagementList() {
  const container = document.getElementById('roleManagementList');
  if (!container) return;
  container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 12px;">Loading roles...</div>';

  try {
    const roles = await window.api.getRoles();
    allDatabaseRoles = roles;

    if (!roles || roles.length === 0) {
      container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 12px;">No roles found in database.</div>';
      return;
    }

    container.innerHTML = '';
    roles.forEach(role => {
      let modules = [];
      try {
        modules = typeof role.default_modules === 'string' ? JSON.parse(role.default_modules || '[]') : (role.default_modules || []);
      } catch (e) {
        modules = [];
      }

      const isSystem = Boolean(role.is_system);
      const isActive = role.status === 'active';
      const statusBadge = isActive 
        ? '<span class="badge-status seen" style="font-size: 11px;">Active</span>'
        : '<span class="badge-status" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-size: 11px;">Inactive</span>';
      
      const typeBadge = isSystem
        ? '<span style="font-size: 10px; background: rgba(14, 165, 233, 0.15); color: var(--primary); padding: 2px 6px; border-radius: 4px; font-weight: 700;">SYSTEM</span>'
        : '<span style="font-size: 10px; background: rgba(168, 85, 247, 0.15); color: #a855f7; padding: 2px 6px; border-radius: 4px; font-weight: 700;">CUSTOM</span>';

      const modulePills = modules.length > 0 
        ? modules.map(m => `<span style="font-size: 11px; background: var(--bg-hover); color: var(--text-secondary); padding: 2px 6px; border-radius: 4px;">${m}</span>`).join(' ')
        : '<span style="font-size: 11px; color: var(--text-muted);">None</span>';

      const card = document.createElement('div');
      card.className = 'role-item-card';
      card.style.cssText = 'background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px;';
      
      let toggleActionBtn = '';
      if (!isSystem) {
        const nextStatus = isActive ? 'inactive' : 'active';
        const btnClass = isActive ? 'btn-danger' : 'btn-success';
        const btnText = isActive ? 'Deactivate' : 'Activate';
        toggleActionBtn = `<button type="button" class="btn ${btnClass} btn-xs" onclick="handleToggleRoleStatus(${role.id}, '${nextStatus}')">${btnText}</button>`;
      }

      card.innerHTML = `
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <strong style="font-size: 14px;">${role.name}</strong>
            <code>${role.slug}</code>
            ${typeBadge}
            ${statusBadge}
          </div>
          ${role.description ? `<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">${role.description}</div>` : ''}
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span style="font-size: 11px; color: var(--text-muted);">Default Modules:</span>
            ${modulePills}
          </div>
        </div>
        <div>
          ${toggleActionBtn}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load roles list:', err);
    container.innerHTML = `<div style="color: #ef4444; padding: 10px;">Failed to load roles: ${err.message}</div>`;
  }
}

async function handleToggleRoleStatus(roleId, newStatus) {
  try {
    await window.api.toggleRoleStatus(roleId, newStatus);
    await renderRoleManagementList();
  } catch (error) {
    console.error('Failed to toggle role status:', error);
    alert(error.message || 'Failed to update role status.');
  }
}

function addNewWizardUserCard() {
  const defaultRole = allDatabaseRoles.find(r => r.slug === 'receptionist') || allDatabaseRoles[0] || { slug: 'receptionist' };
  wizardUsers.push({
    id: Date.now(),
    full_name: '',
    username: '',
    password: '',
    role_slug: defaultRole.slug,
    status: 'active'
  });
  renderWizardUserCards();
}

function removeWizardUserCard(index) {
  if (wizardUsers.length <= 1) {
    alert('At least one user account is required.');
    return;
  }
  const removed = wizardUsers.splice(index, 1)[0];
  if (removed && removed.username) {
    delete wizardUserModules[removed.username];
  }
  renderWizardUserCards();
}

function validateStep2AndProceed() {
  const errEl = document.getElementById('wizardStep2Error');
  errEl.style.display = 'none';

  if (wizardUsers.length === 0) {
    errEl.textContent = 'At least one user account must be created.';
    errEl.style.display = 'block';
    return;
  }

  const usernamesSeen = new Set();

  for (let i = 0; i < wizardUsers.length; i++) {
    const u = wizardUsers[i];
    const fullName = (u.full_name || '').trim();
    const uName = (u.username || '').trim();
    const pass = u.password || '';

    if (!fullName) {
      errEl.textContent = `User #${i + 1}: Full Name is required.`;
      errEl.style.display = 'block';
      return;
    }

    if (!uName) {
      errEl.textContent = `User #${i + 1} (${fullName}): Username is required.`;
      errEl.style.display = 'block';
      return;
    }

    if (usernamesSeen.has(uName.toLowerCase())) {
      errEl.textContent = `Duplicate username detected: "${uName}". Usernames must be unique.`;
      errEl.style.display = 'block';
      return;
    }
    usernamesSeen.add(uName.toLowerCase());

    if (!pass || pass.length < 6) {
      errEl.textContent = `User "${uName}": Password must be at least 6 characters long.`;
      errEl.style.display = 'block';
      return;
    }

    // Initialize default modules for each user if not present
    if (!wizardUserModules[uName]) {
      if (u.role_slug === 'doctor') {
        wizardUserModules[uName] = allSystemModules.map(m => m.slug);
      } else if (u.role_slug === 'receptionist') {
        wizardUserModules[uName] = ['dashboard', 'appointments', 'patient_registry'];
      } else if (u.role_slug === 'pharmacist') {
        wizardUserModules[uName] = ['dashboard', 'pharmacy'];
      } else {
        const foundRole = allDatabaseRoles.find(r => r.slug === u.role_slug);
        try {
          wizardUserModules[uName] = foundRole && foundRole.default_modules ? JSON.parse(foundRole.default_modules) : ['dashboard'];
        } catch (e) {
          wizardUserModules[uName] = ['dashboard'];
        }
      }
    }
  }

  goToWizardStep(3);
}

// STEP 3: MODULE PERMISSIONS DROPDOWN & CHECKBOXES
function populateWizardModuleUserSelect() {
  const select = document.getElementById('wizardModuleUserSelect');
  if (!select) return;

  select.innerHTML = '';
  wizardUsers.forEach(u => {
    const roleLabel = (u.role_slug || 'Staff').toUpperCase();
    select.innerHTML += `<option value="${u.username}">${u.full_name} (${u.username} • ${roleLabel})</option>`;
  });

  if (!wizardUsers.some(u => u.username === selectedWizardModuleUsername)) {
    selectedWizardModuleUsername = wizardUsers[0] ? wizardUsers[0].username : '';
  }
  select.value = selectedWizardModuleUsername;
}

function handleWizardModuleUserSelect(username) {
  selectedWizardModuleUsername = username;
  renderWizardModuleCheckboxes();
}

function renderWizardModuleCheckboxes() {
  const container = document.getElementById('wizardModuleCheckboxGrid');
  if (!container) return;

  const assigned = wizardUserModules[selectedWizardModuleUsername] || [];
  container.innerHTML = '';

  allSystemModules.forEach(mod => {
    const isChecked = assigned.includes(mod.slug);
    const card = document.createElement('label');
    card.className = `module-check-card ${isChecked ? 'checked' : ''}`;
    card.innerHTML = `
      <input type="checkbox" value="${mod.slug}" ${isChecked ? 'checked' : ''} onchange="handleModuleCheckboxToggle('${mod.slug}', this.checked)">
      <span style="font-weight: 600; font-size: 13px;">${mod.name}</span>
    `;
    container.appendChild(card);
  });

  const selectAll = document.getElementById('wizSelectAllModules');
  if (selectAll) {
    selectAll.checked = allSystemModules.length > 0 && assigned.length === allSystemModules.length;
  }
}

function handleModuleCheckboxToggle(slug, isChecked) {
  let list = wizardUserModules[selectedWizardModuleUsername] || [];
  if (isChecked) {
    if (!list.includes(slug)) list.push(slug);
  } else {
    list = list.filter(s => s !== slug);
  }
  wizardUserModules[selectedWizardModuleUsername] = list;
  renderWizardModuleCheckboxes();
}

function toggleSelectAllModules(checked) {
  if (checked) {
    wizardUserModules[selectedWizardModuleUsername] = allSystemModules.map(m => m.slug);
  } else {
    wizardUserModules[selectedWizardModuleUsername] = [];
  }
  renderWizardModuleCheckboxes();
}

// STEP 4: REVIEW & CONFIRMATION
function renderWizardReviewSummary() {
  const container = document.getElementById('wizardReviewCardsContainer');
  if (!container) return;
  container.innerHTML = '';

  wizardUsers.forEach(u => {
    const assigned = wizardUserModules[u.username] || [];
    let tagsHtml = '';
    assigned.forEach(slug => {
      const mod = allSystemModules.find(m => m.slug === slug);
      tagsHtml += `<span class="module-tag">${mod ? mod.name : slug}</span>`;
    });

    const card = document.createElement('div');
    card.className = 'review-card';
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span class="account-role-badge ${u.role_slug}">${(u.role_slug || 'Role').toUpperCase()}</span>
        <span style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Status: <strong>${u.status}</strong></span>
      </div>
      <div style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">${u.full_name}</div>
      <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 10px;">Username: <code>${u.username}</code></div>
      <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Assigned Modules (${assigned.length}):</div>
      <div class="tags-container">${tagsHtml || '<span style="color: var(--text-muted); font-size: 11px;">None assigned</span>'}</div>
    `;
    container.appendChild(card);
  });
}

// STEP 5: SUBMIT & COMPLETE INSTALLATION
async function handleFinishInstallationSubmit() {
  const btn = document.getElementById('btnCompleteInstall');
  btn.disabled = true;
  btn.textContent = 'Configuring System...';

  try {
    const payload = wizardUsers.map(u => ({
      full_name: u.full_name,
      name: u.full_name,
      username: u.username,
      password: u.password,
      role_slug: u.role_slug,
      status: u.status || 'active',
      modules: wizardUserModules[u.username] || []
    }));

    await window.api.completeInstallation({ users: payload });
    goToWizardStep(5);
  } catch (error) {
    console.error('Installation setup error:', error);
    alert('Installation setup error: ' + error.message);
    btn.disabled = false;
    btn.textContent = 'Finish & Complete Installation \u2192';
  }
}

function finishInstallationAndGoToLogin() {
  const wizardOverlay = document.getElementById('installationWizardOverlay');
  if (wizardOverlay) wizardOverlay.style.display = 'none';
  showLoginScreen(true);
}

// ==========================================
// AUTHENTICATION FLOW
// ==========================================

function showLoginScreen(show) {
  const loginOverlay = document.getElementById('loginScreen');
  const appContainer = document.getElementById('appContainer');
  const wizardOverlay = document.getElementById('installationWizardOverlay');
  if (wizardOverlay) wizardOverlay.style.display = 'none';

  if (show) {
    loginOverlay.style.display = 'flex';
    appContainer.style.display = 'none';
  } else {
    loginOverlay.style.display = 'none';
    appContainer.style.display = 'flex';
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const userInp = document.getElementById('loginUsername').value.trim();
  const passInp = document.getElementById('loginPassword').value;
  const loginError = document.getElementById('loginErrorMsg');

  try {
    const user = await window.api.login(userInp, passInp);
    if (user) {
      currentUser = user;
      loginError.style.display = 'none';
      showLoginScreen(false);
      
      // Update UI with actual Full Name
      document.getElementById('loggedInUserName').textContent = user.name;
      document.getElementById('loggedInUserRoles').textContent = (user.role || 'Staff').toUpperCase();
      
      // Dynamic header greeting with account's actual name
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good Morning' : (hour < 17 ? 'Good Afternoon' : 'Good Evening');
      const roleLabel = user.role ? (user.role.charAt(0).toUpperCase() + user.role.slice(1)) : 'Staff';
      document.getElementById('headerGreetingText').textContent = `${greeting}, ${user.name} • ${roleLabel}`;

      document.getElementById('loginUsername').value = '';
      document.getElementById('loginPassword').value = '';

      applyRoleAccessPermissions();

      // Switch to first authorized screen
      const preferred = ['dashboard', 'appointments', 'consultations', 'patients', 'inventory', 'reports'];
      const screenToOpen = preferred.find(s => isScreenAuthorized(s)) || 'dashboard';
      switchScreen(screenToOpen);
    } else {
      loginError.textContent = 'Invalid username or password.';
      loginError.style.display = 'block';
    }
  } catch (error) {
    console.error('Login error:', error);
    loginError.textContent = 'System Error connecting to local database.';
    loginError.style.display = 'block';
  }
}

async function handleLogout() {
  try {
    if (window.api && window.api.logout) {
      await window.api.logout();
    }
  } catch (e) {
    console.warn('Logout notice:', e);
  }
  currentUser = null;
  selectedPatientId = null;
  currentPrescriptionItems = [];
  showLoginScreen(true);
}

function openForgotPasswordModal(event) {
  if (event) event.preventDefault();
  document.getElementById('forgotPasswordModal').classList.add('active');
}

// ROLE ACCESS PERMISSIONS
function applyRoleAccessPermissions() {
  if (!currentUser) return;
  const userModules = currentUser.modules || [];

  // Filter sidebar items according to assigned module permissions
  const navItems = document.querySelectorAll('#sidebarNavMenu .nav-item');
  navItems.forEach(item => {
    const modSlug = item.getAttribute('data-module');
    if (!modSlug || userModules.includes(modSlug)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });

  // Financial widget visibility
  const profitWidget = document.getElementById('profitWidget');
  if (profitWidget) {
    profitWidget.style.display = userModules.includes('financial_reports') ? 'block' : 'none';
  }
}

function getRequiredModuleForScreen(screenId) {
  const map = {
    'dashboard': 'dashboard',
    'appointments': 'appointments',
    'consultations': 'consultations',
    'patients': 'patient_registry',
    'patient-profile': 'patient_registry',
    'inventory': 'pharmacy',
    'reports': 'financial_reports'
  };
  return map[screenId] || null;
}

function isScreenAuthorized(screenId) {
  if (!currentUser) return false;
  const required = getRequiredModuleForScreen(screenId);
  if (!required) return true;
  return (currentUser.modules || []).includes(required);
}

// SCREEN NAVIGATION
function switchScreen(screenId) {
  const screens = document.querySelectorAll('.screen');
  screens.forEach(s => s.classList.remove('active'));

  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(n => n.classList.remove('active'));

  // Authorization Check
  if (!isScreenAuthorized(screenId)) {
    const deniedScreen = document.getElementById('screen-access-denied');
    if (deniedScreen) {
      deniedScreen.classList.add('active');
      activeScreen = 'access-denied';
      document.getElementById('screenTitle').textContent = 'Access Denied';
      const required = getRequiredModuleForScreen(screenId);
      const modObj = allSystemModules.find(m => m.slug === required);
      const modName = modObj ? modObj.name : screenId;
      document.getElementById('accessDeniedMsg').textContent = `You do not have permission to access the "${modName}" module. Please contact your system administrator to assign module permissions.`;
    }
    return;
  }

  const target = document.getElementById(`screen-${screenId}`);
  if (target) {
    target.classList.add('active');
    activeScreen = screenId;
    
    // Highlight active nav item
    navItems.forEach(n => {
      const onclickAttr = n.getAttribute('onclick') || '';
      if (onclickAttr.includes(`'${screenId}'`)) {
        n.classList.add('active');
      }
    });

    const titles = {
      'dashboard': 'Dashboard',
      'appointments': 'Appointments Schedule',
      'consultations': 'Consultations Room',
      'patients': 'Patients Registry',
      'patient-profile': 'Patient Profile Record',
      'inventory': 'Pharmacy & Stock Inventory',
      'reports': 'Financial Reports'
    };
    document.getElementById('screenTitle').textContent = titles[screenId] || 'NovoPractise';

    loadScreenData(screenId);
  }
}

function loadScreenData(screenId) {
  switch (screenId) {
    case 'dashboard':
      if (currentUser && currentUser.modules && currentUser.modules.includes('financial_reports')) {
        loadDashboardAnalytics();
      }
      refreshQueueUI();
      if (currentUser && currentUser.modules && currentUser.modules.includes('patient_registry')) {
        loadPatientsDropdown();
      }
      break;
    case 'appointments':
      loadAppointmentsList();
      break;
    case 'consultations':
      refreshConsultationsQueue();
      loadConsultationsLog();
      break;
    case 'patients':
      loadPatientsList();
      break;
    case 'patient-profile':
      if (selectedPatientId) {
        loadPatientProfile(selectedPatientId);
      } else {
        switchScreen('patients');
      }
      break;
    case 'inventory':
      loadInventoryList();
      loadPendingRxDispenseDropdown();
      break;
    case 'reports':
      loadFinancialReports();
      break;
  }
}

// DASHBOARD ANALYTICS LOADER
async function loadDashboardAnalytics() {
  if (!currentUser) return;
  if (!currentUser.modules || !currentUser.modules.includes('financial_reports')) return;
  
  const startEl = document.getElementById('dashStartDate');
  const endEl = document.getElementById('dashEndDate');
  if (!startEl || !endEl) return;
  
  const startDate = startEl.value;
  const endDate = endEl.value;

  try {
    const summary = await window.api.getProfitSummary(startDate, endDate);
    
    const seenEl = document.getElementById('dashPatientsSeen');
    const queueEl = document.getElementById('dashRemainingQueue');
    if (seenEl) seenEl.textContent = summary.patients_seen;
    if (queueEl) queueEl.textContent = summary.remaining_appointments;

    if (currentUser.permissions && currentUser.permissions.includes('view_profits')) {
      const revEl = document.getElementById('dashTotalRevenue');
      const profEl = document.getElementById('dashTotalProfit');
      const medEl = document.getElementById('dashMedProfit');
      const feeEl = document.getElementById('dashFeeProfit');
      if (revEl) revEl.textContent = `Rs. ${summary.total_revenue.toFixed(2)}`;
      if (profEl) profEl.textContent = `Rs. ${summary.total_profit.toFixed(2)}`;
      if (medEl) medEl.textContent = `Rs. ${summary.medicine_profit.toFixed(2)}`;
      if (feeEl) feeEl.textContent = `Rs. ${summary.doctor_fee_profit.toFixed(2)}`;
    }
  } catch (error) {
    console.error('Failed to load dashboard analytics:', error);
  }
}

// ==========================================
// V1 CLOUD SYNC & SETTINGS CONTROLS
// ==========================================

function updateSyncStatusUI(syncData) {
  if (!syncData) return;
  const dot = document.getElementById('syncStatusDot');
  const text = document.getElementById('syncStatusText');
  const lastSynced = document.getElementById('lastSyncedTime');
  const toggle = document.getElementById('syncSimToggle');
  const dashClinicText = document.getElementById('dashClinicSubdomainText');

  if (toggle) toggle.checked = Boolean(syncData.simulationOnline);

  const status = (syncData.status || 'idle').toLowerCase();
  
  // Status visual states
  if (text) {
    const statusMap = {
      'idle': 'ONLINE',
      'syncing': 'SYNCING',
      'offline': 'OFFLINE',
      'auth_error': 'AUTH ERROR',
      'forbidden': 'DEACTIVATED',
      'error': 'SYNC ERROR'
    };
    text.textContent = statusMap[status] || status.toUpperCase();
  }

  if (dot) {
    dot.className = `status-dot ${status}`;
  }

  if (lastSynced) {
    if (syncData.lastSynced && syncData.lastSynced !== '1970-01-01T00:00:00.000Z' && syncData.lastSynced !== '0') {
      const dateObj = new Date(syncData.lastSynced);
      lastSynced.textContent = `Synced: ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    } else {
      lastSynced.textContent = 'Never Synced';
    }
  }

  if (dashClinicText && syncData.clinic && syncData.clinic.subdomain) {
    dashClinicText.textContent = `Connected to ${syncData.clinic.name || syncData.clinic.subdomain} (${syncData.clinic.subdomain}.novopractise.com) via Cloudflare Workers Sync API v1.`;
  }

  // Trigger metrics update if a background sync cycle finished
  if (status === 'idle') {
    if (activeScreen === 'dashboard') {
      loadDashboardAnalytics();
      refreshQueueUI();
    } else if (activeScreen === 'appointments') {
      loadAppointmentsList();
    }
  }
}

async function openSyncSettingsModal() {
  try {
    const settings = await window.api.getSyncSettings();
    const status = await window.api.getSyncStatus();

    document.getElementById('syncBaseUrl').value = settings.sync_base_url || 'https://minimtech.novopractise.com';
    document.getElementById('syncApiKey').value = settings.sync_api_key || '';

    const card = document.getElementById('handshakeResultCard');
    const errEl = document.getElementById('handshakeErrorMsg');

    if (settings.clinic_name || status.clinic.name) {
      document.getElementById('cardClinicName').textContent = settings.clinic_name || status.clinic.name;
      document.getElementById('cardSubdomain').textContent = settings.clinic_subdomain || status.clinic.subdomain || '-';
      document.getElementById('cardTimezone').textContent = settings.clinic_timezone || status.clinic.timezone || 'Asia/Colombo';
      document.getElementById('cardProtocolVer').textContent = settings.protocol_version || '1';
      document.getElementById('cardLastVerified').textContent = settings.last_connected_at ? new Date(settings.last_connected_at).toLocaleString() : 'Just now';
      
      const badge = document.getElementById('cardSyncStatusBadge');
      if (status.status === 'auth_error') {
        badge.className = 'sync-badge-error';
        badge.textContent = 'Auth Error (401)';
      } else if (status.status === 'offline') {
        badge.className = 'sync-badge-disconnected';
        badge.textContent = 'Offline';
      } else {
        badge.className = 'sync-badge-connected';
        badge.textContent = 'Connected';
      }

      errEl.style.display = status.error ? 'block' : 'none';
      if (status.error) errEl.textContent = status.error;
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
    }

    document.getElementById('syncSettingsModal').classList.add('active');
  } catch (error) {
    console.error('Failed to open sync settings:', error);
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('syncApiKey');
  apiKeyVisible = !apiKeyVisible;
  input.type = apiKeyVisible ? 'text' : 'password';
}

async function testSyncConnection() {
  const baseUrl = document.getElementById('syncBaseUrl').value.trim();
  const apiKey = document.getElementById('syncApiKey').value.trim();
  const btn = document.getElementById('btnTestHandshake');
  const card = document.getElementById('handshakeResultCard');
  const errEl = document.getElementById('handshakeErrorMsg');
  const badge = document.getElementById('cardSyncStatusBadge');

  if (!baseUrl || !apiKey) {
    alert('Please enter both the Clinic Domain and Sync API Key.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Testing...';
  errEl.style.display = 'none';

  try {
    const handshakeData = await window.api.syncHandshake(baseUrl, apiKey);
    
    if (handshakeData && handshakeData.clinic) {
      document.getElementById('cardClinicName').textContent = handshakeData.clinic.name;
      document.getElementById('cardSubdomain').textContent = handshakeData.clinic.subdomain;
      document.getElementById('cardTimezone').textContent = handshakeData.clinic.timezone || 'Asia/Colombo';
      document.getElementById('cardProtocolVer').textContent = handshakeData.protocol_version || '1';
      document.getElementById('cardLastVerified').textContent = new Date().toLocaleTimeString();

      badge.className = 'sync-badge-connected';
      badge.textContent = 'Verified (200 OK)';
      card.style.display = 'flex';

      const status = await window.api.getSyncStatus();
      updateSyncStatusUI(status);
    } else {
      throw new Error('Invalid handshake response received');
    }
  } catch (error) {
    console.error('Handshake error:', error);
    card.style.display = 'flex';
    badge.className = 'sync-badge-error';
    badge.textContent = 'Connection Failed';
    errEl.textContent = `Error: ${error.message}`;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg style="width:14px;height:14px;stroke:currentColor;fill:none;" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      Test & Connect
    `;
  }
}

async function handleSaveSyncSettings(event) {
  event.preventDefault();
  const baseUrl = document.getElementById('syncBaseUrl').value.trim();
  const apiKey = document.getElementById('syncApiKey').value.trim();

  try {
    await window.api.saveSyncSettings({
      sync_base_url: baseUrl,
      sync_api_key: apiKey
    });

    // Test handshake and trigger sync
    try {
      await window.api.syncHandshake(baseUrl, apiKey);
      await window.api.forceSync();
    } catch (e) {
      console.warn('Initial sync test warning:', e.message);
    }

    closeModal('syncSettingsModal');
    const status = await window.api.getSyncStatus();
    updateSyncStatusUI(status);
  } catch (error) {
    console.error('Failed to save sync settings:', error);
    alert('Failed to save sync settings.');
  }
}

async function handleSyncSimToggle(checkbox) {
  try {
    await window.api.toggleSyncSimulation(checkbox.checked);
    const status = await window.api.getSyncStatus();
    updateSyncStatusUI(status);
  } catch (error) {
    console.error('Error toggling sync simulation:', error);
  }
}

async function triggerManualSync() {
  try {
    await window.api.forceSync();
    const status = await window.api.getSyncStatus();
    updateSyncStatusUI(status);
  } catch (error) {
    console.error('Manual sync execution failed:', error);
  }
}

// ==========================================
// APPOINTMENTS SCHEDULE (v1 Resource)
// ==========================================

async function loadAppointmentsList() {
  const filterDate = document.getElementById('apptDateFilter').value;
  try {
    allAppointments = await window.api.getAppointments(filterDate || null);
    renderAppointmentsTable(allAppointments);
  } catch (error) {
    console.error('Failed to load appointments:', error);
  }
}

function renderAppointmentsTable(list) {
  const tbody = document.getElementById('appointmentsTableBody');
  tbody.innerHTML = '';

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">No appointments found for this date.</td></tr>';
    return;
  }

  list.forEach(a => {
    const sourceBadge = a.source === 'online' 
      ? '<span class="badge-source online">🌐 Online</span>' 
      : '<span class="badge-source desk">🏢 Desk</span>';

    const statusBadge = `<span class="badge-status ${a.status}">${a.status.toUpperCase()}</span>`;

    const contactDetails = [];
    if (a.patient_phone) contactDetails.push(`<span>📞 ${a.patient_phone}</span>`);
    if (a.patient_nic) contactDetails.push(`<span style="font-size:11px; color:var(--text-secondary);">🪪 ${a.patient_nic}</span>`);
    const contactHtml = contactDetails.length > 0 ? contactDetails.join('<br>') : '<span style="color:var(--text-muted);">-</span>';

    const displayName = a.patient_name || `Patient (${a.patient_uid.substring(0, 8)})`;

    let actionButtons = '';
    if (a.status === 'booked') {
      actionButtons = `
        <button class="btn btn-success btn-xs" onclick="updateApptStatus('${a.uid}', 'seen')" title="Mark Patient as Seen">Seen</button>
        <button class="btn btn-secondary btn-xs" onclick="checkInApptToQueue('${a.patient_uid}')" title="Send Patient to Live Waiting Room">To Queue</button>
        <button class="btn btn-warning btn-xs" onclick="updateApptStatus('${a.uid}', 'cancelled')" title="Cancel Appointment">Cancel</button>
        <button class="btn btn-danger btn-xs" onclick="deleteAppt('${a.uid}')" title="Delete Appointment">Delete</button>
      `;
    } else if (a.status === 'seen') {
      actionButtons = `
        <button class="btn btn-secondary btn-xs" onclick="updateApptStatus('${a.uid}', 'booked')">Re-open</button>
        <button class="btn btn-danger btn-xs" onclick="deleteAppt('${a.uid}')" title="Delete Appointment">Delete</button>
      `;
    } else if (a.status === 'cancelled') {
      actionButtons = `
        <button class="btn btn-secondary btn-xs" onclick="updateApptStatus('${a.uid}', 'booked')">Restore</button>
        <button class="btn btn-danger btn-xs" onclick="deleteAppt('${a.uid}')" title="Permanently Remove">Delete</button>
      `;
    }

    tbody.innerHTML += `
      <tr>
        <td style="font-weight: 800; font-size: 15px; color: var(--primary); text-align: center;">${a.queue_number}</td>
        <td style="font-family: monospace; font-weight: 700; color: var(--text-secondary);">${a.reference || '-'}</td>
        <td style="font-weight: 600; cursor: pointer; color: var(--text-primary);" onclick="selectPatient('${a.patient_uid}')">${displayName}</td>
        <td>${contactHtml}</td>
        <td>${sourceBadge}</td>
        <td>${statusBadge}</td>
        <td style="font-size: 12px; color: var(--text-muted); max-width: 180px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${a.notes || '-'}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            ${actionButtons}
          </div>
        </td>
      </tr>
    `;
  });
}

function filterAppointmentsTable() {
  const query = document.getElementById('apptSearchInput').value.toLowerCase().trim();
  if (!query) {
    renderAppointmentsTable(allAppointments);
    return;
  }

  const filtered = allAppointments.filter(a => 
    (a.patient_name && a.patient_name.toLowerCase().includes(query)) ||
    (a.reference && a.reference.toLowerCase().includes(query)) ||
    (a.patient_phone && a.patient_phone.includes(query)) ||
    (a.patient_nic && a.patient_nic.toLowerCase().includes(query))
  );

  renderAppointmentsTable(filtered);
}

async function updateApptStatus(uid, status) {
  try {
    await window.api.updateAppointmentStatus(uid, status);
    loadAppointmentsList();
    loadDashboardAnalytics();
  } catch (error) {
    console.error('Failed to update appointment status:', error);
  }
}

async function deleteAppt(uid) {
  if (!confirm('Are you sure you want to delete this appointment?')) return;
  try {
    await window.api.deleteAppointment(uid);
    loadAppointmentsList();
    loadDashboardAnalytics();
  } catch (error) {
    console.error('Failed to delete appointment:', error);
    alert('Failed to delete appointment: ' + error.message);
  }
}

async function deletePatientProfile(idOrUid) {
  if (!confirm('Are you sure you want to delete this patient profile?')) return;
  try {
    await window.api.deletePatient(idOrUid);
    selectedPatientId = null;
    loadPatientsList();
    switchScreen('patients');
  } catch (error) {
    console.error('Failed to delete patient:', error);
    alert('Failed to delete patient: ' + error.message);
  }
}

async function checkInApptToQueue(patientUid) {
  try {
    await window.api.addToQueue(patientUid);
    alert('Patient added to the live waiting room queue!');
    refreshQueueUI();
  } catch (error) {
    console.error('Failed to check in appointment to queue:', error);
  }
}

function switchApptPatientMode(mode) {
  const existingGroup = document.getElementById('deskApptExistingGroup');
  const newGroup = document.getElementById('deskApptNewGroup');
  const modeInput = document.getElementById('deskApptPatientMode');
  const existingBtn = document.getElementById('tabExistingPatientBtn');
  const newBtn = document.getElementById('tabNewPatientBtn');
  const nameInput = document.getElementById('deskNewPatName');

  modeInput.value = mode;
  if (mode === 'new') {
    existingGroup.style.display = 'none';
    newGroup.style.display = 'block';
    existingBtn.style.background = 'transparent';
    existingBtn.className = 'btn btn-xs btn-secondary';
    newBtn.style.background = 'var(--primary)';
    newBtn.className = 'btn btn-xs';
    nameInput.required = true;
    setTimeout(() => nameInput.focus(), 100);
  } else {
    existingGroup.style.display = 'block';
    newGroup.style.display = 'none';
    existingBtn.style.background = 'var(--primary)';
    existingBtn.className = 'btn btn-xs';
    newBtn.style.background = 'transparent';
    newBtn.className = 'btn btn-xs btn-secondary';
    nameInput.required = false;
  }
}

function handleApptPatientSelectChange(select) {
  if (select.value === '__NEW__') {
    switchApptPatientMode('new');
  }
}

async function openDeskAppointmentModal() {
  try {
    const patients = await window.api.getPatients();
    const select = document.getElementById('deskApptPatientSelect');
    select.innerHTML = '<option value="">-- Choose Patient --</option>';
    select.innerHTML += '<option value="__NEW__" style="font-weight: 700; color: var(--primary);">➕ Register New Patient...</option>';
    patients.forEach(p => {
      select.innerHTML += `<option value="${p.uid || p.id}">${p.full_name || p.name} (${p.phone || p.id})</option>`;
    });

    switchApptPatientMode('existing');
    document.getElementById('deskNewPatName').value = '';
    document.getElementById('deskNewPatPhone').value = '';
    document.getElementById('deskNewPatNic').value = '';
    document.getElementById('deskNewPatAge').value = '';
    document.getElementById('deskNewPatGender').value = 'Male';
    document.getElementById('deskApptDate').value = document.getElementById('apptDateFilter').value || new Date().toISOString().split('T')[0];
    document.getElementById('deskApptNotes').value = '';
    document.getElementById('deskAppointmentModal').classList.add('active');
  } catch (error) {
    console.error('Failed to open desk appointment modal:', error);
  }
}

function openDeskAppointmentModalForCurrent() {
  if (!selectedPatientId) return;
  openDeskAppointmentModal().then(() => {
    switchApptPatientMode('existing');
    document.getElementById('deskApptPatientSelect').value = selectedPatientId;
  });
}

async function handleCreateDeskAppointment(event) {
  event.preventDefault();
  const mode = document.getElementById('deskApptPatientMode').value;
  const apptDate = document.getElementById('deskApptDate').value;
  const status = document.getElementById('deskApptStatus').value;
  const notes = document.getElementById('deskApptNotes').value.trim();

  let patientUid = null;

  if (mode === 'new') {
    const fullName = document.getElementById('deskNewPatName').value.trim();
    const phone = document.getElementById('deskNewPatPhone').value.trim();
    const nic = document.getElementById('deskNewPatNic').value.trim();
    const age = document.getElementById('deskNewPatAge').value;
    const gender = document.getElementById('deskNewPatGender').value;

    if (!fullName) {
      alert('Please enter the patient full name.');
      return;
    }

    try {
      const newPatientId = await window.api.createPatient({
        name: fullName,
        full_name: fullName,
        phone: phone || null,
        nic: nic || null,
        age: age ? parseInt(age, 10) : null,
        gender: gender,
        notes: notes || null
      });

      const patientRecord = await window.api.getPatient(newPatientId);
      patientUid = patientRecord ? (patientRecord.uid || patientRecord.id) : newPatientId;
    } catch (err) {
      console.error('Failed to auto-register patient:', err);
      alert('Error registering patient: ' + err.message);
      return;
    }
  } else {
    patientUid = document.getElementById('deskApptPatientSelect').value;
    if (!patientUid || patientUid === '__NEW__') {
      alert('Please select an existing patient or switch to "Register New Patient".');
      return;
    }
  }

  try {
    await window.api.createAppointment({
      patient_uid: patientUid,
      appt_date: apptDate,
      status: status,
      source: 'desk',
      notes: notes || null
    });

    closeModal('deskAppointmentModal');
    loadAppointmentsList();
    loadPatientsList();
    loadDashboardAnalytics();
  } catch (error) {
    console.error('Failed to create desk appointment:', error);
    alert('Error booking desk appointment: ' + error.message);
  }
}

// ==========================================
// QUEUE WAITING ROOM OPERATIONS
// ==========================================

async function refreshQueueUI() {
  try {
    const queue = await window.api.getQueue();
    const liveQueue = document.getElementById('liveQueueComponent');
    
    if (queue.length === 0) {
      liveQueue.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 24px;">No patients waiting in queue.</div>';
      return;
    }

    liveQueue.innerHTML = '';
    queue.sort((a, b) => a.queue_number - b.queue_number);

    const activeWaiting = queue.filter(q => q.status === 'waiting' || q.status === 'called' || q.status === 'no_show');
    const nextUpPatientId = activeWaiting.length > 0 ? activeWaiting[0].patient_id : null;

    queue.forEach((q) => {
      const isNextUp = q.patient_id === nextUpPatientId;
      const itemDiv = document.createElement('div');
      itemDiv.className = `queue-item ${isNextUp ? 'next-up' : ''} ${q.status}`;
      
      let statusLabel = q.status;
      if (isNextUp && q.status === 'waiting') {
        statusLabel = 'Next Call';
      }

      let actionButtons = '';
      if (currentUser && currentUser.permissions && currentUser.permissions.includes('manage_queue')) {
        actionButtons = `
          <div class="queue-actions">
            ${(q.status === 'waiting' || q.status === 'no_show') ? `
              <button class="btn btn-success btn-xs" onclick="callPatientSpeech('${q.patient_id}', ${q.queue_number}, '${q.patient_name.replace(/'/g, "\\'")}')">
                Call
              </button>
              <button class="btn btn-warning btn-xs" onclick="skipPatientNoShow('${q.patient_id}')">Skip</button>
            ` : ''}
            ${q.status === 'called' ? `
              <button class="btn btn-xs" onclick="updateQueueStatus('${q.patient_id}', 'in_consultation')">Consulting</button>
              <button class="btn btn-warning btn-xs" onclick="skipPatientNoShow('${q.patient_id}')">Skip</button>
            ` : ''}
            ${q.status === 'in_consultation' ? `
              <button class="btn btn-secondary btn-xs" onclick="updateQueueStatus('${q.patient_id}', 'waiting')">Back</button>
              <button class="btn btn-success btn-xs" onclick="updateQueueStatus('${q.patient_id}', 'done')">Done</button>
            ` : ''}
          </div>
        `;
      }

      itemDiv.innerHTML = `
        <div style="display: flex; align-items: center;">
          <div class="queue-num-badge">${q.queue_number}</div>
          <div class="queue-info">
            <div class="queue-patient-name" onclick="selectPatient('${q.patient_id}')" style="cursor: pointer; color: var(--primary);">
              ${q.patient_name}
            </div>
            <div class="queue-patient-meta">
              ${q.patient_gender || 'Patient'} • ${q.patient_age ? q.patient_age + ' yrs • ' : ''}${q.patient_phone || 'No phone'}
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="badge-status ${q.status}">${statusLabel.toUpperCase()}</span>
          ${actionButtons}
        </div>
      `;

      liveQueue.appendChild(itemDiv);
    });
  } catch (error) {
    console.error('Error refreshing queue UI:', error);
  }
}

async function updateQueueStatus(patientId, status) {
  try {
    await window.api.updateQueueStatus(patientId, status);
    refreshQueueUI();
    loadDashboardAnalytics();
  } catch (error) {
    console.error('Failed to update queue status:', error);
  }
}

function callPatientSpeech(patientId, queueNum, name) {
  updateQueueStatus(patientId, 'called').then(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const announcement = `Patient number ${queueNum}, ${name}. Please proceed to the doctor's consulting room.`;
      const utterance = new SpeechSynthesisUtterance(announcement);
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    }
  });
}

function skipPatientNoShow(patientId) {
  updateQueueStatus(patientId, 'no_show');
}

async function loadPatientsDropdown() {
  try {
    const dropdown = document.getElementById('queueSearchSelect');
    const patients = await window.api.getPatients();
    
    dropdown.innerHTML = '<option value="">-- Choose Patient --</option>';
    patients.forEach(p => {
      dropdown.innerHTML += `<option value="${p.id || p.uid}">${p.full_name || p.name} (${p.id || p.uid})</option>`;
    });
  } catch (error) {
    console.error('Failed to load patient dropdown:', error);
  }
}

async function addSelectedToQueue() {
  const patientSelect = document.getElementById('queueSearchSelect');
  const patientId = patientSelect.value;
  if (!patientId) return;

  try {
    await window.api.addToQueue(patientId);
    patientSelect.value = '';
    refreshQueueUI();
    loadDashboardAnalytics();
  } catch (error) {
    console.error('Failed to add to queue:', error);
  }
}

// ==========================================
// PATIENT REGISTRY & PROFILES
// ==========================================

async function loadPatientsList() {
  try {
    allPatients = await window.api.getPatients();
    renderPatientsTable(allPatients);
  } catch (error) {
    console.error('Failed to load patients list:', error);
  }
}

function renderPatientsTable(list) {
  const tbody = document.getElementById('patientsTableBody');
  tbody.innerHTML = '';
  
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No patients registered.</td></tr>';
    return;
  }

  list.forEach(p => {
    tbody.innerHTML += `
      <tr>
        <td style="font-weight: 700; color: var(--primary); cursor: pointer;" onclick="selectPatient('${p.id || p.uid}')">${p.id || p.uid.substring(0, 8)}</td>
        <td style="font-weight: 600;">${p.full_name || p.name}</td>
        <td>${p.age ? p.age + ' yrs' : '-'} / ${p.gender || '-'}</td>
        <td>${p.phone || '-'}</td>
        <td>${p.nic || p.dob || '-'}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary btn-xs" onclick="selectPatient('${p.id || p.uid}')">View Profile</button>
            <button class="btn btn-danger btn-xs" onclick="deletePatientProfile('${p.id || p.uid}')" title="Delete Patient">Delete</button>
          </div>
        </td>
      </tr>
    `;
  });
}

function filterPatientsList() {
  const query = document.getElementById('patientSearchInput').value.toLowerCase().trim();
  if (!query) {
    renderPatientsTable(allPatients);
    return;
  }

  const filtered = allPatients.filter(p => 
    (p.id && p.id.toLowerCase().includes(query)) || 
    (p.uid && p.uid.toLowerCase().includes(query)) ||
    (p.full_name && p.full_name.toLowerCase().includes(query)) ||
    (p.name && p.name.toLowerCase().includes(query)) ||
    (p.phone && p.phone.includes(query)) ||
    (p.nic && p.nic.toLowerCase().includes(query))
  );

  renderPatientsTable(filtered);
}

function openNewPatientModal() {
  document.getElementById('patientForm').reset();
  document.getElementById('editPatientId').value = '';
  document.getElementById('patientModalTitle').textContent = 'Register New Patient';
  document.getElementById('patientModal').classList.add('active');
}

function openEditPatientModal() {
  window.api.getPatient(selectedPatientId).then(p => {
    if (!p) return;
    document.getElementById('editPatientId').value = p.id || p.uid;
    document.getElementById('patName').value = p.full_name || p.name;
    document.getElementById('patAge').value = p.age || '';
    document.getElementById('patGender').value = p.gender || 'Male';
    document.getElementById('patPhone').value = p.phone || '';
    document.getElementById('patNic').value = p.nic || '';
    document.getElementById('patDob').value = p.dob || '';
    document.getElementById('patAddress').value = p.address || '';
    document.getElementById('patHistory').value = p.medical_history || p.notes || '';
    document.getElementById('patientModalTitle').textContent = 'Edit Patient Profile';
    document.getElementById('patientModal').classList.add('active');
  });
}

async function savePatient(event) {
  event.preventDefault();
  const editId = document.getElementById('editPatientId').value;
  const name = document.getElementById('patName').value.trim();
  const age = parseInt(document.getElementById('patAge').value, 10) || null;
  const gender = document.getElementById('patGender').value;
  const phone = document.getElementById('patPhone').value.trim();
  const nic = document.getElementById('patNic').value.trim();
  const dob = document.getElementById('patDob').value;
  const address = document.getElementById('patAddress').value.trim();
  const history = document.getElementById('patHistory').value.trim();

  const patientData = { 
    name, 
    full_name: name,
    age, 
    gender, 
    phone: phone || null, 
    nic: nic || null,
    dob: dob || null,
    address: address || null, 
    medical_history: history || null,
    notes: history || null
  };

  try {
    if (editId) {
      const current = await window.api.getPatient(editId);
      if (current) patientData.files = current.files;
      await window.api.updatePatient(editId, patientData);
    } else {
      await window.api.createPatient(patientData);
    }
    
    closeModal('patientModal');
    loadPatientsList();
    if (activeScreen === 'patient-profile' && editId) {
      loadPatientProfile(editId);
    }
  } catch (error) {
    console.error('Failed to save patient:', error);
    alert('Failed to save patient record: ' + error.message);
  }
}

function selectPatient(id) {
  selectedPatientId = id;
  switchScreen('patient-profile');
  switchPatientTab('details');
}

function switchPatientTab(tabName) {
  const tabs = ['details', 'history', 'prescription'];
  tabs.forEach(t => {
    const pane = document.getElementById(`patientPane${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const btn = document.getElementById(`tabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (pane) {
      if (t === tabName) {
        pane.style.display = 'block';
        pane.classList.add('active');
      } else {
        pane.style.display = 'none';
        pane.classList.remove('active');
      }
    }
    if (btn) {
      if (t === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });

  if (selectedPatientId) {
    if (tabName === 'history') {
      loadPatientConsultationHistory(selectedPatientId);
    } else if (tabName === 'prescription') {
      loadPatientPrescriptionsTimeline(selectedPatientId);
    }
  }
}

async function loadPatientProfile(id) {
  try {
    const patient = await window.api.getPatient(id);
    if (!patient) return;

    const ptId = patient.id || patient.uid;
    const ptName = patient.full_name || patient.name;
    const ptAgeGender = `${patient.age ? patient.age + ' yrs' : '-'} / ${patient.gender || '-'}`;

    document.getElementById('profId').textContent = ptId;
    document.getElementById('profName').textContent = ptName;

    const profDetailsId = document.getElementById('profDetailsId');
    if (profDetailsId) profDetailsId.textContent = ptId;
    const profDetailsName = document.getElementById('profDetailsName');
    if (profDetailsName) profDetailsName.textContent = ptName;

    document.getElementById('profAgeGender').textContent = ptAgeGender;
    document.getElementById('profPhone').textContent = patient.phone || 'No phone registered';
    document.getElementById('profNic').textContent = patient.nic || '-';
    document.getElementById('profDob').textContent = patient.dob || '-';
    document.getElementById('profAddress').textContent = patient.address || 'No address registered';
    document.getElementById('profHistory').textContent = patient.medical_history || patient.notes || 'No allergies or conditions recorded.';

    const files = JSON.parse(patient.files || '[]');
    const gallery = document.getElementById('profFilesGrid');
    if (gallery) {
      gallery.innerHTML = '';
      if (files.length === 0) {
        gallery.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 12px; font-size: 13px;">No medical images or documents attached.</div>';
      } else {
        for (const file of files) {
          const fileUrl = await window.api.getPatientFileUrl(patient.id || patient.uid, file.path.split('/')[1]);
          const isImg = /\.(jpg|jpeg|png|gif)$/i.test(file.name);

          const thumb = document.createElement('div');
          thumb.className = 'file-thumb-card';
          thumb.onclick = () => viewAttachmentModal(file.name, fileUrl);

          if (isImg) {
            thumb.innerHTML = `
              <img class="file-thumb-img" src="${fileUrl}" alt="${file.name}">
              <div class="file-thumb-name">${file.name}</div>
            `;
          } else {
            thumb.innerHTML = `
              <div class="file-thumb-pdf-icon">📄</div>
              <div class="file-thumb-name">${file.name}</div>
            `;
          }
          gallery.appendChild(thumb);
        }
      }
    }

    await loadPatientConsultationHistory(id);
    await loadPatientPrescriptionsTimeline(id);
  } catch (error) {
    console.error('Failed to load patient profile:', error);
  }
}

async function loadPatientConsultationHistory(patientId) {
  const tbody = document.getElementById('patientHistoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">Loading clinical history...</td></tr>';

  try {
    const consultations = await window.api.getConsultations(patientId);
    tbody.innerHTML = '';

    if (!consultations || consultations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No previous consultations or clinical records found for this patient.</td></tr>';
      return;
    }

    consultations.forEach(c => {
      const dt = new Date(c.created_at);
      const dateStr = dt.toLocaleDateString();
      const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      let medSummary = '-';
      if (c.prescription_items) {
        try {
          const items = JSON.parse(c.prescription_items);
          if (items.length > 0) {
            medSummary = items.map(it => `${it.name} (${it.quantity || it.prescribed_qty || 1}${it.is_custom ? ' • Custom' : ''})`).join(', ');
          }
        } catch (e) {}
      }

      const row = document.createElement('tr');
      row.innerHTML = `
        <td style="font-size: 12px;"><strong>${dateStr}</strong><br><span style="color: var(--text-muted);">${timeStr}</span></td>
        <td style="max-width: 180px; font-size: 13px;">${c.symptoms || '-'}</td>
        <td style="max-width: 180px; font-size: 13px; font-weight: 600; color: var(--primary);">${c.diagnosis || '-'}</td>
        <td style="max-width: 220px; font-size: 12px; color: var(--text-secondary);">${medSummary}</td>
        <td style="font-size: 12px;">${c.doctor_name || 'Doctor'}</td>
        <td style="font-weight: 600; font-size: 13px;">Rs. ${(c.doctor_fee || 0).toFixed(2)}</td>
        <td>
          <button class="btn btn-secondary btn-xs" onclick="viewConsultationRecord(${c.id})">View</button>
        </td>
      `;
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Failed to load consultation history:', error);
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #ef4444; padding: 20px;">Error loading history.</td></tr>';
  }
}

async function loadPatientPrescriptionsTimeline(patientId) {
  const rxTimeline = document.getElementById('profPrescriptionHistory');
  if (!rxTimeline) return;
  rxTimeline.innerHTML = '';

  try {
    const prescriptions = await window.api.getPrescriptionHistory(patientId);
    if (!prescriptions || prescriptions.length === 0) {
      rxTimeline.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 24px;">No prescription records.</div>';
      return;
    }

    prescriptions.forEach(rx => {
      const date = new Date(rx.created_at).toLocaleDateString();
      const time = new Date(rx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      let items = [];
      try { items = JSON.parse(rx.items || '[]'); } catch (e) {}

      let itemsHtml = '';
      items.forEach(item => {
        const isCustom = !!item.is_custom;
        const sourceBadge = isCustom 
          ? '<span class="med-source-badge custom" style="margin-left: 6px; font-size: 10px;">Custom</span>' 
          : '<span class="med-source-badge pharmacy" style="margin-left: 6px; font-size: 10px;">Pharmacy</span>';

        const sig = [item.dosage, item.frequency, item.duration].filter(Boolean).join(' • ');

        itemsHtml += `
          <li class="prescription-item-row" style="padding: 6px 0; border-bottom: 1px dashed var(--border-color);">
            <div>
              <span class="prescription-item-name" style="font-weight: 600;">${item.name}</span>
              ${sourceBadge}
              ${sig ? `<div style="font-size: 11px; color: var(--text-muted);">${sig}</div>` : ''}
              ${item.instructions ? `<div style="font-size: 11px; color: var(--text-secondary); font-style: italic;">"${item.instructions}"</div>` : ''}
            </div>
            <div style="text-align: right;">
              <span class="prescription-item-qty" style="font-size: 12px; font-weight: 600;">
                Qty: ${item.quantity || item.prescribed_qty} ${item.dispensed_qty > 0 ? `(Disp: ${item.dispensed_qty})` : ''}
              </span>
              <div><span class="dispensed-badge ${item.status || 'prescribed'}">${item.status || 'prescribed'}</span></div>
            </div>
          </li>
        `;
      });

      rxTimeline.innerHTML += `
        <div class="prescription-card" style="margin-bottom: 12px; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-card);">
          <div class="prescription-meta" style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 8px;">
            <span>📅 ${date} <span style="color: var(--text-muted); font-size: 11px;">${time}</span></span>
            <span style="color: var(--primary); font-weight: 700;">Rx #${rx.id}</span>
          </div>
          <ul class="prescription-items-list" style="list-style: none; padding: 0; margin: 0;">
            ${itemsHtml}
          </ul>
        </div>
      `;
    });
  } catch (error) {
    console.error('Failed to load prescription timeline:', error);
  }
}

async function addCurrentPatientToQueue() {
  if (!selectedPatientId) return;
  try {
    await window.api.addToQueue(selectedPatientId);
    alert('Patient added to the waiting room queue!');
    refreshQueueUI();
  } catch (error) {
    console.error('Failed to add to queue from profile:', error);
  }
}

// Patient file attachments & webcam
let desktopWebcamStream = null;

async function openMobileCaptureModal() {
  if (!selectedPatientId) return;
  try {
    const qrInfo = await window.api.generatePatientQrLink(selectedPatientId);
    document.getElementById('mobileSyncQrImage').src = qrInfo.qrDataUrl;
    document.getElementById('mobileSyncUrlText').textContent = qrInfo.url;
    document.getElementById('mobileSyncCloudQrImage').src = qrInfo.cloudQrDataUrl || qrInfo.qrDataUrl;
    document.getElementById('mobileSyncCloudUrlText').textContent = qrInfo.cloudUrl || qrInfo.url;
    document.getElementById('mobileCaptureModal').classList.add('active');
  } catch (error) {
    console.error('Failed to generate QR link:', error);
    alert('Failed to generate mobile capture QR link.');
  }
}

function switchQrTab(tab) {
  const wifiContainer = document.getElementById('qrTabWifiContainer');
  const cloudContainer = document.getElementById('qrTabCloudContainer');
  const wifiBtn = document.getElementById('qrTabWifiBtn');
  const cloudBtn = document.getElementById('qrTabCloudBtn');

  if (tab === 'wifi') {
    wifiContainer.style.display = 'flex';
    cloudContainer.style.display = 'none';
    wifiBtn.style.background = 'var(--primary)';
    wifiBtn.style.color = 'white';
    cloudBtn.style.background = 'transparent';
    cloudBtn.style.color = 'var(--text-primary)';
  } else {
    wifiContainer.style.display = 'none';
    cloudContainer.style.display = 'flex';
    cloudBtn.style.background = 'var(--primary)';
    cloudBtn.style.color = 'white';
    wifiBtn.style.background = 'transparent';
    wifiBtn.style.color = 'var(--text-primary)';
  }
}

function closeMobileCaptureModal() {
  stopDesktopWebcam();
  closeModal('mobileCaptureModal');
}

function toggleDesktopWebcam() {
  const video = document.getElementById('desktopWebcamVideo');
  if (desktopWebcamStream) {
    stopDesktopWebcam();
  } else {
    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      .then(stream => {
        desktopWebcamStream = stream;
        video.srcObject = stream;
        video.play();
      })
      .catch(error => {
        console.error('Webcam access error:', error);
        alert('Could not access desktop webcam.');
      });
  }
}

function stopDesktopWebcam() {
  const video = document.getElementById('desktopWebcamVideo');
  if (desktopWebcamStream) {
    desktopWebcamStream.getTracks().forEach(track => track.stop());
    desktopWebcamStream = null;
  }
  if (video) video.srcObject = null;
}

async function captureDesktopWebcamPhoto() {
  if (!desktopWebcamStream) {
    alert('Please start the web camera first!');
    return;
  }

  const video = document.getElementById('desktopWebcamVideo');
  const canvas = document.getElementById('desktopWebcamCanvas');
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const base64Data = canvas.toDataURL('image/jpeg');
  const filename = `cam_${Date.now()}.jpg`;

  try {
    const uploadedFileMeta = await window.api.uploadPatientFileBase64(selectedPatientId, filename, base64Data);
    const patient = await window.api.getPatient(selectedPatientId);
    const filesList = JSON.parse(patient.files || '[]');
    filesList.push(uploadedFileMeta);

    await window.api.updatePatient(selectedPatientId, {
      ...patient,
      files: JSON.stringify(filesList)
    });

    closeMobileCaptureModal();
    loadPatientProfile(selectedPatientId);
  } catch (error) {
    console.error('Webcam capture attach failed:', error);
    alert('Failed to save photo: ' + error.message);
  }
}

async function handleAttachFile() {
  try {
    const filePaths = await window.api.openFileDialog();
    if (filePaths.length === 0) return;

    const uploadedFileMeta = await window.api.uploadPatientFile(selectedPatientId, filePaths[0]);
    const patient = await window.api.getPatient(selectedPatientId);
    const filesList = JSON.parse(patient.files || '[]');
    filesList.push(uploadedFileMeta);

    await window.api.updatePatient(selectedPatientId, {
      ...patient,
      files: JSON.stringify(filesList)
    });

    loadPatientProfile(selectedPatientId);
  } catch (error) {
    console.error('File attachment failed:', error);
  }
}

function viewAttachmentModal(name, url) {
  const viewer = document.getElementById('fileViewerBody');
  document.getElementById('fileViewerTitle').textContent = name;
  const isImg = /\.(jpg|jpeg|png|gif)$/i.test(name);
  if (isImg) {
    viewer.innerHTML = `<img src="${url}" style="max-width:100%; max-height:65vh; object-fit: contain; border-radius: 8px;">`;
  } else {
    viewer.innerHTML = `<iframe src="${url}" style="width:100%; height:65vh; border:none; border-radius: 8px;"></iframe>`;
  }
  document.getElementById('fileViewerModal').classList.add('active');
}

// ==========================================
// PRESCRIPTION COMPOSER & CLINICAL RECORDS
// ==========================================

// MEDICATION SEARCH (PHARMACY STOCK)
async function openMedicationSearchModal() {
  const searchInput = document.getElementById('pharmacyMedSearchInput');
  if (searchInput) searchInput.value = '';
  document.getElementById('selectedDrugConfigArea').style.display = 'none';
  document.getElementById('medicationSearchModal').classList.add('active');
  await handleLiveMedicationSearch('');
}

async function handleLiveMedicationSearch(query) {
  const container = document.getElementById('medSearchResultsContainer');
  if (!container) return;
  container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 12px;">Searching pharmacy inventory...</div>';

  try {
    const results = await window.api.searchInventory(query || '');
    container.innerHTML = '';

    if (!results || results.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 20px;">
          No matching pharmacy medications found.
          <div style="margin-top: 8px;">
            <button type="button" class="btn btn-secondary btn-xs" onclick="closeModal('medicationSearchModal'); openCustomMedicationModal();">
              + Add as Custom Medication
            </button>
          </div>
        </div>
      `;
      return;
    }

    results.forEach(drug => {
      const isLow = drug.quantity <= (drug.min_stock_level || 50);
      const isOut = drug.quantity <= 0;
      const stockBadge = isOut
        ? '<span class="stock-badge out">Out of Stock</span>'
        : (isLow ? `<span class="stock-badge low">Stock: ${drug.quantity} (Low)</span>` : `<span class="stock-badge in-stock">Stock: ${drug.quantity}</span>`);

      const itemEl = document.createElement('div');
      itemEl.className = 'med-search-item';
      itemEl.onclick = () => selectDrugForConfig(drug);

      itemEl.innerHTML = `
        <div>
          <div style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${drug.name}</div>
          <div style="font-size: 11px; color: var(--text-muted);">
            ${drug.code ? `Code: ${drug.code} • ` : ''}${drug.category || 'Medicine'} ${drug.dosage_form ? `• Form: ${drug.dosage_form}` : ''}
          </div>
        </div>
        <div style="text-align: right; display: flex; align-items: center; gap: 10px;">
          <span style="font-weight: 700; font-size: 12px; color: var(--text-primary);">Rs. ${drug.selling_price.toFixed(2)}</span>
          ${stockBadge}
        </div>
      `;
      container.appendChild(itemEl);
    });
  } catch (error) {
    console.error('Error searching inventory:', error);
    container.innerHTML = '<div style="color: #ef4444; padding: 12px; text-align: center;">Error loading inventory.</div>';
  }
}

function selectDrugForConfig(drug) {
  document.getElementById('configSelectedMedId').value = drug.id;
  document.getElementById('configSelectedMedName').value = drug.name;
  document.getElementById('configSelectedMedPrice').value = drug.selling_price;
  document.getElementById('configSelectedMedStock').value = drug.quantity;

  document.getElementById('selectedDrugConfigName').innerHTML = `
    <span>${drug.name}</span>
    <span style="font-size: 12px; font-weight: normal; color: var(--text-muted); margin-left: 8px;">
      Stock Available: ${drug.quantity} | Unit Price: Rs. ${drug.selling_price.toFixed(2)}
    </span>
  `;

  document.getElementById('configMedDosage').value = drug.dosage_form ? `1 ${drug.dosage_form}` : '1 tablet';
  document.getElementById('configMedQty').value = 10;
  document.getElementById('configMedDuration').value = '5 days';
  document.getElementById('configMedInstructions').value = 'Take after food';

  document.getElementById('selectedDrugConfigArea').style.display = 'block';
  document.getElementById('selectedDrugConfigArea').scrollIntoView({ behavior: 'smooth' });
}

function cancelSelectedDrugConfig() {
  document.getElementById('selectedDrugConfigArea').style.display = 'none';
}

function confirmAddSelectedDrugToPrescription() {
  const medId = parseInt(document.getElementById('configSelectedMedId').value, 10);
  const medName = document.getElementById('configSelectedMedName').value;
  const price = parseFloat(document.getElementById('configSelectedMedPrice').value) || 0;
  const stock = parseInt(document.getElementById('configSelectedMedStock').value, 10) || 0;

  const dosage = document.getElementById('configMedDosage').value.trim();
  const freq = document.getElementById('configMedFrequency').value;
  const duration = document.getElementById('configMedDuration').value.trim();
  const qty = parseInt(document.getElementById('configMedQty').value, 10);
  const instructions = document.getElementById('configMedInstructions').value.trim();

  if (!qty || qty <= 0) {
    alert('Please enter a valid quantity greater than 0.');
    return;
  }

  currentPrescriptionItems.push({
    medicine_id: medId,
    is_custom: 0,
    name: medName,
    dosage: dosage || '',
    form: '',
    frequency: freq || '',
    duration: duration || '',
    quantity: qty,
    prescribed_qty: qty,
    dispensed_qty: 0,
    instructions: instructions || '',
    selling_price: price,
    available_stock: stock,
    status: 'prescribed'
  });

  closeModal('medicationSearchModal');
  renderPrescribedItems();
}

// CUSTOM MEDICATION MODAL
function openCustomMedicationModal() {
  document.getElementById('customMedicationForm').reset();
  document.getElementById('customMedicationModal').classList.add('active');
}

function handleCustomMedicationSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('customMedName').value.trim();
  const dosage = document.getElementById('customMedDosage').value.trim();
  const form = document.getElementById('customMedForm').value;
  const freq = document.getElementById('customMedFrequency').value;
  const duration = document.getElementById('customMedDuration').value.trim();
  const qty = parseInt(document.getElementById('customMedQuantity').value, 10);
  const instructions = document.getElementById('customMedInstructions').value.trim();

  if (!name) {
    alert('Please specify the medication name.');
    return;
  }
  if (!qty || qty <= 0) {
    alert('Please enter a valid quantity.');
    return;
  }

  currentPrescriptionItems.push({
    medicine_id: null,
    is_custom: 1,
    name: name,
    dosage: dosage || '',
    form: form || '',
    frequency: freq || '',
    duration: duration || '',
    quantity: qty,
    prescribed_qty: qty,
    dispensed_qty: 0,
    instructions: instructions || '',
    selling_price: 0,
    available_stock: null,
    status: 'prescribed'
  });

  closeModal('customMedicationModal');
  renderPrescribedItems();
}

// RENDER PRESCRIBED ITEMS IN WRITER
function renderPrescribedItems() {
  const container = document.getElementById('rxPrescribedItemsList');
  if (!container) return;

  if (currentPrescriptionItems.length === 0) {
    container.innerHTML = `
      <div style="color: var(--text-muted); text-align: center; padding: 24px;" id="rxEmptyItemsPrompt">
        No medications added yet. Click <strong>Search Medication</strong> or <strong>Add Custom Medication</strong>.
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  currentPrescriptionItems.forEach((item, index) => {
    const isCustom = !!item.is_custom;
    const badge = isCustom
      ? '<span class="med-source-badge custom">Custom Item (External)</span>'
      : `<span class="med-source-badge pharmacy">Pharmacy Item (Stock: ${item.available_stock !== undefined ? item.available_stock : 'In Stock'})</span>`;

    const card = document.createElement('div');
    card.className = 'prescribed-item-card';
    card.innerHTML = `
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <strong style="font-size: 14px;">${item.name}</strong>
          ${badge}
        </div>
        <div style="font-size: 12px; color: var(--text-secondary); display: flex; gap: 12px; flex-wrap: wrap;">
          ${item.dosage ? `<span><strong>Dosage:</strong> ${item.dosage}</span>` : ''}
          ${item.frequency ? `<span><strong>Frequency:</strong> ${item.frequency}</span>` : ''}
          ${item.duration ? `<span><strong>Duration:</strong> ${item.duration}</span>` : ''}
          <span><strong>Prescribed Qty:</strong> ${item.quantity}</span>
        </div>
        ${item.instructions ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;"><em>Note: ${item.instructions}</em></div>` : ''}
      </div>
      <div>
        <button type="button" class="btn btn-danger btn-xs" onclick="removePrescribedItem(${index})" title="Remove item">&times; Remove</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function removePrescribedItem(index) {
  currentPrescriptionItems.splice(index, 1);
  renderPrescribedItems();
}

function resetActivePrescriptionForm() {
  document.getElementById('activePrescriptionForm').reset();
  currentPrescriptionItems = [];
  renderPrescribedItems();
}

// SAVE ACTIVE PRESCRIPTION & CONSULTATION
async function savePatientActivePrescription(event) {
  event.preventDefault();

  if (!selectedPatientId) {
    alert('No patient selected. Please select a patient first.');
    return;
  }

  const symptoms = document.getElementById('rxConsultSymptoms').value.trim();
  const diagnosis = document.getElementById('rxConsultDiagnosis').value.trim();
  const fee = parseFloat(document.getElementById('rxDoctorFee').value) || 0;
  const notes = document.getElementById('rxGeneralNotes').value.trim();

  if (currentPrescriptionItems.length === 0 && !symptoms && !diagnosis) {
    alert('Please enter clinical details (symptoms/diagnosis) or add prescribed medications.');
    return;
  }

  try {
    // 1. Create prescription record (NOTE: Does NOT deduct stock at draft stage!)
    let prescriptionId = null;
    if (currentPrescriptionItems.length > 0) {
      const rxResult = await window.api.createPrescription({
        patient_id: selectedPatientId,
        doctor_id: currentUser ? currentUser.id : null,
        items: currentPrescriptionItems
      });
      prescriptionId = rxResult ? rxResult.id : null;
    }

    // 2. Create consultation record
    await window.api.createConsultation({
      patient_id: selectedPatientId,
      doctor_id: currentUser ? currentUser.id : null,
      symptoms: symptoms || null,
      diagnosis: diagnosis || null,
      notes: notes || null,
      doctor_fee: fee,
      prescription_id: prescriptionId
    });

    // 3. Mark patient queue as completed if in queue
    try {
      const queue = await window.api.getQueue();
      const waitingItem = queue.find(q => (q.patient_id === selectedPatientId || q.patient_uid === selectedPatientId) && q.status === 'waiting');
      if (waitingItem) {
        await window.api.updateQueueStatus(waitingItem.id, 'seen');
      }
    } catch (e) {
      console.warn('Queue status update non-critical:', e);
    }

    alert('Consultation and Prescription recorded successfully!\n(Stock remains reserved and will only be deducted upon dispensing at the Pharmacy).');

    resetActivePrescriptionForm();
    await loadPatientConsultationHistory(selectedPatientId);
    await loadPatientPrescriptionsTimeline(selectedPatientId);
    refreshQueueUI();
  } catch (error) {
    console.error('Failed to save prescription and consultation:', error);
    alert('Error saving consultation: ' + error.message);
  }
}

// BACKWARD COMPATIBILITY MODAL PRESCRIPTION HELPERS
function openNewPrescriptionModal() {
  document.getElementById('prescriptionForm').reset();
  document.getElementById('rxItemsContainer').innerHTML = '';
  rxItemIndex = 0;
  addRxItemRow();
  document.getElementById('prescriptionModal').classList.add('active');
}

async function addRxItemRow() {
  const container = document.getElementById('rxItemsContainer');
  const index = rxItemIndex++;

  try {
    if (allInventory.length === 0) {
      allInventory = await window.api.getInventory();
    }

    const row = document.createElement('div');
    row.className = 'form-row';
    row.id = `rx-row-${index}`;

    let optionsHtml = '<option value="">-- Choose Drug --</option>';
    allInventory.forEach(item => {
      optionsHtml += `<option value="${item.id}">${item.name} (Stock: ${item.quantity})</option>`;
    });

    row.innerHTML = `
      <div class="form-group" style="flex: 3; margin-bottom: 0;">
        <select class="rx-medicine-select" required id="rx-med-${index}">
          ${optionsHtml}
        </select>
      </div>
      <div class="form-group" style="flex: 1; margin-bottom: 0;">
        <input type="number" class="rx-qty-input" required min="1" placeholder="Qty" id="rx-qty-${index}">
      </div>
      <button type="button" class="btn btn-danger btn-xs" onclick="removeRxItemRow(${index})" style="height: 38px;">&times;</button>
    `;

    container.appendChild(row);
  } catch (error) {
    console.error('Failed to add rx item row:', error);
  }
}

function removeRxItemRow(index) {
  const row = document.getElementById(`rx-row-${index}`);
  if (row) row.remove();
}

async function savePrescription(event) {
  event.preventDefault();
  const selects = document.querySelectorAll('.rx-medicine-select');
  const qtys = document.querySelectorAll('.rx-qty-input');
  
  const items = [];
  selects.forEach((sel, i) => {
    const medId = parseInt(sel.value, 10);
    const qty = parseInt(qtys[i].value, 10);
    const medName = sel.options[sel.selectedIndex].text.split(' (Stock:')[0];

    if (medId && qty > 0) {
      items.push({
        medicine_id: medId,
        is_custom: 0,
        name: medName,
        prescribed_qty: qty,
        dispensed_qty: 0,
        status: 'prescribed'
      });
    }
  });

  if (items.length === 0) {
    alert('Please select at least one medicine!');
    return;
  }

  try {
    await window.api.createPrescription({
      patient_id: selectedPatientId,
      doctor_id: currentUser ? currentUser.id : null,
      items: items
    });

    closeModal('prescriptionModal');
    loadPatientProfile(selectedPatientId);
  } catch (error) {
    console.error('Failed to save prescription:', error);
  }
}

// ==========================================
// CONSULTATIONS MODULE
// ==========================================

async function refreshConsultationsQueue() {
  const container = document.getElementById('consultationWaitingQueue');
  if (!container) return;
  container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">Loading queue...</div>';

  try {
    const queue = await window.api.getQueue();
    const waiting = (queue || []).filter(q => q.status === 'waiting');
    container.innerHTML = '';

    if (waiting.length === 0) {
      container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">No patients currently waiting for consultation.</div>';
      return;
    }

    waiting.forEach(item => {
      const card = document.createElement('div');
      card.className = 'queue-card';
      card.innerHTML = `
        <div class="queue-token">#${item.token_number}</div>
        <div class="queue-info">
          <div class="queue-name">${item.patient_name}</div>
          <div class="queue-meta">Wait: ${item.wait_time} • ${item.source === 'appointment' ? 'Scheduled' : 'Walk-in'}</div>
        </div>
        <div class="queue-actions">
          <button class="btn btn-primary btn-xs" onclick="startConsultationForPatient('${item.patient_id || item.patient_uid}')">
            🩺 Consult
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (error) {
    console.error('Failed to load consultation queue:', error);
    container.innerHTML = '<div style="color: #ef4444; padding: 20px; text-align: center;">Error loading queue.</div>';
  }
}

function startConsultationForPatient(patientId) {
  selectedPatientId = patientId;
  switchScreen('patient-profile');
  switchPatientTab('prescription');
}

async function loadConsultationsLog() {
  const tbody = document.getElementById('consultationsLogTableBody');
  if (!tbody) return;
  
  const dateInput = document.getElementById('consultationDateFilter');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">Loading consultations...</td></tr>';

  try {
    const list = await window.api.getConsultations();
    tbody.innerHTML = '';

    const selectedDate = dateInput ? dateInput.value : '';
    const filtered = (list || []).filter(c => {
      if (!selectedDate) return true;
      return c.created_at && c.created_at.startsWith(selectedDate);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No consultations recorded for ${selectedDate || 'today'}.</td></tr>`;
      return;
    }

    filtered.forEach(c => {
      const dt = new Date(c.created_at);
      const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-size: 12px; font-weight: 600;">${timeStr}</td>
        <td style="font-weight: 600;">
          <a href="javascript:void(0)" onclick="selectPatient('${c.patient_id}')" style="color: var(--primary); text-decoration: none;">
            ${c.patient_name || 'Patient'}
          </a>
        </td>
        <td style="font-size: 13px;">${c.diagnosis || '-'}</td>
        <td style="font-size: 12px;">${c.doctor_name || 'Doctor'}</td>
        <td style="font-weight: 600; font-size: 13px;">Rs. ${(c.doctor_fee || 0).toFixed(2)}</td>
        <td>
          <button class="btn btn-secondary btn-xs" onclick="viewConsultationRecord(${c.id})">Details</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Failed to load consultations log:', error);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">Error loading log.</td></tr>';
  }
}

async function viewConsultationRecord(consultationId) {
  try {
    const list = await window.api.getConsultations();
    const item = (list || []).find(c => c.id === consultationId);
    if (!item) return;

    const modalBody = document.getElementById('consultationDetailBody');
    const dt = new Date(item.created_at);

    let itemsHtml = '';
    if (item.prescription_items) {
      try {
        const meds = JSON.parse(item.prescription_items);
        meds.forEach(m => {
          itemsHtml += `
            <li style="padding: 6px 0; border-bottom: 1px dashed var(--border-color); font-size: 12px;">
              <strong>${m.name}</strong> ${m.is_custom ? '<span class="med-source-badge custom" style="font-size: 10px;">Custom</span>' : '<span class="med-source-badge pharmacy" style="font-size: 10px;">Pharmacy</span>'}
              - Qty: ${m.quantity || m.prescribed_qty} | ${[m.dosage, m.frequency, m.duration].filter(Boolean).join(' • ')}
              ${m.instructions ? `<div style="font-style: italic; color: var(--text-muted); font-size: 11px;">"${m.instructions}"</div>` : ''}
            </li>
          `;
        });
      } catch (e) {}
    }

    modalBody.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">
          <div>
            <div style="font-size: 16px; font-weight: 700;">${item.patient_name || 'Patient'}</div>
            <div style="font-size: 12px; color: var(--text-muted);">Consultation #${item.id} • ${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; color: var(--text-muted);">Doctor</div>
            <div style="font-weight: 600; font-size: 13px;">${item.doctor_name || 'Doctor'}</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div style="background: var(--bg-hover); padding: 10px; border-radius: 6px;">
            <div style="font-size: 11px; color: var(--text-muted); font-weight: 700;">CHIEF SYMPTOMS</div>
            <div style="font-size: 13px; margin-top: 4px;">${item.symptoms || 'None recorded'}</div>
          </div>
          <div style="background: var(--bg-hover); padding: 10px; border-radius: 6px;">
            <div style="font-size: 11px; color: var(--text-muted); font-weight: 700;">DIAGNOSIS</div>
            <div style="font-size: 13px; margin-top: 4px; font-weight: 600; color: var(--primary);">${item.diagnosis || 'None recorded'}</div>
          </div>
        </div>

        ${item.notes ? `
          <div style="background: var(--bg-hover); padding: 10px; border-radius: 6px;">
            <div style="font-size: 11px; color: var(--text-muted); font-weight: 700;">CLINICAL NOTES & INSTRUCTIONS</div>
            <div style="font-size: 13px; margin-top: 4px; white-space: pre-wrap;">${item.notes}</div>
          </div>
        ` : ''}

        <div>
          <div style="font-size: 12px; font-weight: 700; margin-bottom: 6px;">Prescribed Medications:</div>
          <ul style="list-style: none; padding: 0; margin: 0; background: var(--bg-hover); padding: 8px 12px; border-radius: 6px;">
            ${itemsHtml || '<li style="font-size: 12px; color: var(--text-muted);">No medications attached to this consultation.</li>'}
          </ul>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 10px;">
          <span style="font-size: 13px; font-weight: 600;">Consultation Fee:</span>
          <span style="font-size: 16px; font-weight: 800; color: #10b981;">Rs. ${(item.doctor_fee || 0).toFixed(2)}</span>
        </div>
      </div>
    `;

    document.getElementById('consultationDetailModal').classList.add('active');
  } catch (error) {
    console.error('Error viewing consultation record:', error);
  }
}

// ==========================================
// PHARMACY & INVENTORY
// ==========================================

async function loadInventoryList() {
  try {
    allInventory = await window.api.getInventory();
    renderInventoryTable(allInventory);

    // Render low stock alerts
    if (window.api && window.api.getInventoryLowStock) {
      try {
        const lowStock = await window.api.getInventoryLowStock();
        const alertContainer = document.getElementById('pharmacyLowStockAlertsContainer');
        if (alertContainer) {
          if (lowStock && lowStock.length > 0) {
            alertContainer.innerHTML = lowStock.map(m => `
              <div class="low-stock-alert-banner">
                <span class="badge-low-stock">LOW STOCK</span>
                <span style="font-size: 13px; font-weight: 700;">${m.name}</span> &mdash;
                <span style="color:#ef4444; font-weight: 700; font-size: 13px;">${m.quantity} remaining</span>
                <span style="font-size: 11px; color: var(--text-muted); margin-left: 6px;">(Min threshold: ${m.min_stock_level || 10})</span>
              </div>
            `).join('');
            alertContainer.style.display = 'block';
          } else {
            alertContainer.innerHTML = '';
            alertContainer.style.display = 'none';
          }
        }
      } catch (e) {
        console.warn('Low stock check notice:', e);
      }
    }
  } catch (error) {
    console.error('Failed to load inventory:', error);
  }
}

function renderInventoryTable(list) {
  const tbody = document.getElementById('inventoryTableBody');
  tbody.innerHTML = '';

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No drugs in inventory.</td></tr>';
    return;
  }

  list.forEach(item => {
    const margin = item.selling_price - item.cost_price;
    tbody.innerHTML += `
      <tr>
        <td style="font-weight: 600;">${item.name}</td>
        <td style="font-weight: 700; ${item.quantity < 50 ? 'color:#ef4444;' : ''}">${item.quantity}</td>
        <td>Rs. ${item.cost_price.toFixed(2)}</td>
        <td>Rs. ${item.selling_price.toFixed(2)}</td>
        <td style="color:#10b981;">Rs. ${margin.toFixed(2)}</td>
        <td>
          <button class="btn btn-secondary btn-xs" onclick="openEditInventoryModal(${item.id})">Edit</button>
        </td>
      </tr>
    `;
  });
}

function filterInventoryList() {
  const query = document.getElementById('inventorySearchInput').value.toLowerCase().trim();
  if (!query) {
    renderInventoryTable(allInventory);
    return;
  }
  const filtered = allInventory.filter(item => item.name.toLowerCase().includes(query));
  renderInventoryTable(filtered);
}

function openNewInventoryModal() {
  document.getElementById('inventoryForm').reset();
  document.getElementById('editInventoryId').value = '';
  document.getElementById('inventoryModalTitle').textContent = 'Add Medicine to Stock';
  document.getElementById('inventoryModal').classList.add('active');
}

function openEditInventoryModal(id) {
  const item = allInventory.find(i => i.id === id);
  if (!item) return;

  document.getElementById('editInventoryId').value = item.id;
  document.getElementById('invName').value = item.name;
  document.getElementById('invQuantity').value = item.quantity;
  document.getElementById('invCostPrice').value = item.cost_price;
  document.getElementById('invSellingPrice').value = item.selling_price;
  document.getElementById('inventoryModalTitle').textContent = 'Edit Stock Details';
  document.getElementById('inventoryModal').classList.add('active');
}

async function saveInventoryItem(event) {
  event.preventDefault();
  const editId = document.getElementById('editInventoryId').value;
  const name = document.getElementById('invName').value.trim();
  const quantity = parseInt(document.getElementById('invQuantity').value, 10);
  const cost_price = parseFloat(document.getElementById('invCostPrice').value);
  const selling_price = parseFloat(document.getElementById('invSellingPrice').value);

  const itemData = { name, quantity, cost_price, selling_price };

  try {
    if (editId) {
      await window.api.updateInventoryItem(editId, itemData);
    } else {
      await window.api.createInventoryItem(itemData);
    }
    
    closeModal('inventoryModal');
    loadInventoryList();
  } catch (error) {
    console.error('Failed to save inventory item:', error);
  }
}

// DISPENSING
let currentDispensingRx = null;

async function loadPendingRxDispenseDropdown() {
  try {
    const select = document.getElementById('dispenseSearchSelect');
    const patients = await window.api.getPatients();
    
    select.innerHTML = '<option value="">-- Select Patient --</option>';
    patients.forEach(p => {
      select.innerHTML += `<option value="${p.id || p.uid}">${p.full_name || p.name} (${p.id || p.uid})</option>`;
    });
    
    document.getElementById('dispensingWorkArea').style.display = 'none';
    document.getElementById('noPendingRxMessage').style.display = 'block';
  } catch (error) {
    console.error('Failed to load pending dropdown:', error);
  }
}

async function loadPatientPrescriptionForDispensing(patientId) {
  if (!patientId) {
    document.getElementById('dispensingWorkArea').style.display = 'none';
    document.getElementById('noPendingRxMessage').style.display = 'block';
    return;
  }

  try {
    const rxList = await window.api.getPrescriptionHistory(patientId);
    const activeRx = rxList.find(r => r.status === 'prescribed' || r.status === 'partially_dispensed');
    
    if (!activeRx) {
      document.getElementById('dispensingWorkArea').style.display = 'none';
      document.getElementById('noPendingRxMessage').innerHTML = '<div style="color:#ef4444;">No pending prescriptions for this patient.</div>';
      document.getElementById('noPendingRxMessage').style.display = 'block';
      currentDispensingRx = null;
      return;
    }

    currentDispensingRx = activeRx;
    document.getElementById('dispenseRxDate').textContent = `Date: ${new Date(activeRx.created_at).toLocaleDateString()} (Rx #${activeRx.id})`;
    document.getElementById('noPendingRxMessage').style.display = 'none';
    document.getElementById('dispensingWorkArea').style.display = 'flex';

    const container = document.getElementById('dispensingItemsContainer');
    container.innerHTML = '';
    const items = JSON.parse(activeRx.items || '[]');
    allInventory = await window.api.getInventory();

    items.forEach((item) => {
      const isCustom = !!item.is_custom;
      const invMed = isCustom ? null : allInventory.find(i => i.id === item.medicine_id);
      const stock = invMed ? invMed.quantity : 0;
      const unitPrice = invMed ? invMed.selling_price : 0;
      const neededQty = (item.quantity || item.prescribed_qty) - (item.dispensed_qty || 0);

      const row = document.createElement('div');
      row.className = 'form-row';
      row.style.alignItems = 'center';
      
      if (isCustom) {
        row.innerHTML = `
          <div style="flex: 3;">
            <div style="font-weight: 600; font-size: 13px;">
              ${item.name}
              <span class="med-source-badge custom" style="margin-left: 6px; font-size: 10px;">Custom (External)</span>
            </div>
            <div style="font-size: 11px; color: var(--text-muted);">
              Prescribed: ${neededQty} • External prescription item (No pharmacy inventory deduction)
            </div>
          </div>
          <div class="form-group" style="flex: 1; margin-bottom: 0;">
            <input type="number" class="dispense-qty-inp" 
                   data-med-id="" 
                   data-is-custom="true"
                   data-unit-price="0" 
                   max="${neededQty}" 
                   min="0" 
                   value="${neededQty}" 
                   oninput="calculateDispenseTotals()" 
                   style="padding: 6px; font-size: 13px;">
          </div>
        `;
      } else {
        const isInsufficient = stock < neededQty;
        row.innerHTML = `
          <div style="flex: 3;">
            <div style="font-weight: 600; font-size: 13px;">
              ${item.name}
              <span class="med-source-badge pharmacy" style="margin-left: 6px; font-size: 10px;">Pharmacy Stock</span>
            </div>
            <div style="font-size: 11px; color: ${isInsufficient ? '#ef4444; font-weight: 700;' : 'var(--text-muted);'}">
              Prescribed: ${neededQty} • Stock: ${stock} ${isInsufficient ? '⚠️ Insufficient Stock!' : ''}
            </div>
          </div>
          <div class="form-group" style="flex: 1; margin-bottom: 0;">
            <input type="number" class="dispense-qty-inp" 
                   data-med-id="${item.medicine_id}" 
                   data-is-custom="false"
                   data-unit-price="${unitPrice}" 
                   max="${neededQty}" 
                   min="0" 
                   value="${Math.min(neededQty, stock)}" 
                   oninput="calculateDispenseTotals()" 
                   style="padding: 6px; font-size: 13px; ${isInsufficient ? 'border-color: #ef4444;' : ''}">
          </div>
        `;
      }

      container.appendChild(row);
    });

    calculateDispenseTotals();
  } catch (error) {
    console.error('Failed to load prescription for dispensing:', error);
  }
}

function calculateDispenseTotals() {
  let subtotal = 0;
  const inputs = document.querySelectorAll('.dispense-qty-inp');
  
  inputs.forEach(inp => {
    const qty = parseInt(inp.value, 10) || 0;
    const price = parseFloat(inp.getAttribute('data-unit-price')) || 0;
    subtotal += qty * price;
  });

  const fee = parseFloat(document.getElementById('dispenseDoctorFee').value) || 0;
  const total = subtotal + fee;
  document.getElementById('dispenseTotalPrice').textContent = `Rs. ${total.toFixed(2)}`;
}

document.getElementById('dispenseDoctorFee')?.addEventListener('input', calculateDispenseTotals);

async function submitDispenseTransaction() {
  if (!currentDispensingRx) return;

  const inputs = document.querySelectorAll('.dispense-qty-inp');
  const dispenseItems = [];
  
  inputs.forEach(inp => {
    const isCustom = inp.getAttribute('data-is-custom') === 'true';
    const medId = isCustom ? null : parseInt(inp.getAttribute('data-med-id'), 10);
    const qty = parseInt(inp.value, 10) || 0;
    const price = parseFloat(inp.getAttribute('data-unit-price')) || 0;
    if (qty > 0) {
      dispenseItems.push({
        medicine_id: medId,
        is_custom: isCustom ? 1 : 0,
        quantity_to_dispense: qty,
        selling_price: price
      });
    }
  });

  const doctorFee = parseFloat(document.getElementById('dispenseDoctorFee').value) || 0;

  try {
    await window.api.dispensePrescription(
      currentDispensingRx.id,
      dispenseItems,
      doctorFee,
      currentDispensingRx.patient_id
    );

    alert('Prescription successfully dispensed!');
    document.getElementById('dispenseSearchSelect').value = '';
    document.getElementById('dispensingWorkArea').style.display = 'none';
    document.getElementById('noPendingRxMessage').style.display = 'block';
    
    loadInventoryList();
    loadDashboardAnalytics();
    refreshQueueUI();
  } catch (error) {
    console.error('Dispensing error:', error);
    alert(`Dispensing Error: ${error.message}`);
  }
}

// ==========================================
// FINANCIAL REPORTS
// ==========================================

async function loadFinancialReports() {
  if (!currentUser || !currentUser.permissions.includes('view_profits')) return;

  const start = document.getElementById('repStartDate').value;
  const end = document.getElementById('repEndDate').value;

  try {
    const summary = await window.api.getProfitSummary(start, end);
    const sales = await window.api.getSalesReport(start, end);

    document.getElementById('repMedRevenue').textContent = `Rs. ${summary.medicine_revenue.toFixed(2)}`;
    document.getElementById('repMedProfit').textContent = `Rs. ${summary.medicine_profit.toFixed(2)}`;
    document.getElementById('repFeeRevenue').textContent = `Rs. ${summary.doctor_fee_revenue.toFixed(2)}`;
    document.getElementById('repTotalProfit').textContent = `Rs. ${summary.total_profit.toFixed(2)}`;

    const tbody = document.getElementById('salesRegisterTableBody');
    tbody.innerHTML = '';

    if (sales.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No sales recorded for this date range.</td></tr>';
      return;
    }

    sales.forEach(sale => {
      const dt = new Date(sale.created_at);
      const timeStr = `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const typeLabel = sale.type === 'doctor_fee' ? 'Doctor Consultation Fee' : (sale.medicine_name || 'Medicine Sale');

      tbody.innerHTML += `
        <tr>
          <td>${timeStr}</td>
          <td><span class="badge-status ${sale.type === 'doctor_fee' ? 'booked' : 'seen'}">${sale.type.toUpperCase()}</span></td>
          <td style="font-weight: 600;">${typeLabel}</td>
          <td>${sale.patient_name || '-'}</td>
          <td>${sale.quantity || 1}</td>
          <td style="font-weight: 600;">Rs. ${sale.amount.toFixed(2)}</td>
          <td style="color:#10b981; font-weight: 600;">Rs. ${sale.profit.toFixed(2)}</td>
        </tr>
      `;
    });
  } catch (error) {
    console.error('Failed to generate report:', error);
  }
}

// MODAL UTILITIES
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}
