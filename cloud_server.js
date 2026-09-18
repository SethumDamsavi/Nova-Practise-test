const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});
app.use('/patient-files', express.static(path.join(__dirname, 'patient_files')));

const cloudDbPath = path.join(__dirname, 'cloud_clinic.db');
let db;

function ensureCloudColumn(table, column, definition) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = columns.some(c => c.name === column);
    if (!exists) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    }
  } catch (e) {}
}

function initializeCloudDatabase() {
  db = new Database(cloudDbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      uid TEXT UNIQUE,
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
      files TEXT DEFAULT '[]',
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      is_deleted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS appointments (
      uid TEXT PRIMARY KEY,
      patient_uid TEXT NOT NULL,
      appt_date TEXT NOT NULL,
      queue_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'booked',
      source TEXT NOT NULL DEFAULT 'online',
      reference TEXT,
      notes TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      quantity INTEGER NOT NULL,
      cost_price REAL NOT NULL,
      selling_price REAL NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      is_deleted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY,
      patient_id TEXT NOT NULL,
      doctor_id INTEGER,
      items TEXT NOT NULL,
      status TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_deleted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sales (
      transaction_id INTEGER PRIMARY KEY,
      patient_id TEXT,
      type TEXT NOT NULL,
      item_ref INTEGER,
      quantity INTEGER,
      unit_cost REAL,
      unit_price REAL,
      amount REAL,
      profit REAL,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS queue (
      patient_id TEXT PRIMARY KEY,
      queue_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_tombstones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      deleted_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  ensureCloudColumn('patients', 'uid', 'TEXT');
  ensureCloudColumn('patients', 'full_name', 'TEXT');
  ensureCloudColumn('patients', 'nic', 'TEXT');
  ensureCloudColumn('patients', 'dob', 'TEXT');
  ensureCloudColumn('patients', 'notes', 'TEXT');
  ensureCloudColumn('patients', 'deleted', 'INTEGER NOT NULL DEFAULT 0');
  ensureCloudColumn('patients', 'deleted_at', 'TEXT');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_cloud_pts_uid ON patients(uid);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cloud_appts_date ON appointments(appt_date);`);

  // Insert seed demo patient if empty
  const ptCount = db.prepare('SELECT COUNT(*) as count FROM patients').get().count;
  if (ptCount === 0) {
    const seedUid = '3b2e5927-2c5e-4ec2-a4f6-8c4c7cf99e52';
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO patients (id, uid, name, full_name, nic, phone, dob, notes, age, gender, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'SL-PT-0001',
      seedUid,
      'Kasun Perera',
      'Kasun Perera',
      '199212345678',
      '+94 77 123 4567',
      '1992-05-14',
      'Allergic to penicillin',
      32,
      'Male',
      now,
      now
    );

    db.prepare(`
      INSERT INTO appointments (uid, patient_uid, appt_date, queue_number, status, source, reference, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'booked', 'online', 'ONLINE-001', 'Routine checkup', ?, ?)
    `).run('7e6a2b84-18c2-4a77-9df1-8e019b88cf41', seedUid, now.split('T')[0], 1, now, now);
  }
}

// ==========================================
// V1 SYNC API ENDPOINTS (Cloudflare Protocol)
// ==========================================

// 1. Handshake
app.get('/api/sync/v1/handshake', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  res.json({
    protocol_version: 1,
    clinic_id: 1,
    clinic: {
      name: "Minimtech Clinic",
      subdomain: "minimtech",
      timezone: "Asia/Colombo"
    },
    resources: ["patients", "appointments"],
    limits: {
      max_pull_limit: 500,
      max_push_rows: 500
    },
    server_time: new Date().toISOString()
  });
});

// 2. Pull Patients (v1)
app.get('/api/sync/v1/patients', (req, res) => {
  try {
    const { since = '0', cursor = 0, limit = 200 } = req.query;
    const sinceVal = since === '0' ? '1970-01-01T00:00:00.000Z' : since;
    
    const rows = db.prepare(`
      SELECT uid, 
             COALESCE(full_name, name) as full_name, 
             nic, 
             phone, 
             dob, 
             COALESCE(notes, medical_history) as notes, 
             deleted, 
             created_at, 
             updated_at, 
             deleted_at
      FROM patients 
      WHERE updated_at >= ?
      ORDER BY updated_at ASC, id ASC
      LIMIT ?
    `).all(sinceVal, Number(limit));

    const formattedRows = rows.map(r => ({
      uid: r.uid || r.id,
      full_name: r.full_name || 'Unnamed Patient',
      nic: r.nic || null,
      phone: r.phone || null,
      dob: r.dob || null,
      notes: r.notes || null,
      deleted: Boolean(r.deleted),
      created_at: r.created_at,
      updated_at: r.updated_at,
      deleted_at: r.deleted_at
    }));

    const lastRow = formattedRows[formattedRows.length - 1];
    const nextSince = lastRow ? lastRow.updated_at : since;
    const nextCursor = Number(cursor) + formattedRows.length;

    res.json({
      resource: "patients",
      rows: formattedRows,
      has_more: false,
      next: {
        since: nextSince,
        cursor: nextCursor
      },
      server_time: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Push Patients (v1)
app.post('/api/sync/v1/patients', (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'Invalid rows payload' });
  }

  try {
    const results = [];
    const serverNow = new Date().toISOString();

    const tx = db.transaction(() => {
      for (const row of rows) {
        const uid = row.uid;
        const fullName = row.full_name || 'Unnamed Patient';
        const now = row.updated_at || serverNow;

        db.prepare(`
          INSERT INTO patients (id, uid, name, full_name, nic, phone, dob, notes, deleted, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            deleted_at = excluded.deleted_at
        `).run(
          uid,
          uid,
          fullName,
          fullName,
          row.nic || null,
          row.phone || null,
          row.dob || null,
          row.notes || null,
          row.deleted ? 1 : 0,
          now,
          now,
          row.deleted ? now : null
        );

        results.push({
          uid: uid,
          outcome: "applied",
          updated_at: now
        });
      }
    });

    tx();
    res.json({
      resource: "patients",
      results,
      server_time: serverNow
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Pull Appointments (v1)
app.get('/api/sync/v1/appointments', (req, res) => {
  try {
    const { since = '0', cursor = 0, limit = 200 } = req.query;
    const sinceVal = since === '0' ? '1970-01-01T00:00:00.000Z' : since;

    const rows = db.prepare(`
      SELECT uid, patient_uid, appt_date, queue_number, status, source, reference, notes, deleted, created_at, updated_at, deleted_at
      FROM appointments
      WHERE updated_at >= ?
      ORDER BY updated_at ASC
      LIMIT ?
    `).all(sinceVal, Number(limit));

    const formattedRows = rows.map(r => ({
      uid: r.uid,
      patient_uid: r.patient_uid,
      appt_date: r.appt_date,
      queue_number: Number(r.queue_number),
      status: r.status,
      source: r.source,
      reference: r.reference || null,
      notes: r.notes || null,
      deleted: Boolean(r.deleted),
      created_at: r.created_at,
      updated_at: r.updated_at,
      deleted_at: r.deleted_at
    }));

    const lastRow = formattedRows[formattedRows.length - 1];
    const nextSince = lastRow ? lastRow.updated_at : since;
    const nextCursor = Number(cursor) + formattedRows.length;

    res.json({
      resource: "appointments",
      rows: formattedRows,
      has_more: false,
      next: {
        since: nextSince,
        cursor: nextCursor
      },
      server_time: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Push Appointments (v1)
app.post('/api/sync/v1/appointments', (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'Invalid rows payload' });
  }

  try {
    const results = [];
    const serverNow = new Date().toISOString();

    const tx = db.transaction(() => {
      for (const row of rows) {
        const uid = row.uid;
        const now = row.updated_at || serverNow;
        let queueNum = Number(row.queue_number);
        let outcome = "applied";
        let changes = null;

        // Check if queue number already taken by another appointment for the same date
        const conflict = db.prepare(`
          SELECT uid FROM appointments 
          WHERE appt_date = ? AND queue_number = ? AND uid != ? AND deleted = 0
        `).get(row.appt_date, queueNum, uid);

        if (conflict) {
          const maxQ = db.prepare(`
            SELECT MAX(queue_number) as max_val FROM appointments WHERE appt_date = ? AND deleted = 0
          `).get(row.appt_date);
          queueNum = (maxQ && maxQ.max_val ? maxQ.max_val : 0) + 1;
          outcome = "adjusted";
          changes = {
            queue_number: queueNum,
            reference: row.reference || `ADJ-${Date.now().toString(36).toUpperCase()}`
          };
        }

        db.prepare(`
          INSERT INTO appointments (uid, patient_uid, appt_date, queue_number, status, source, reference, notes, deleted, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            deleted_at = excluded.deleted_at
        `).run(
          uid,
          row.patient_uid,
          row.appt_date,
          queueNum,
          row.status,
          row.source,
          changes ? changes.reference : row.reference,
          row.notes || null,
          row.deleted ? 1 : 0,
          now,
          now,
          row.deleted ? now : null
        );

        results.push({
          uid: uid,
          outcome: outcome,
          updated_at: now,
          ...(changes ? { changes } : {})
        });
      }
    });

    tx();
    res.json({
      resource: "appointments",
      results,
      server_time: serverNow
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// LEGACY SYNC & MOBILE APIS
// ==========================================

app.post('/api/sync/push', (req, res) => {
  const { changes } = req.body;
  if (!changes || !Array.isArray(changes)) {
    return res.status(400).json({ error: 'Invalid changes payload' });
  }

  try {
    const transaction = db.transaction(() => {
      const serverNow = new Date().toISOString();

      for (const change of changes) {
        const { table_name, row_id, action, payload } = change;
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload;

        if (action === 'DELETE') {
          db.prepare('INSERT INTO sync_tombstones (table_name, row_id, deleted_at) VALUES (?, ?, ?)')
            .run(table_name, String(row_id), serverNow);

          if (table_name === 'queue') {
            db.prepare('DELETE FROM queue WHERE patient_id = ?').run(row_id);
          } else {
            db.prepare(`UPDATE ${table_name} SET is_deleted = 1, updated_at = ? WHERE id = ?`)
              .run(serverNow, row_id);
          }
        } else {
          if (table_name === 'patients') {
            db.prepare(`
              INSERT OR REPLACE INTO patients (id, uid, name, full_name, nic, phone, dob, notes, age, gender, address, medical_history, files, created_at, updated_at, is_deleted)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(data.id, data.uid || data.id, data.name, data.full_name || data.name, data.nic || null, data.phone, data.dob || null, data.notes || null, data.age, data.gender, data.address, data.medical_history, data.files, data.created_at, data.updated_at, data.is_deleted);
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
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sync/pull', (req, res) => {
  const { since } = req.query;
  if (!since) return res.status(400).json({ error: 'Missing since parameter' });

  try {
    const changes = [];
    const serverNow = new Date().toISOString();

    const updatedPatients = db.prepare('SELECT * FROM patients WHERE updated_at > ?').all(since);
    for (const row of updatedPatients) {
      changes.push({ table_name: 'patients', row_id: row.id, action: 'UPDATE', payload: row });
    }

    const updatedInventory = db.prepare('SELECT * FROM inventory WHERE updated_at > ?').all(since);
    for (const row of updatedInventory) {
      changes.push({ table_name: 'inventory', row_id: String(row.id), action: 'UPDATE', payload: row });
    }

    const updatedPrescriptions = db.prepare('SELECT * FROM prescriptions WHERE updated_at > ?').all(since);
    for (const row of updatedPrescriptions) {
      changes.push({ table_name: 'prescriptions', row_id: String(row.id), action: 'UPDATE', payload: row });
    }

    const updatedQueue = db.prepare('SELECT * FROM queue WHERE updated_at > ?').all(since);
    for (const row of updatedQueue) {
      changes.push({ table_name: 'queue', row_id: row.patient_id, action: 'UPDATE', payload: row });
    }

    const updatedSales = db.prepare('SELECT * FROM sales WHERE created_at > ?').all(since);
    for (const row of updatedSales) {
      changes.push({ table_name: 'sales', row_id: String(row.transaction_id), action: 'INSERT', payload: row });
    }

    const tombstones = db.prepare('SELECT * FROM sync_tombstones WHERE deleted_at > ?').all(since);
    for (const ts of tombstones) {
      changes.push({ table_name: ts.table_name, row_id: ts.row_id, action: 'DELETE', payload: null });
    }

    res.json({ changes, timestamp: serverNow });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/debug/db', (req, res) => {
  try {
    const patients = db.prepare('SELECT * FROM patients').all();
    const appointments = db.prepare('SELECT * FROM appointments').all();
    const inventory = db.prepare('SELECT * FROM inventory').all();
    const prescriptions = db.prepare('SELECT * FROM prescriptions').all();
    const sales = db.prepare('SELECT * FROM sales').all();
    const queue = db.prepare('SELECT * FROM queue').all();

    res.json({ patients, appointments, inventory, prescriptions, sales, queue });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mobile routes
app.get('/', (req, res) => res.redirect('/mobile'));
app.get('/mobile', (req, res) => res.sendFile(path.join(__dirname, 'mobile.html')));
app.get('/jsQR.js', (req, res) => res.sendFile(path.join(__dirname, 'jsQR.js')));

app.get('/api/mobile/patient', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing patient ID' });

  try {
    const patient = db.prepare('SELECT id, uid, name, full_name, nic, phone, dob, age, gender, files FROM patients WHERE (id = ? OR uid = ?) AND deleted = 0 AND is_deleted = 0').get(id, id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    res.json(patient);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/mobile/upload', (req, res) => {
  const { patientId, fileName, fileData } = req.body;
  if (!patientId || !fileName || !fileData) {
    return res.status(400).json({ error: 'Missing upload fields' });
  }

  try {
    const base64Data = fileData.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');

    const destDir = path.join(__dirname, 'patient_files', patientId);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const uniqueFilename = `${Date.now()}_${fileName}`;
    const destPath = path.join(destDir, uniqueFilename);
    fs.writeFileSync(destPath, buffer);

    const fileMeta = {
      name: fileName,
      path: `${patientId}/${uniqueFilename}`,
      uploaded_at: new Date().toISOString()
    };

    const patient = db.prepare('SELECT * FROM patients WHERE id = ? OR uid = ?').get(patientId, patientId);
    if (patient) {
      const files = JSON.parse(patient.files || '[]');
      files.push(fileMeta);
      
      const now = new Date().toISOString();
      db.prepare('UPDATE patients SET files = ?, updated_at = ? WHERE id = ? OR uid = ?')
        .run(JSON.stringify(files), now, patientId, patientId);
      
      res.json({ success: true, file: fileMeta });
    } else {
      res.status(404).json({ error: 'Patient not found in cloud' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

let serverInstance = null;

function startCloudServer(port = 3000) {
  initializeCloudDatabase();
  serverInstance = app.listen(port, '0.0.0.0', () => {
    console.log(`[Cloud Server] Mock API Server running on port ${port}`);
  });
  serverInstance.keepAliveTimeout = 61000;
  serverInstance.headersTimeout = 65000;
  return serverInstance;
}

function stopCloudServer() {
  if (serverInstance) {
    serverInstance.close(() => {
      console.log('[Cloud Server] Mock API Server stopped');
    });
  }
}

module.exports = {
  startCloudServer,
  stopCloudServer
};
