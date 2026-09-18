const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Determine database storage path
const dbPath = process.env.TEST_DB_PATH || path.join(__dirname, 'clinic.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Helper to safely add column if not exists
function ensureColumn(table, column, definition) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = columns.some(c => c.name === column);
    if (!exists) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
  } catch (e) {
    console.error(`Error adding column ${column} to ${table}:`, e.message);
  }
}

// Initialize tables
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_deleted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      permissions TEXT NOT NULL, -- JSON array of permissions
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, role_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY, -- Legacy / local ID
      uid TEXT UNIQUE, -- Wire UUID v4
      name TEXT NOT NULL,
      full_name TEXT,
      nic TEXT,
      phone TEXT,
      dob TEXT,
      notes TEXT,
      age INTEGER,
      gender TEXT,
      address TEXT,
      medical_history TEXT,
      files TEXT DEFAULT '[]', -- JSON array of file paths/metadata
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      is_dirty INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS appointments (
      uid TEXT PRIMARY KEY,
      patient_uid TEXT NOT NULL,
      appt_date TEXT NOT NULL,
      queue_number INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('booked', 'seen', 'cancelled')),
      source TEXT NOT NULL CHECK (source IN ('online', 'desk')),
      reference TEXT,
      notes TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      is_dirty INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      resource TEXT PRIMARY KEY,
      last_since TEXT NOT NULL DEFAULT '0',
      last_cursor INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL,
      selling_price REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_deleted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      doctor_id INTEGER,
      items TEXT NOT NULL, -- JSON array of prescribed medicines
      status TEXT NOT NULL DEFAULT 'prescribed', -- 'prescribed', 'dispensed', 'partially_dispensed'
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_deleted INTEGER DEFAULT 0,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS sales (
      transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT,
      type TEXT NOT NULL, -- 'medicine' or 'doctor_fee'
      item_ref INTEGER, -- inventory_id for medicine
      quantity INTEGER DEFAULT 0,
      unit_cost REAL DEFAULT 0,
      unit_price REAL NOT NULL,
      amount REAL NOT NULL,
      profit REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (item_ref) REFERENCES inventory(id)
    );

    CREATE TABLE IF NOT EXISTS queue (
      patient_id TEXT PRIMARY KEY,
      queue_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting', -- 'waiting', 'called', 'in_consultation', 'done', 'no_show'
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_module_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      module_id INTEGER NOT NULL,
      can_view INTEGER NOT NULL DEFAULT 1,
      can_create INTEGER NOT NULL DEFAULT 1,
      can_edit INTEGER NOT NULL DEFAULT 1,
      can_delete INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE,
      UNIQUE(user_id, module_id)
    );

    CREATE TABLE IF NOT EXISTS consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      doctor_id INTEGER,
      consultation_date TEXT DEFAULT CURRENT_TIMESTAMP,
      symptoms TEXT,
      diagnosis TEXT,
      notes TEXT,
      doctor_fee REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      action TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
      payload TEXT NOT NULL, -- JSON payload of the row
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Ensure missing columns exist in existing database
  ensureColumn('roles', 'slug', 'TEXT');
  ensureColumn('roles', 'status', "TEXT DEFAULT 'active'");
  ensureColumn('roles', 'created_at', 'TEXT');
  ensureColumn('roles', 'updated_at', 'TEXT');
  ensureColumn('roles', 'default_modules', "TEXT DEFAULT '[]'");
  ensureColumn('roles', 'is_system', 'INTEGER DEFAULT 0');
  ensureColumn('roles', 'description', 'TEXT');

  ensureColumn('users', 'full_name', 'TEXT');
  ensureColumn('users', 'role_id', 'INTEGER');
  ensureColumn('users', 'status', "TEXT DEFAULT 'active'");

  ensureColumn('inventory', 'code', 'TEXT');
  ensureColumn('inventory', 'category', 'TEXT');
  ensureColumn('inventory', 'dosage_form', 'TEXT');
  ensureColumn('inventory', 'min_stock_level', 'INTEGER DEFAULT 10');
  ensureColumn('inventory', 'expiry_date', 'TEXT');

  ensureColumn('prescriptions', 'notes', 'TEXT');
  ensureColumn('prescriptions', 'consultation_id', 'INTEGER');
  ensureColumn('prescriptions', 'doctor_id', 'INTEGER');

  ensureColumn('consultations', 'prescription_id', 'INTEGER');
  ensureColumn('consultations', 'prescription_items', 'TEXT');

  ensureColumn('patients', 'uid', 'TEXT');
  ensureColumn('patients', 'full_name', 'TEXT');
  ensureColumn('patients', 'nic', 'TEXT');
  ensureColumn('patients', 'phone', 'TEXT');
  ensureColumn('patients', 'email', 'TEXT');
  ensureColumn('patients', 'emergency_contact', 'TEXT');
  ensureColumn('patients', 'dob', 'TEXT');
  ensureColumn('patients', 'notes', 'TEXT');
  ensureColumn('patients', 'deleted', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('patients', 'deleted_at', 'TEXT');
  ensureColumn('patients', 'is_dirty', 'INTEGER NOT NULL DEFAULT 0');

  // Backfill full_name on users if missing
  db.exec("UPDATE users SET full_name = COALESCE(full_name, name) WHERE full_name IS NULL OR full_name = '';");

  // Backfill patient UUIDs and full_names if missing
  const existingPatients = db.prepare("SELECT id, name, uid, full_name FROM patients WHERE uid IS NULL OR uid = ''").all();
  for (const pt of existingPatients) {
    const newUid = crypto.randomUUID();
    db.prepare("UPDATE patients SET uid = ?, full_name = COALESCE(full_name, name) WHERE id = ?").run(newUid, pt.id);
  }

  // Create unique index on patients(uid)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_uid ON patients(uid);`);

  // Migrate appointments table if old foreign key definition exists
  try {
    const apptTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='appointments'").get();
    if (apptTableInfo && apptTableInfo.sql && apptTableInfo.sql.includes('FOREIGN KEY')) {
      db.exec(`DROP TABLE appointments;`);
      db.exec(`
        CREATE TABLE IF NOT EXISTS appointments (
          uid TEXT PRIMARY KEY,
          patient_uid TEXT NOT NULL,
          appt_date TEXT NOT NULL,
          queue_number INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('booked', 'seen', 'cancelled')),
          source TEXT NOT NULL CHECK (source IN ('online', 'desk')),
          reference TEXT,
          notes TEXT,
          deleted INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          is_dirty INTEGER NOT NULL DEFAULT 0
        );
      `);
    }
  } catch (e) {
    console.error('Appointments table migration notice:', e.message);
  }

  // Create indexes for fast reports and sync queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_patients_updated_at ON patients(updated_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_patients_dirty ON patients(is_dirty);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appt_date);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_appointments_dirty ON appointments(is_dirty);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_inventory_updated_at ON inventory(updated_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_prescriptions_updated_at ON prescriptions(updated_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_queue_updated_at ON queue(updated_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations(patient_id);`);

  // Seed default modules
  const insertModule = db.prepare('INSERT OR IGNORE INTO modules (id, name, slug) VALUES (?, ?, ?)');
  insertModule.run(1, 'Dashboard', 'dashboard');
  insertModule.run(2, 'Appointments', 'appointments');
  insertModule.run(3, 'Consultations', 'consultations');
  insertModule.run(4, 'Patient Registry', 'patient_registry');
  insertModule.run(5, 'Pharmacy', 'pharmacy');
  insertModule.run(6, 'Financial Reports', 'financial_reports');

  // Seed default roles with proper names and slugs
  const defaultRoles = [
    {
      name: 'Doctor',
      slug: 'doctor',
      permissions: ['view_patients', 'manage_patients', 'prescribe', 'dispense', 'manage_inventory', 'view_profits', 'manage_queue'],
      default_modules: ['dashboard', 'appointments', 'consultations', 'patient_registry', 'pharmacy', 'financial_reports']
    },
    {
      name: 'Receptionist',
      slug: 'receptionist',
      permissions: ['view_patients', 'manage_patients', 'manage_queue'],
      default_modules: ['dashboard', 'appointments', 'patient_registry']
    },
    {
      name: 'Pharmacist',
      slug: 'pharmacist',
      permissions: ['view_patients', 'dispense', 'manage_inventory'],
      default_modules: ['dashboard', 'pharmacy']
    }
  ];

  for (const r of defaultRoles) {
    const existing = db.prepare('SELECT id, name, slug FROM roles WHERE slug = ? OR lower(name) = ?').get(r.slug, r.slug);
    if (existing) {
      db.prepare(`
        UPDATE roles
        SET name = ?, slug = ?, permissions = COALESCE(permissions, ?), default_modules = COALESCE(default_modules, ?), status = 'active', is_system = 1
        WHERE id = ?
      `).run(r.name, r.slug, JSON.stringify(r.permissions), JSON.stringify(r.default_modules), existing.id);
    } else {
      db.prepare(`
        INSERT INTO roles (name, slug, permissions, default_modules, status, is_system)
        VALUES (?, ?, ?, ?, 'active', 1)
      `).run(r.name, r.slug, JSON.stringify(r.permissions), JSON.stringify(r.default_modules));
    }
  }

  // Ensure all existing roles have non-null slugs
  db.exec("UPDATE roles SET slug = lower(replace(name, ' ', '_')) WHERE slug IS NULL OR slug = '';");

  // Deduplicate roles by slug
  const allExistingRoles = db.prepare('SELECT id, slug, is_system FROM roles ORDER BY is_system DESC, id ASC').all();
  const seenSlugs = new Set();
  for (const roleRow of allExistingRoles) {
    if (seenSlugs.has(roleRow.slug)) {
      const primaryRole = db.prepare('SELECT id FROM roles WHERE slug = ? ORDER BY is_system DESC, id ASC LIMIT 1').get(roleRow.slug);
      if (primaryRole && primaryRole.id !== roleRow.id) {
        db.prepare('UPDATE user_roles SET role_id = ? WHERE role_id = ?').run(primaryRole.id, roleRow.id);
        db.prepare('UPDATE users SET role_id = ? WHERE role_id = ?').run(primaryRole.id, roleRow.id);
        db.prepare('DELETE FROM roles WHERE id = ?').run(roleRow.id);
      }
    } else {
      seenSlugs.add(roleRow.slug);
    }
  }

  // Seed standard medicines in inventory if inventory is completely empty
  const invCount = db.prepare('SELECT COUNT(*) as count FROM inventory WHERE is_deleted = 0').get().count;
  if (invCount === 0) {
    const insertInv = db.prepare(`
      INSERT INTO inventory (name, code, category, dosage_form, quantity, min_stock_level, cost_price, selling_price, expiry_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertInv.run('Paracetamol 500mg', 'MED-001', 'Analgesics', 'Tablet', 180, 50, 1.50, 3.00, '2027-12-31');
    insertInv.run('Amoxicillin 500mg', 'MED-002', 'Antibiotics', 'Capsule', 95, 30, 8.00, 15.00, '2027-08-31');
    insertInv.run('Cetirizine 10mg', 'MED-003', 'Antihistamines', 'Tablet', 120, 25, 3.00, 6.00, '2028-01-31');
    insertInv.run('Metformin 500mg', 'MED-004', 'Antidiabetic', 'Tablet', 150, 40, 4.00, 7.50, '2027-11-30');
    insertInv.run('Omeprazole 20mg', 'MED-005', 'Gastrointestinal', 'Capsule', 85, 20, 5.00, 10.00, '2027-09-30');
    insertInv.run('Salbutamol 2mg', 'MED-006', 'Respiratory', 'Tablet', 110, 25, 2.50, 5.00, '2027-10-31');
    insertInv.run('Atorvastatin 20mg', 'MED-007', 'Cardiovascular', 'Tablet', 60, 20, 12.00, 22.00, '2028-03-31');
    insertInv.run('Ibuprofen 400mg', 'MED-008', 'NSAIDs', 'Tablet', 70, 25, 4.50, 8.00, '2027-07-31');
  }

  // Ensure default module permissions exist for any existing users
  const existingUsers = db.prepare('SELECT id, username FROM users WHERE is_deleted = 0').all();
  const allModules = db.prepare('SELECT id, slug FROM modules').all();
  const moduleMap = {};
  allModules.forEach(m => { moduleMap[m.slug] = m.id; });
  const checkPerm = db.prepare('SELECT COUNT(*) as count FROM user_module_permissions WHERE user_id = ?');
  const insertPerm = db.prepare('INSERT OR IGNORE INTO user_module_permissions (user_id, module_id, can_view, can_create, can_edit, can_delete) VALUES (?, ?, 1, 1, 1, 1)');

  for (const u of existingUsers) {
    const hasPerms = checkPerm.get(u.id).count;
    if (hasPerms === 0) {
      if (u.username.includes('doctor')) {
        allModules.forEach(m => insertPerm.run(u.id, m.id));
      } else if (u.username.includes('receptionist')) {
        ['dashboard', 'appointments', 'patient_registry'].forEach(slug => {
          if (moduleMap[slug]) insertPerm.run(u.id, moduleMap[slug]);
        });
      } else if (u.username.includes('pharmacist')) {
        ['dashboard', 'pharmacy'].forEach(slug => {
          if (moduleMap[slug]) insertPerm.run(u.id, moduleMap[slug]);
        });
      } else {
        ['dashboard', 'appointments', 'patient_registry'].forEach(slug => {
          if (moduleMap[slug]) insertPerm.run(u.id, moduleMap[slug]);
        });
      }
    }
  }
}

// Database helper functions
const dbOps = {
  // System Setup / Installation Detection
  isInstallationCompleted() {
    try {
      const row = db.prepare("SELECT value FROM sync_settings WHERE key = 'installation_completed'").get();
      if (!row || row.value !== 'true') return false;
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_deleted = 0').get().count;
      return userCount > 0;
    } catch (e) {
      return false;
    }
  },

  isSystemInstalled() {
    return this.isInstallationCompleted();
  },

  getModules() {
    return db.prepare('SELECT * FROM modules ORDER BY id ASC').all();
  },

  getUserModules(userId) {
    return db.prepare(`
      SELECT m.id, m.name, m.slug, ump.can_view, ump.can_create, ump.can_edit, ump.can_delete
      FROM user_module_permissions ump
      JOIN modules m ON ump.module_id = m.id
      WHERE ump.user_id = ? AND ump.can_view = 1
      ORDER BY m.id ASC
    `).all(userId);
  },

  checkUserPermission(userId, moduleSlug) {
    const perm = db.prepare(`
      SELECT ump.can_view
      FROM user_module_permissions ump
      JOIN modules m ON ump.module_id = m.id
      WHERE ump.user_id = ? AND m.slug = ?
    `).get(userId, moduleSlug);
    return Boolean(perm && perm.can_view === 1);
  },

  // Dynamic Role Management
  getRoles(includeInactive = false) {
    if (includeInactive) {
      return db.prepare('SELECT * FROM roles ORDER BY is_system DESC, name ASC').all();
    }
    return db.prepare("SELECT * FROM roles WHERE status = 'active' ORDER BY is_system DESC, name ASC").all();
  },

  getRoleById(id) {
    return db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
  },

  createRole({ name, slug, description, permissions = [], default_modules = [] }) {
    if (!name || !name.trim()) throw new Error('Role name is required.');
    const roleName = name.trim();
    const roleSlug = (slug || roleName.toLowerCase().replace(/[^a-z0-9]+/g, '_')).trim();

    const existing = db.prepare('SELECT id FROM roles WHERE slug = ? OR lower(name) = ?').get(roleSlug, roleName.toLowerCase());
    if (existing) {
      throw new Error(`Role with name "${roleName}" or slug "${roleSlug}" already exists.`);
    }

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO roles (name, slug, description, permissions, default_modules, status, is_system, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)
    `).run(roleName, roleSlug, description ? description.trim() : null, JSON.stringify(permissions), JSON.stringify(default_modules), now, now);

    return db.prepare('SELECT * FROM roles WHERE id = ?').get(result.lastInsertRowid);
  },

  updateRole(id, { name, permissions, default_modules, status }) {
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
    if (!role) throw new Error('Role not found.');

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE roles
      SET name = COALESCE(?, name),
          permissions = COALESCE(?, permissions),
          default_modules = COALESCE(?, default_modules),
          status = COALESCE(?, status),
          updated_at = ?
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      permissions ? JSON.stringify(permissions) : null,
      default_modules ? JSON.stringify(default_modules) : null,
      status || null,
      now,
      id
    );

    return db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
  },

  toggleRoleStatus(id, newStatus) {
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
    if (!role) throw new Error('Role not found.');

    if (newStatus === 'inactive') {
      const activeUsersCount = db.prepare(`
        SELECT COUNT(*) as count FROM users u
        JOIN user_roles ur ON u.id = ur.user_id
        WHERE ur.role_id = ? AND u.status = 'active' AND u.is_deleted = 0
      `).get(id).count;

      if (activeUsersCount > 0) {
        throw new Error(`Cannot deactivate role "${role.name}": it is currently assigned to ${activeUsersCount} active user(s).`);
      }
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE roles SET status = ?, updated_at = ? WHERE id = ?").run(newStatus, now, id);
    return db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
  },

  // User Management
  getUsers() {
    return db.prepare(`
      SELECT u.id, COALESCE(u.full_name, u.name) as full_name, u.username, u.role_id, u.status, u.created_at, u.updated_at,
             COALESCE(r.name, 'Staff') as role_name,
             COALESCE(r.slug, 'staff') as role_slug
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.is_deleted = 0
      ORDER BY u.id ASC
    `).all();
  },

  createUser({ full_name, username, password, role_id, status = 'active' }) {
    if (!full_name || !username || !password) {
      throw new Error('Full Name, Username, and Password are required.');
    }
    const cleanUser = username.trim();
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND is_deleted = 0').get(cleanUser);
    if (existing) {
      throw new Error(`Username "${cleanUser}" is already taken.`);
    }

    const now = new Date().toISOString();
    const passHash = hashPassword(password);
    const result = db.prepare(`
      INSERT INTO users (name, full_name, username, password_hash, role_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(full_name.trim(), full_name.trim(), cleanUser, passHash, role_id || null, status, now, now);

    const newUserId = result.lastInsertRowid;
    if (role_id) {
      db.prepare('INSERT OR REPLACE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(newUserId, role_id);
    }

    return db.prepare(`
      SELECT u.id, COALESCE(u.full_name, u.name) as full_name, u.username, u.role_id, u.status,
             COALESCE(r.name, 'Staff') as role_name, COALESCE(r.slug, 'staff') as role_slug
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `).get(newUserId);
  },

  completeInstallation(setupPayload) {
    const tx = db.transaction(() => {
      const now = new Date().toISOString();
      const allModules = db.prepare('SELECT id, slug FROM modules').all();
      const moduleMap = {};
      allModules.forEach(m => { moduleMap[m.slug] = m.id; });

      const getOrResolveRoleId = (roleIdentifier) => {
        if (typeof roleIdentifier === 'number') return roleIdentifier;
        if (!roleIdentifier) return 1;
        const normalized = String(roleIdentifier).toLowerCase().trim();
        let role = db.prepare('SELECT id FROM roles WHERE slug = ? OR lower(name) = ?').get(normalized, normalized);
        if (role) return role.id;
        const displayName = normalized.charAt(0).toUpperCase() + normalized.slice(1);
        const insertRole = db.prepare('INSERT INTO roles (name, slug, permissions, default_modules, status, is_system) VALUES (?, ?, ?, ?, ?, ?)');
        const id = insertRole.run(displayName, normalized, JSON.stringify(['view_patients']), JSON.stringify(['dashboard']), 'active', 0).lastInsertRowid;
        return id;
      };

      const createdUserIds = [];

      // Modern dynamic multi-user format: setupPayload.users = [ { full_name, username, password, role_id, role_slug, modules, status } ]
      if (Array.isArray(setupPayload.users) && setupPayload.users.length > 0) {
        for (const u of setupPayload.users) {
          if (!u.username || !u.username.trim() || !u.password) continue;
          const uName = u.username.trim();
          const fullName = (u.full_name || u.name || uName).trim();
          const passHash = hashPassword(u.password);
          const roleId = getOrResolveRoleId(u.role_id || u.role_slug || u.role);
          const status = u.status || 'active';

          let existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(uName);
          let userId;
          if (existingUser) {
            db.prepare(`
              UPDATE users
              SET name = ?, full_name = ?, password_hash = ?, role_id = ?, status = ?, updated_at = ?
              WHERE id = ?
            `).run(fullName, fullName, passHash, roleId, status, now, existingUser.id);
            userId = existingUser.id;
          } else {
            const res = db.prepare(`
              INSERT INTO users (name, full_name, username, password_hash, role_id, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(fullName, fullName, uName, passHash, roleId, status, now, now);
            userId = res.lastInsertRowid;
          }

          db.prepare('INSERT OR REPLACE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, roleId);
          db.prepare('DELETE FROM user_module_permissions WHERE user_id = ?').run(userId);

          const userMods = Array.isArray(u.modules) ? u.modules : [];
          const insertPerm = db.prepare(`
            INSERT INTO user_module_permissions (user_id, module_id, can_view, can_create, can_edit, can_delete)
            VALUES (?, ?, 1, 1, 1, 1)
          `);
          for (const modSlug of userMods) {
            if (moduleMap[modSlug]) {
              insertPerm.run(userId, moduleMap[modSlug]);
            }
          }
          createdUserIds.push(userId);
        }
      } else if (setupPayload.doctor && setupPayload.receptionist) {
        // Backward compatibility fallback for legacy test cases
        const docRoleId = getOrResolveRoleId('doctor');
        const recRoleId = getOrResolveRoleId('receptionist');

        // 1. Doctor
        let docUser = db.prepare('SELECT id FROM users WHERE username = ?').get(setupPayload.doctor.username);
        let docId;
        const docHash = hashPassword(setupPayload.doctor.password);
        const docName = setupPayload.doctor.name || setupPayload.doctor.full_name || 'Doctor';
        if (docUser) {
          db.prepare('UPDATE users SET name = ?, full_name = ?, password_hash = ?, role_id = ?, status = ?, updated_at = ? WHERE id = ?')
            .run(docName, docName, docHash, docRoleId, 'active', now, docUser.id);
          docId = docUser.id;
        } else {
          const res = db.prepare('INSERT INTO users (name, full_name, username, password_hash, role_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(docName, docName, setupPayload.doctor.username, docHash, docRoleId, 'active', now, now);
          docId = res.lastInsertRowid;
        }
        db.prepare('INSERT OR REPLACE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(docId, docRoleId);
        db.prepare('DELETE FROM user_module_permissions WHERE user_id = ?').run(docId);
        const docMods = setupPayload.doctorModules || ['dashboard', 'appointments', 'consultations', 'patient_registry', 'pharmacy', 'financial_reports'];
        const insertPerm = db.prepare('INSERT INTO user_module_permissions (user_id, module_id, can_view, can_create, can_edit, can_delete) VALUES (?, ?, 1, 1, 1, 1)');
        for (const slug of docMods) {
          if (moduleMap[slug]) insertPerm.run(docId, moduleMap[slug]);
        }
        createdUserIds.push(docId);

        // 2. Receptionist
        let recUser = db.prepare('SELECT id FROM users WHERE username = ?').get(setupPayload.receptionist.username);
        let recId;
        const recHash = hashPassword(setupPayload.receptionist.password);
        const recName = setupPayload.receptionist.name || setupPayload.receptionist.full_name || 'Receptionist';
        if (recUser) {
          db.prepare('UPDATE users SET name = ?, full_name = ?, password_hash = ?, role_id = ?, status = ?, updated_at = ? WHERE id = ?')
            .run(recName, recName, recHash, recRoleId, 'active', now, recUser.id);
          recId = recUser.id;
        } else {
          const res = db.prepare('INSERT INTO users (name, full_name, username, password_hash, role_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(recName, recName, setupPayload.receptionist.username, recHash, recRoleId, 'active', now, now);
          recId = res.lastInsertRowid;
        }
        db.prepare('INSERT OR REPLACE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(recId, recRoleId);
        db.prepare('DELETE FROM user_module_permissions WHERE user_id = ?').run(recId);
        const recMods = setupPayload.receptionistModules || ['dashboard', 'appointments', 'patient_registry'];
        for (const slug of recMods) {
          if (moduleMap[slug]) insertPerm.run(recId, moduleMap[slug]);
        }
        createdUserIds.push(recId);

        // 3. Pharmacist (if provided in payload)
        if (setupPayload.pharmacist && setupPayload.pharmacist.username) {
          const pharmRoleId = getOrResolveRoleId('pharmacist');
          let pharmUser = db.prepare('SELECT id FROM users WHERE username = ?').get(setupPayload.pharmacist.username);
          let pharmId;
          const pharmHash = hashPassword(setupPayload.pharmacist.password);
          const pharmName = setupPayload.pharmacist.name || setupPayload.pharmacist.full_name || 'Pharmacist';
          if (pharmUser) {
            db.prepare('UPDATE users SET name = ?, full_name = ?, password_hash = ?, role_id = ?, status = ?, updated_at = ? WHERE id = ?')
              .run(pharmName, pharmName, pharmHash, pharmRoleId, 'active', now, pharmUser.id);
            pharmId = pharmUser.id;
          } else {
            const res = db.prepare('INSERT INTO users (name, full_name, username, password_hash, role_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
              .run(pharmName, pharmName, setupPayload.pharmacist.username, pharmHash, pharmRoleId, 'active', now, now);
            pharmId = res.lastInsertRowid;
          }
          db.prepare('INSERT OR REPLACE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(pharmId, pharmRoleId);
          db.prepare('DELETE FROM user_module_permissions WHERE user_id = ?').run(pharmId);
          const pharmMods = setupPayload.pharmacistModules || ['dashboard', 'pharmacy'];
          for (const slug of pharmMods) {
            if (moduleMap[slug]) insertPerm.run(pharmId, moduleMap[slug]);
          }
          createdUserIds.push(pharmId);
        }
      }

      // Mark installation completed
      db.prepare("INSERT OR REPLACE INTO sync_settings (key, value) VALUES ('installation_completed', 'true')").run();

      return { success: true, createdUserIds };
    });

    return tx();
  },

  // Auth
  loginUser(username, password) {
    if (!username || !password) return null;
    const user = db.prepare(`
      SELECT u.id, u.username, COALESCE(u.full_name, u.name) as name, u.full_name, u.password_hash, u.status,
             COALESCE(r.name, 'Staff') as role_name,
             COALESCE(r.slug, 'staff') as role_slug,
             COALESCE(r.permissions, '[]') as permissions
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE (u.username = ? OR lower(u.username) = lower(?)) AND u.is_deleted = 0 AND (u.status IS NULL OR u.status = 'active')
    `).get(username.trim(), username.trim());

    if (!user) return null;

    const hash = hashPassword(password);
    if (user.password_hash !== hash) return null;

    const userModules = dbOps.getUserModules(user.id);
    const token = crypto.randomBytes(24).toString('hex');

    return {
      token,
      id: user.id,
      username: user.username,
      name: user.full_name || user.name,
      full_name: user.full_name || user.name,
      role: user.role_name,
      role_slug: user.role_slug,
      roles: [user.role_name],
      permissions: JSON.parse(user.permissions || '[]'),
      modules: userModules.map(m => m.slug)
    };
  },

  // Patients
  getPatients() {
    return db.prepare('SELECT * FROM patients WHERE deleted = 0 AND is_deleted = 0 ORDER BY created_at DESC').all();
  },

  getPatient(idOrUid) {
    return db.prepare('SELECT * FROM patients WHERE (id = ? OR uid = ?) AND deleted = 0 AND is_deleted = 0').get(idOrUid, idOrUid);
  },

  createPatient(patient) {
    const uid = patient.uid || crypto.randomUUID();
    let nextId = patient.id;
    if (!nextId) {
      const lastPatient = db.prepare("SELECT id FROM patients WHERE id LIKE 'SL-PT-%' ORDER BY id DESC LIMIT 1").get();
      let num = 1;
      if (lastPatient && lastPatient.id && lastPatient.id.startsWith('SL-PT-')) {
        const parts = lastPatient.id.split('-');
        num = (parseInt(parts[2], 10) || 0) + 1;
      }
      nextId = `SL-PT-${String(num).padStart(4, '0')}`;
    }

    const fullName = patient.full_name || patient.name || 'Unnamed Patient';
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO patients (
        id, uid, name, full_name, nic, phone, email, emergency_contact, dob, notes, age, gender, address, medical_history, files, deleted, created_at, updated_at, is_dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)
    `).run(
      nextId,
      uid,
      fullName,
      fullName,
      patient.nic || null,
      patient.phone || null,
      patient.email || null,
      patient.emergency_contact || null,
      patient.dob || null,
      patient.notes || null,
      patient.age || null,
      patient.gender || null,
      patient.address || null,
      patient.medical_history || null,
      patient.files || '[]',
      now,
      now
    );

    const createdRecord = db.prepare('SELECT * FROM patients WHERE id = ?').get(nextId);
    dbOps.addSyncLog('patients', nextId, 'INSERT', createdRecord);

    return nextId;
  },

  updatePatient(idOrUid, patient) {
    const now = new Date().toISOString();
    const fullName = patient.full_name || patient.name;
    
    db.prepare(`
      UPDATE patients
      SET name = COALESCE(?, name),
          full_name = COALESCE(?, full_name, name),
          nic = COALESCE(?, nic),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          emergency_contact = COALESCE(?, emergency_contact),
          dob = COALESCE(?, dob),
          notes = COALESCE(?, notes),
          age = COALESCE(?, age),
          gender = COALESCE(?, gender),
          address = COALESCE(?, address),
          medical_history = COALESCE(?, medical_history),
          files = COALESCE(?, files),
          updated_at = ?,
          is_dirty = 1
      WHERE id = ? OR uid = ?
    `).run(
      fullName,
      fullName,
      patient.nic,
      patient.phone,
      patient.email,
      patient.emergency_contact,
      patient.dob,
      patient.notes,
      patient.age,
      patient.gender,
      patient.address,
      patient.medical_history,
      patient.files,
      now,
      idOrUid,
      idOrUid
    );

    const updatedRecord = db.prepare('SELECT * FROM patients WHERE id = ? OR uid = ?').get(idOrUid, idOrUid);
    if (updatedRecord) {
      dbOps.addSyncLog('patients', updatedRecord.id, 'UPDATE', updatedRecord);
    }
    return true;
  },

  // Appointments (v1 Sync resource)
  getAppointments(date = null) {
    let query = `
      SELECT a.*, 
             COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), 'Patient ' || SUBSTR(a.patient_uid, 1, 8)) as patient_name, 
             COALESCE(p.phone, '') as patient_phone, 
             COALESCE(p.nic, '') as patient_nic, 
             COALESCE(p.dob, '') as patient_dob
      FROM appointments a
      LEFT JOIN patients p ON (TRIM(a.patient_uid) = TRIM(p.uid) OR TRIM(a.patient_uid) = TRIM(p.id))
      WHERE a.deleted = 0
    `;
    const params = [];
    if (date) {
      query += ` AND a.appt_date = ?`;
      params.push(date);
    }
    query += ` ORDER BY a.queue_number ASC, a.created_at ASC`;
    return db.prepare(query).all(...params);
  },

  getAppointment(uid) {
    return db.prepare(`
      SELECT a.*, 
             COALESCE(NULLIF(p.full_name, ''), NULLIF(p.name, ''), 'Patient ' || SUBSTR(a.patient_uid, 1, 8)) as patient_name, 
             COALESCE(p.phone, '') as patient_phone, 
             COALESCE(p.nic, '') as patient_nic
      FROM appointments a
      LEFT JOIN patients p ON (TRIM(a.patient_uid) = TRIM(p.uid) OR TRIM(a.patient_uid) = TRIM(p.id))
      WHERE a.uid = ?
    `).get(uid);
  },

  createAppointment(appointment) {
    const uid = appointment.uid || crypto.randomUUID();
    const now = new Date().toISOString();
    const apptDate = appointment.appt_date || now.split('T')[0];

    const pt = db.prepare('SELECT uid, id FROM patients WHERE uid = ? OR id = ?').get(appointment.patient_uid, appointment.patient_uid);
    const resolvedPatientUid = pt ? pt.uid : appointment.patient_uid;

    // Auto calculate next queue number for apptDate
    let queueNum = appointment.queue_number;
    if (!queueNum) {
      const maxQ = db.prepare('SELECT MAX(queue_number) as max_val FROM appointments WHERE appt_date = ? AND deleted = 0').get(apptDate);
      queueNum = (maxQ && maxQ.max_val ? maxQ.max_val : 0) + 1;
    }

    const ref = appointment.reference || `DSK-${Date.now().toString(36).toUpperCase()}`;

    db.prepare(`
      INSERT INTO appointments (
        uid, patient_uid, appt_date, queue_number, status, source, reference, notes, deleted, created_at, updated_at, is_dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1)
    `).run(
      uid,
      resolvedPatientUid,
      apptDate,
      queueNum,
      appointment.status || 'booked',
      appointment.source || 'desk',
      ref,
      appointment.notes || null,
      now,
      now
    );

    return dbOps.getAppointment(uid);
  },

  updateAppointmentStatus(uid, status) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE appointments 
      SET status = ?, updated_at = ?, is_dirty = 1 
      WHERE uid = ?
    `).run(status, now, uid);
    return true;
  },

  deleteAppointment(uid) {
    const now = new Date().toISOString();
    db.prepare('UPDATE appointments SET deleted = 1, deleted_at = ?, updated_at = ?, is_dirty = 1 WHERE uid = ?').run(now, now, uid);
    return true;
  },

  deletePatient(idOrUid) {
    const now = new Date().toISOString();
    db.prepare('UPDATE patients SET deleted = 1, is_deleted = 1, deleted_at = ?, updated_at = ?, is_dirty = 1 WHERE id = ? OR uid = ?').run(now, now, idOrUid, idOrUid);
    db.prepare('DELETE FROM queue WHERE patient_id = ? OR patient_id = ?').run(idOrUid, idOrUid);
    return true;
  },

  // Queue waiting room
  getQueue() {
    return db.prepare(`
      SELECT q.*, COALESCE(p.full_name, p.name) as patient_name, p.phone as patient_phone, p.age as patient_age, p.gender as patient_gender
      FROM queue q
      JOIN patients p ON q.patient_id = p.id OR q.patient_id = p.uid
      ORDER BY q.queue_number ASC
    `).all();
  },

  addToQueue(patientId) {
    const exists = db.prepare('SELECT * FROM queue WHERE patient_id = ?').get(patientId);
    if (exists) {
      return exists.queue_number;
    }

    const maxVal = db.prepare('SELECT MAX(queue_number) as max_val FROM queue').get().max_val || 0;
    const nextQueueNum = maxVal + 1;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO queue (patient_id, queue_number, status, created_at, updated_at)
      VALUES (?, ?, 'waiting', ?, ?)
    `).run(patientId, nextQueueNum, now, now);

    const queueRow = db.prepare('SELECT * FROM queue WHERE patient_id = ?').get(patientId);
    dbOps.addSyncLog('queue', patientId, 'INSERT', queueRow);

    return nextQueueNum;
  },

  updateQueueStatus(patientId, status) {
    const now = new Date().toISOString();
    
    if (status === 'no_show') {
      const maxVal = db.prepare('SELECT MAX(queue_number) as max_val FROM queue').get().max_val || 0;
      const nextQueueNum = maxVal + 1;

      db.prepare(`
        UPDATE queue
        SET status = ?, queue_number = ?, updated_at = ?
        WHERE patient_id = ?
      `).run(status, nextQueueNum, now, patientId);
    } else if (status === 'done') {
      db.prepare('DELETE FROM queue WHERE patient_id = ?').run(patientId);
      dbOps.addSyncLog('queue', patientId, 'DELETE', { patient_id: patientId });
      return true;
    } else {
      db.prepare(`
        UPDATE queue
        SET status = ?, updated_at = ?
        WHERE patient_id = ?
      `).run(status, now, patientId);
    }

    const queueRow = db.prepare('SELECT * FROM queue WHERE patient_id = ?').get(patientId);
    if (queueRow) {
      dbOps.addSyncLog('queue', patientId, 'UPDATE', queueRow);
    }
    return true;
  },

  // Consultations
  getConsultations(patientId) {
    let sql = `
      SELECT c.*, 
             COALESCE(u.name, 'Doctor') as doctor_name,
             p.name as patient_name,
             COALESCE(c.prescription_items, pr.items) as prescription_items
      FROM consultations c
      LEFT JOIN users u ON c.doctor_id = u.id
      LEFT JOIN patients p ON c.patient_id = p.id
      LEFT JOIN prescriptions pr ON c.prescription_id = pr.id
    `;
    if (patientId) {
      sql += ' WHERE c.patient_id = ? ORDER BY c.consultation_date DESC, c.id DESC';
      return db.prepare(sql).all(patientId);
    } else {
      sql += ' ORDER BY c.consultation_date DESC, c.id DESC';
      return db.prepare(sql).all();
    }
  },

  createConsultation(consultation) {
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO consultations (
        patient_id, doctor_id, consultation_date, symptoms, diagnosis, notes, doctor_fee, prescription_id, prescription_items, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      consultation.patient_id,
      consultation.doctor_id || null,
      consultation.consultation_date || now,
      consultation.symptoms || null,
      consultation.diagnosis || null,
      consultation.notes || null,
      consultation.doctor_fee || 0,
      consultation.prescription_id || null,
      consultation.prescription_items ? (typeof consultation.prescription_items === 'string' ? consultation.prescription_items : JSON.stringify(consultation.prescription_items)) : null,
      now,
      now
    );
    return { id: result.lastInsertRowid };
  },

  // Inventory
  getInventory() {
    return db.prepare('SELECT * FROM inventory WHERE is_deleted = 0 ORDER BY name ASC').all();
  },

  searchInventory(query) {
    if (!query || query.trim() === '') {
      return db.prepare('SELECT * FROM inventory WHERE is_deleted = 0 ORDER BY name ASC LIMIT 50').all();
    }
    const q = `%${query.trim()}%`;
    return db.prepare(`
      SELECT * FROM inventory 
      WHERE is_deleted = 0 AND (name LIKE ? OR code LIKE ? OR category LIKE ?)
      ORDER BY name ASC LIMIT 50
    `).all(q, q, q);
  },

  updateInventoryItem(id, item) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE inventory
      SET name = ?, quantity = ?, cost_price = ?, selling_price = ?,
          code = COALESCE(?, code),
          category = COALESCE(?, category),
          dosage_form = COALESCE(?, dosage_form),
          min_stock_level = COALESCE(?, min_stock_level, 10),
          expiry_date = COALESCE(?, expiry_date),
          updated_at = ?
      WHERE id = ?
    `).run(
      item.name,
      item.quantity,
      item.cost_price,
      item.selling_price,
      item.code || null,
      item.category || null,
      item.dosage_form || null,
      item.min_stock_level || 10,
      item.expiry_date || null,
      now,
      id
    );

    const updatedRecord = db.prepare('SELECT * FROM inventory WHERE id = ?').get(id);
    dbOps.addSyncLog('inventory', String(id), 'UPDATE', updatedRecord);
    return true;
  },

  createInventoryItem(item) {
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO inventory (name, code, category, dosage_form, quantity, min_stock_level, cost_price, selling_price, expiry_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.name,
      item.code || null,
      item.category || 'General',
      item.dosage_form || 'Tablet',
      item.quantity || 0,
      item.min_stock_level || 10,
      item.cost_price || 0,
      item.selling_price || 0,
      item.expiry_date || null,
      now,
      now
    );

    const newId = result.lastInsertRowid;
    const createdRecord = db.prepare('SELECT * FROM inventory WHERE id = ?').get(newId);
    dbOps.addSyncLog('inventory', String(newId), 'INSERT', createdRecord);
    return newId;
  },

  getInventoryLowStock() {
    return db.prepare(`
      SELECT * FROM inventory 
      WHERE is_deleted = 0 AND quantity <= COALESCE(min_stock_level, 10)
      ORDER BY quantity ASC
    `).all();
  },

  adjustInventoryStock(id, newQuantity, reason = 'Adjustment') {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE inventory
      SET quantity = ?, updated_at = ?
      WHERE id = ?
    `).run(Number(newQuantity), now, id);

    const updatedRecord = db.prepare('SELECT * FROM inventory WHERE id = ?').get(id);
    if (updatedRecord) {
      dbOps.addSyncLog('inventory', String(id), 'UPDATE', updatedRecord);
    }
    return updatedRecord;
  },

  // Prescriptions
  getPrescriptionHistory(patientId) {
    if (!patientId) return [];
    return db.prepare('SELECT * FROM prescriptions WHERE patient_id = ? AND is_deleted = 0 ORDER BY created_at DESC').all(patientId);
  },

  getRecentPrescriptions(limit = 10) {
    return db.prepare(`
      SELECT pr.*, 
             COALESCE(p.full_name, p.name, 'Patient ' || pr.patient_id) as patient_name,
             p.phone as patient_phone,
             COALESCE(u.name, 'Doctor') as doctor_name
      FROM prescriptions pr
      LEFT JOIN patients p ON (pr.patient_id = p.id OR pr.patient_id = p.uid)
      LEFT JOIN users u ON pr.doctor_id = u.id
      WHERE pr.is_deleted = 0
      ORDER BY pr.created_at DESC
      LIMIT ?
    `).all(limit);
  },

  getRecentPatients(limit = 10) {
    return db.prepare(`
      SELECT * FROM patients 
      WHERE deleted = 0 AND is_deleted = 0 
      ORDER BY updated_at DESC, created_at DESC 
      LIMIT ?
    `).all(limit);
  },

  createPrescription(prescription) {
    const now = new Date().toISOString();
    const rxStatus = prescription.status || 'prescribed';
    const result = db.prepare(`
      INSERT INTO prescriptions (patient_id, doctor_id, consultation_id, items, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      prescription.patient_id,
      prescription.doctor_id || null,
      prescription.consultation_id || null,
      JSON.stringify(prescription.items),
      rxStatus,
      prescription.notes || null,
      now,
      now
    );

    const newId = result.lastInsertRowid;
    const createdRecord = db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(newId);
    dbOps.addSyncLog('prescriptions', String(newId), 'INSERT', createdRecord);
    return { id: newId };
  },

  updatePrescription(id, prescription) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE prescriptions
      SET items = ?, status = COALESCE(?, status), notes = COALESCE(?, notes), updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(prescription.items), prescription.status || null, prescription.notes || null, now, id);

    const updatedRecord = db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(id);
    dbOps.addSyncLog('prescriptions', String(id), 'UPDATE', updatedRecord);
    return true;
  },

  updatePrescriptionStatus(id, status) {
    const now = new Date().toISOString();
    db.prepare('UPDATE prescriptions SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    const updatedRecord = db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(id);
    if (updatedRecord) {
      dbOps.addSyncLog('prescriptions', String(id), 'UPDATE', updatedRecord);
    }
    return updatedRecord;
  },

  // Dispense logic (atomic transaction)
  dispensePrescription(prescriptionId, dispenseItems, doctorFee, patientId) {
    const dispenseTx = db.transaction(() => {
      // Check for duplicate dispensing
      if (prescriptionId) {
        const existingRx = db.prepare('SELECT id, status FROM prescriptions WHERE id = ?').get(prescriptionId);
        if (existingRx && existingRx.status === 'dispensed') {
          throw new Error('This prescription has already been dispensed.');
        }
      }

      let totalAmount = 0;
      let totalCost = 0;

      for (const item of dispenseItems) {
        const { medicine_id, is_custom, quantity_to_dispense, selling_price = 0, name = '' } = item;
        const qty = Number(quantity_to_dispense) || 0;
        if (qty <= 0) continue;

        // Custom medication handling: does NOT reduce pharmacy stock
        if (is_custom || !medicine_id || medicine_id === 'custom') {
          const sPrice = Number(selling_price) || 0;
          const itemTotal = sPrice * qty;
          totalAmount += itemTotal;

          if (itemTotal > 0) {
            const now = new Date().toISOString();
            const saleResult = db.prepare(`
              INSERT INTO sales (patient_id, type, item_ref, quantity, unit_cost, unit_price, amount, profit, created_at)
              VALUES (?, 'medicine', NULL, ?, 0, ?, ?, ?, ?)
            `).run(patientId, qty, sPrice, itemTotal, itemTotal, now);

            dbOps.addSyncLog('sales', String(saleResult.lastInsertRowid), 'INSERT', {
              transaction_id: saleResult.lastInsertRowid,
              patient_id: patientId,
              type: 'medicine',
              item_ref: null,
              quantity: qty,
              unit_cost: 0,
              unit_price: sPrice,
              amount: itemTotal,
              profit: itemTotal,
              created_at: now
            });
          }
          continue;
        }

        // Standard Pharmacy medication
        const inventoryRow = db.prepare('SELECT * FROM inventory WHERE id = ?').get(medicine_id);
        if (!inventoryRow) {
          throw new Error(`Medicine not found in inventory: ${name || medicine_id}`);
        }
        if (inventoryRow.quantity < qty) {
          throw new Error(`Insufficient stock for ${inventoryRow.name}. Available: ${inventoryRow.quantity}, Requested: ${qty}`);
        }

        const newQty = inventoryRow.quantity - qty;
        const now = new Date().toISOString();
        db.prepare('UPDATE inventory SET quantity = ?, updated_at = ? WHERE id = ?').run(newQty, now, medicine_id);

        const updatedInventory = db.prepare('SELECT * FROM inventory WHERE id = ?').get(medicine_id);
        dbOps.addSyncLog('inventory', String(medicine_id), 'UPDATE', updatedInventory);

        const unitSellPrice = Number(selling_price) || inventoryRow.selling_price;
        const itemTotal = unitSellPrice * qty;
        const itemCostTotal = inventoryRow.cost_price * qty;
        const itemProfit = itemTotal - itemCostTotal;

        totalAmount += itemTotal;
        totalCost += itemCostTotal;

        const saleResult = db.prepare(`
          INSERT INTO sales (patient_id, type, item_ref, quantity, unit_cost, unit_price, amount, profit, created_at)
          VALUES (?, 'medicine', ?, ?, ?, ?, ?, ?, ?)
        `).run(patientId, medicine_id, qty, inventoryRow.cost_price, unitSellPrice, itemTotal, itemProfit, now);

        dbOps.addSyncLog('sales', String(saleResult.lastInsertRowid), 'INSERT', {
          transaction_id: saleResult.lastInsertRowid,
          patient_id: patientId,
          type: 'medicine',
          item_ref: medicine_id,
          quantity: qty,
          unit_cost: inventoryRow.cost_price,
          unit_price: unitSellPrice,
          amount: itemTotal,
          profit: itemProfit,
          created_at: now
        });
      }

      if (doctorFee && Number(doctorFee) > 0) {
        const fee = Number(doctorFee);
        const now = new Date().toISOString();
        const saleResult = db.prepare(`
          INSERT INTO sales (patient_id, type, item_ref, quantity, unit_cost, unit_price, amount, profit, created_at)
          VALUES (?, 'doctor_fee', NULL, 1, 0, ?, ?, ?, ?)
        `).run(patientId, fee, fee, fee, now);

        dbOps.addSyncLog('sales', String(saleResult.lastInsertRowid), 'INSERT', {
          transaction_id: saleResult.lastInsertRowid,
          patient_id: patientId,
          type: 'doctor_fee',
          item_ref: null,
          quantity: 1,
          unit_cost: 0,
          unit_price: fee,
          amount: fee,
          profit: fee,
          created_at: now
        });

        totalAmount += fee;
      }

      if (prescriptionId) {
        const now = new Date().toISOString();
        db.prepare("UPDATE prescriptions SET status = 'dispensed', updated_at = ? WHERE id = ?").run(now, prescriptionId);
        const updatedRxRecord = db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(prescriptionId);
        dbOps.addSyncLog('prescriptions', String(prescriptionId), 'UPDATE', updatedRxRecord);
      }

      if (patientId) {
        db.prepare('DELETE FROM queue WHERE patient_id = ?').run(patientId);
        dbOps.addSyncLog('queue', patientId, 'DELETE', { patient_id: patientId });
      }

      return { success: true, totalAmount, totalProfit: totalAmount - totalCost };
    });

    return dispenseTx();
  },

  // Reports
  getSalesReport(startDate, endDate) {
    return db.prepare(`
      SELECT s.*, i.name as medicine_name, COALESCE(p.full_name, p.name) as patient_name
      FROM sales s
      LEFT JOIN inventory i ON s.item_ref = i.id
      LEFT JOIN patients p ON s.patient_id = p.id OR s.patient_id = p.uid
      WHERE date(s.created_at) >= date(?) AND date(s.created_at) <= date(?)
      ORDER BY s.created_at DESC
    `).all(startDate, endDate);
  },

  getProfitSummary(startDate, endDate) {
    const summary = db.prepare(`
      SELECT 
        SUM(CASE WHEN type = 'medicine' THEN amount ELSE 0 END) as medicine_revenue,
        SUM(CASE WHEN type = 'medicine' THEN profit ELSE 0 END) as medicine_profit,
        SUM(CASE WHEN type = 'doctor_fee' THEN amount ELSE 0 END) as doctor_fee_revenue,
        SUM(CASE WHEN type = 'doctor_fee' THEN profit ELSE 0 END) as doctor_fee_profit,
        SUM(amount) as total_revenue,
        SUM(profit) as total_profit
      FROM sales
      WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
    `).get(startDate, endDate);

    const patientsCount = db.prepare(`
      SELECT COUNT(DISTINCT patient_id) as count
      FROM sales
      WHERE date(created_at) >= date(?) AND date(created_at) <= date(?) AND patient_id IS NOT NULL
    `).get(startDate, endDate).count;

    const remainingQueue = db.prepare(`
      SELECT COUNT(*) as count FROM queue
    `).get().count;

    return {
      medicine_revenue: summary.medicine_revenue || 0,
      medicine_profit: summary.medicine_profit || 0,
      doctor_fee_revenue: summary.doctor_fee_revenue || 0,
      doctor_fee_profit: summary.doctor_fee_profit || 0,
      total_revenue: summary.total_revenue || 0,
      total_profit: summary.total_profit || 0,
      patients_seen: patientsCount || 0,
      remaining_appointments: remainingQueue || 0
    };
  },

  // ==========================================
  // SYNC V1 (Cloudflare Workers Sync Protocol)
  // ==========================================

  // Settings
  getSyncSettings() {
    const rows = db.prepare('SELECT key, value FROM sync_settings').all();
    const settings = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    return settings;
  },

  setSyncSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO sync_settings (key, value) VALUES (?, ?)').run(key, String(value || ''));
  },

  saveSyncSettings(settings) {
    const stmt = db.prepare('INSERT OR REPLACE INTO sync_settings (key, value) VALUES (?, ?)');
    const tx = db.transaction(() => {
      for (const [k, v] of Object.entries(settings)) {
        if (v !== undefined) stmt.run(k, String(v));
      }
    });
    tx();
  },

  // Sync state tracking (keyset pagination)
  getSyncState(resource) {
    const row = db.prepare('SELECT * FROM sync_state WHERE resource = ?').get(resource);
    return row ? {
      resource: row.resource,
      last_since: row.last_since || '0',
      last_cursor: row.last_cursor || 0,
      last_synced_at: row.last_synced_at || null
    } : {
      resource,
      last_since: '0',
      last_cursor: 0,
      last_synced_at: null
    };
  },

  saveSyncState(resource, since, cursor, lastSyncedAt = null) {
    const now = lastSyncedAt || new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO sync_state (resource, last_since, last_cursor, last_synced_at)
      VALUES (?, ?, ?, ?)
    `).run(resource, String(since || '0'), Number(cursor || 0), now);
  },

  // Dirty rows retrieval for Push
  getDirtyRows(resource, limit = 500) {
    if (resource === 'patients') {
      const rows = db.prepare(`
        SELECT uid, COALESCE(full_name, name) as full_name, nic, phone, dob, notes, deleted, updated_at
        FROM patients
        WHERE is_dirty = 1
        ORDER BY updated_at ASC
        LIMIT ?
      `).all(limit);

      return rows.map(r => ({
        uid: r.uid,
        full_name: r.full_name || 'Unnamed Patient',
        nic: r.nic || null,
        phone: r.phone || null,
        dob: r.dob || null,
        notes: r.notes || null,
        deleted: Boolean(r.deleted),
        updated_at: r.updated_at
      }));
    }

    if (resource === 'appointments') {
      const rows = db.prepare(`
        SELECT uid, patient_uid, appt_date, queue_number, status, source, reference, notes, deleted, updated_at
        FROM appointments
        WHERE is_dirty = 1
        ORDER BY updated_at ASC
        LIMIT ?
      `).all(limit);

      return rows.map(r => ({
        uid: r.uid,
        patient_uid: r.patient_uid,
        appt_date: r.appt_date,
        queue_number: Number(r.queue_number),
        status: r.status,
        source: r.source,
        reference: r.reference || null,
        notes: r.notes || null,
        deleted: Boolean(r.deleted),
        updated_at: r.updated_at
      }));
    }

    return [];
  },

  // Mark clean after successful push outcome (applied / skipped)
  markClean(resource, uid) {
    if (resource === 'patients') {
      db.prepare('UPDATE patients SET is_dirty = 0 WHERE uid = ?').run(uid);
    } else if (resource === 'appointments') {
      db.prepare('UPDATE appointments SET is_dirty = 0 WHERE uid = ?').run(uid);
    }
  },

  // Handle 'adjusted' push outcome
  applyAdjustmentsAndMarkClean(resource, uid, changes) {
    if (resource === 'appointments' && changes) {
      const sets = ['is_dirty = 0'];
      const vals = [];

      if (changes.queue_number !== undefined) {
        sets.push('queue_number = ?');
        vals.push(Number(changes.queue_number));
      }
      if (changes.reference !== undefined) {
        sets.push('reference = ?');
        vals.push(changes.reference);
      }
      vals.push(uid);

      db.prepare(`UPDATE appointments SET ${sets.join(', ')} WHERE uid = ?`).run(...vals);
    } else {
      dbOps.markClean(resource, uid);
    }
  },

  // Apply pulled rows from Cloud
  upsertSyncPatient(row) {
    const now = new Date().toISOString();
    const fullName = (row.full_name || row.name || 'Unnamed Patient').trim();
    const phone = row.phone ? String(row.phone).trim() : null;
    const nic = row.nic ? String(row.nic).trim() : null;
    const dob = row.dob ? String(row.dob).trim() : null;
    const notes = row.notes ? String(row.notes).trim() : null;
    const uid = String(row.uid).trim();

    const existing = db.prepare('SELECT id, uid FROM patients WHERE uid = ? OR id = ?').get(uid, uid);
    const localId = existing ? existing.id : (row.id || uid);

    db.prepare(`
      INSERT INTO patients (
        id, uid, name, full_name, nic, phone, dob, notes, deleted, created_at, updated_at, deleted_at, is_dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        uid = excluded.uid,
        name = excluded.full_name,
        full_name = excluded.full_name,
        nic = excluded.nic,
        phone = excluded.phone,
        dob = excluded.dob,
        notes = excluded.notes,
        deleted = excluded.deleted,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        is_dirty = 0
    `).run(
      localId,
      uid,
      fullName,
      fullName,
      nic,
      phone,
      dob,
      notes,
      row.deleted ? 1 : 0,
      row.created_at || now,
      row.updated_at || now,
      row.deleted_at || null
    );
  },

  upsertSyncAppointment(row) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO appointments (
        uid, patient_uid, appt_date, queue_number, status, source, reference, notes, deleted, created_at, updated_at, deleted_at, is_dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(uid) DO UPDATE SET
        patient_uid = excluded.patient_uid,
        appt_date = excluded.appt_date,
        queue_number = excluded.queue_number,
        status = excluded.status,
        source = excluded.source,
        reference = excluded.reference,
        notes = excluded.notes,
        deleted = excluded.deleted,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        is_dirty = 0
    `).run(
      row.uid,
      row.patient_uid,
      row.appt_date,
      Number(row.queue_number),
      row.status,
      row.source,
      row.reference || null,
      row.notes || null,
      row.deleted ? 1 : 0,
      row.created_at || now,
      row.updated_at || now,
      row.deleted_at || null
    );
  },

  // Legacy sync helpers (preserved for local server simulation)
  addSyncLog(tableName, rowId, action, payload) {
    try {
      db.prepare(`
        INSERT INTO sync_log (table_name, row_id, action, payload, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(tableName, String(rowId), action, JSON.stringify(payload), new Date().toISOString());
    } catch (e) {}
  },

  getUnsyncedLogs() {
    return db.prepare('SELECT * FROM sync_log ORDER BY id ASC').all();
  },

  removeSyncLogs(ids) {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM sync_log WHERE id IN (${placeholders})`).run(...ids);
  },

  getLastSyncedAt() {
    const row = db.prepare("SELECT value FROM sync_meta WHERE key = 'last_synced_at'").get();
    return row ? row.value : '1970-01-01T00:00:00.000Z';
  },

  setLastSyncedAt(timestamp) {
    db.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_synced_at', ?)").run(timestamp);
  },

  applyServerChanges(changes) {
    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      for (const change of changes) {
        const { table_name, row_id, action, payload } = change;
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload;

        if (action === 'DELETE') {
          if (table_name === 'queue') {
            db.prepare('DELETE FROM queue WHERE patient_id = ?').run(row_id);
          } else {
            db.prepare(`UPDATE ${table_name} SET is_deleted = 1, updated_at = ? WHERE id = ?`).run(now, row_id);
          }
        } else {
          if (table_name === 'patients') {
            db.prepare(`
              INSERT OR REPLACE INTO patients (id, name, phone, age, gender, address, medical_history, files, created_at, updated_at, is_deleted)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(data.id, data.name, data.phone, data.age, data.gender, data.address, data.medical_history, data.files, data.created_at, data.updated_at, data.is_deleted);
          } else if (table_name === 'inventory') {
            db.prepare(`
              INSERT OR REPLACE INTO inventory (id, name, quantity, cost_price, selling_price, created_at, updated_at, is_deleted)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(data.id, data.name, data.quantity, data.cost_price, data.selling_price, data.created_at, data.updated_at, data.is_deleted);
          } else if (table_name === 'prescriptions') {
            db.prepare(`
              INSERT OR REPLACE INTO prescriptions (id, patient_id, doctor_id, items, status, created_at, updated_at, is_deleted)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(data.id, data.patient_id, data.doctor_id, data.items, data.status, data.created_at, data.updated_at, data.is_deleted);
          } else if (table_name === 'queue') {
            db.prepare(`
              INSERT OR REPLACE INTO queue (patient_id, queue_number, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
            `).run(data.patient_id, data.queue_number, data.status, data.created_at, data.updated_at);
          } else if (table_name === 'sales') {
            db.prepare(`
              INSERT OR REPLACE INTO sales (transaction_id, patient_id, type, item_ref, quantity, unit_cost, unit_price, amount, profit, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(data.transaction_id, data.patient_id, data.type, data.item_ref, data.quantity, data.unit_cost, data.unit_price, data.amount, data.profit, data.created_at);
          }
        }
      }
    });
    transaction();
  }
};

module.exports = {
  initializeDatabase,
  dbOps,
  dbFile: dbPath
};
