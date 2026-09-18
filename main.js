const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const QRCode = require('qrcode');
const os = require('os');
const localtunnel = require('localtunnel');

let cloudTunnelUrl = null;
let tunnelInstance = null;

async function startTunnel() {
  try {
    if (tunnelInstance) {
      try { tunnelInstance.close(); } catch(e){}
    }
    console.log('[Cloud Tunnel Engine] Launching persistent tunnel on port 3000...');
    tunnelInstance = await localtunnel({ port: 3000 });
    cloudTunnelUrl = tunnelInstance.url;
    console.log('[Cloud Tunnel Engine] Live active URL:', cloudTunnelUrl);

    tunnelInstance.on('close', () => {
      console.log('[Cloud Tunnel Engine] Connection closed, auto-reconnecting in 5s...');
      cloudTunnelUrl = null;
      setTimeout(startTunnel, 5000);
    });
    tunnelInstance.on('error', (err) => {
      console.error('[Cloud Tunnel Error]:', err.message);
    });
  } catch (err) {
    console.error('[Cloud Tunnel Launch Error]:', err.message);
    setTimeout(startTunnel, 5000);
  }
}

// Load database and mock cloud server modules
const { initializeDatabase, dbOps } = require('./db');
const { startCloudServer } = require('./cloud_server');

let mainWindow;

// Directory for local patient files
const patientFilesDir = path.join(__dirname, 'patient_files');
if (!fs.existsSync(patientFilesDir)) {
  fs.mkdirSync(patientFilesDir, { recursive: true });
}

// Sync state variables
let syncIntervalId = null;
let syncStatus = 'idle'; // 'idle', 'syncing', 'offline', 'auth_error', 'forbidden', 'error'
let syncSimulationOnline = true; // simulation flag for network connectivity
let lastSyncError = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: "NovoPractise Clinic Management"
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();
}

// ==========================================
// HTTP Request Client Helper
// ==========================================
function sendHttpRequest(method, urlString, payload = null, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlString);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const requestHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers
      };

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: method,
        headers: requestHeaders,
        timeout: 15000
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          let parsed;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch (e) {
            parsed = { raw: data };
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, data: parsed });
          } else {
            const err = new Error(parsed.error || parsed.message || `HTTP ${res.statusCode}: ${res.statusMessage}`);
            err.statusCode = res.statusCode;
            err.response = parsed;
            reject(err);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const err = new Error('Network request timed out');
        err.isTimeout = true;
        reject(err);
      });

      req.on('error', (err) => reject(err));

      if (payload) {
        req.write(typeof payload === 'string' ? payload : JSON.stringify(payload));
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

function normalizeSyncBaseUrl(inputUrl) {
  if (!inputUrl) return '';
  let url = inputUrl.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  url = url.replace(/\/+$/, '');
  if (!url.includes('/api/sync/v1')) {
    url = `${url}/api/sync/v1`;
  }
  return url;
}

// ==========================================
// V1 CLOUDFLARE WORKERS SYNC ENGINE
// ==========================================

async function performHandshake(baseUrl, apiKey) {
  const normalizedUrl = normalizeSyncBaseUrl(baseUrl);
  const handshakeUrl = `${normalizedUrl}/handshake`;
  
  const res = await sendHttpRequest('GET', handshakeUrl, null, {
    'Authorization': `Bearer ${apiKey.trim()}`
  });

  const data = res.data;
  if (data && data.clinic) {
    dbOps.saveSyncSettings({
      sync_api_key: apiKey.trim(),
      sync_base_url: normalizedUrl,
      clinic_id: data.clinic_id || '',
      clinic_name: data.clinic.name || '',
      clinic_subdomain: data.clinic.subdomain || '',
      clinic_timezone: data.clinic.timezone || '',
      protocol_version: data.protocol_version || 1,
      last_connected_at: new Date().toISOString()
    });
  }

  return data;
}

async function pullResource(resource, baseUrl, apiKey) {
  let state = dbOps.getSyncState(resource);
  let hasMore = true;
  let totalPulled = 0;

  while (hasMore) {
    const url = `${baseUrl}/${resource}?since=${encodeURIComponent(state.last_since || '0')}&cursor=${state.last_cursor || 0}&limit=200`;
    const res = await sendHttpRequest('GET', url, null, {
      'Authorization': `Bearer ${apiKey}`
    });

    const data = res.data;
    if (!data || !Array.isArray(data.rows)) {
      break;
    }

    for (const row of data.rows) {
      if (resource === 'patients') {
        dbOps.upsertSyncPatient(row);
      } else if (resource === 'appointments') {
        dbOps.upsertSyncAppointment(row);
      }
      totalPulled++;
    }

    if (data.next) {
      dbOps.saveSyncState(resource, data.next.since, data.next.cursor, data.server_time);
      state = { last_since: data.next.since, last_cursor: data.next.cursor };
    }

    hasMore = Boolean(data.has_more);
  }

  return totalPulled;
}

async function pushResource(resource, baseUrl, apiKey) {
  const dirtyRows = dbOps.getDirtyRows(resource, 500);
  if (!dirtyRows || dirtyRows.length === 0) return 0;

  const url = `${baseUrl}/${resource}`;
  const res = await sendHttpRequest('POST', url, { rows: dirtyRows }, {
    'Authorization': `Bearer ${apiKey}`
  });

  const data = res.data;
  if (data && Array.isArray(data.results)) {
    for (const result of data.results) {
      if (result.outcome === 'applied' || result.outcome === 'skipped') {
        dbOps.markClean(resource, result.uid);
      } else if (result.outcome === 'adjusted') {
        dbOps.applyAdjustmentsAndMarkClean(resource, result.uid, result.changes);
      } else if (result.outcome === 'failed') {
        console.error(`[Sync Engine] Push row ${result.uid} failed on server:`, result.error);
      }
    }
  }

  return dirtyRows.length;
}

async function runSyncCycle() {
  if (syncStatus === 'syncing') return false;
  if (!syncSimulationOnline) {
    updateSyncStatus('offline', 'Network simulation offline');
    return false;
  }

  const settings = dbOps.getSyncSettings();
  const apiKey = (settings.sync_api_key || '').trim();
  const baseUrl = normalizeSyncBaseUrl(settings.sync_base_url || '');

  // If live Cloudflare Worker sync credentials are configured with an active API key
  if (apiKey && apiKey.length > 5 && baseUrl) {
    updateSyncStatus('syncing');
    lastSyncError = null;

    try {
      // 1. PULL PHASE (Patients first, then Appointments)
      await pullResource('patients', baseUrl, apiKey);
      await pullResource('appointments', baseUrl, apiKey);

      // 2. PUSH PHASE (Patients first, then Appointments)
      await pushResource('patients', baseUrl, apiKey);
      await pushResource('appointments', baseUrl, apiKey);

      const now = new Date().toISOString();
      dbOps.setSyncSetting('last_synced_at', now);
      updateSyncStatus('idle');
      return true;
    } catch (error) {
      if (lastSyncError !== error.message) {
        console.error('[Cloud Sync V1 Error]:', error.message);
      }
      lastSyncError = error.message;

      if (error.statusCode === 401) {
        updateSyncStatus('auth_error', 'Invalid or revoked Sync API Key (401)');
      } else if (error.statusCode === 403) {
        updateSyncStatus('forbidden', 'Clinic account is deactivated (403)');
      } else {
        updateSyncStatus('error', error.message);
      }
      return false;
    }
  }

  // Fallback: Local Server Sync Simulation
  updateSyncStatus('syncing');
  try {
    const unsynced = dbOps.getUnsyncedLogs();
    if (unsynced.length > 0) {
      const pushResponse = await sendHttpRequest('POST', 'http://localhost:3000/api/sync/push', {
        changes: unsynced
      });

      if (pushResponse && pushResponse.data && pushResponse.data.success) {
        const logIds = unsynced.map(log => log.id);
        dbOps.removeSyncLogs(logIds);
      }
    }

    const lastSyncedAt = dbOps.getLastSyncedAt();
    const pullResponse = await sendHttpRequest('GET', `http://localhost:3000/api/sync/pull?since=${encodeURIComponent(lastSyncedAt)}`);

    if (pullResponse && pullResponse.data && pullResponse.data.changes) {
      if (pullResponse.data.changes.length > 0) {
        dbOps.applyServerChanges(pullResponse.data.changes);
      }
      dbOps.setLastSyncedAt(pullResponse.data.timestamp);
    }

    updateSyncStatus('idle');
    return true;
  } catch (error) {
    updateSyncStatus('error', error.message);
    return false;
  }
}

function updateSyncStatus(status, errorMessage = null) {
  syncStatus = status;
  if (errorMessage) lastSyncError = errorMessage;
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    const settings = dbOps.getSyncSettings();
    const lastSynced = settings.last_synced_at || dbOps.getLastSyncedAt();

    mainWindow.webContents.send('sync:update', {
      status: syncStatus,
      lastSynced: lastSynced,
      simulationOnline: syncSimulationOnline,
      error: lastSyncError,
      clinic: {
        name: settings.clinic_name || '',
        subdomain: settings.clinic_subdomain || '',
        timezone: settings.clinic_timezone || 'Asia/Colombo'
      }
    });
  }
}

// ==========================================
// IPC HANDLERS & SESSION AUTHORIZATION
// ==========================================

let activeUserSession = null;

function enforceModulePermission(moduleSlug) {
  if (!activeUserSession) {
    throw new Error('Unauthorized: No active session. Please log in.');
  }
  const hasPerm = dbOps.checkUserPermission(activeUserSession.id, moduleSlug);
  if (!hasPerm) {
    throw new Error(`Access Denied: You do not have permission to access the '${moduleSlug}' module.`);
  }
}

// System Setup / Installation (Public Setup Phase)
ipcMain.handle('system:checkInstallation', async () => {
  return dbOps.isInstallationCompleted();
});

ipcMain.handle('system:getModules', async () => {
  return dbOps.getModules();
});

ipcMain.handle('system:completeInstallation', async (event, setupData) => {
  return dbOps.completeInstallation(setupData);
});

// Dynamic Roles Management
ipcMain.handle('roles:get', async (event, includeInactive = false) => {
  return dbOps.getRoles(includeInactive);
});

ipcMain.handle('roles:create', async (event, roleData) => {
  return dbOps.createRole(roleData);
});

ipcMain.handle('roles:update', async (event, id, roleData) => {
  return dbOps.updateRole(id, roleData);
});

ipcMain.handle('roles:toggleStatus', async (event, id, status) => {
  return dbOps.toggleRoleStatus(id, status);
});

// User Management
ipcMain.handle('users:get', async () => {
  return dbOps.getUsers();
});

ipcMain.handle('users:create', async (event, userData) => {
  return dbOps.createUser(userData);
});

// Auth & Users
ipcMain.handle('db:login', async (event, username, password) => {
  const user = dbOps.loginUser(username, password);
  if (user) {
    activeUserSession = user;
  }
  return user;
});

ipcMain.handle('auth:logout', async () => {
  activeUserSession = null;
  return { success: true };
});

ipcMain.handle('db:getUserModules', async (event, userId) => {
  return dbOps.getUserModules(userId);
});

ipcMain.handle('db:checkUserPermission', async (event, userId, moduleSlug) => {
  return dbOps.checkUserPermission(userId, moduleSlug);
});

ipcMain.handle('db:updatePrescriptionStatus', async (event, id, status) => {
  return dbOps.updatePrescriptionStatus(id, status);
});

// Patients (Protected: patient_registry, consultations, or pharmacy for clinical lookup)
ipcMain.handle('db:getPatients', async () => {
  if (!activeUserSession) {
    throw new Error('Unauthorized: No active session.');
  }
  const canRegistry = dbOps.checkUserPermission(activeUserSession.id, 'patient_registry');
  const canPharmacy = dbOps.checkUserPermission(activeUserSession.id, 'pharmacy');
  const canConsult = dbOps.checkUserPermission(activeUserSession.id, 'consultations');
  if (!canRegistry && !canPharmacy && !canConsult) {
    throw new Error("Access Denied: You do not have permission for module: patient_registry");
  }
  return dbOps.getPatients();
});

ipcMain.handle('db:getRecentPatients', async (event, limit = 10) => {
  enforceModulePermission('patient_registry');
  return dbOps.getRecentPatients(limit);
});

ipcMain.handle('db:getPatient', async (event, id) => {
  if (!activeUserSession) {
    throw new Error('Unauthorized: No active session.');
  }
  const canRegistry = dbOps.checkUserPermission(activeUserSession.id, 'patient_registry');
  const canPharmacy = dbOps.checkUserPermission(activeUserSession.id, 'pharmacy');
  const canConsult = dbOps.checkUserPermission(activeUserSession.id, 'consultations');
  if (!canRegistry && !canPharmacy && !canConsult) {
    throw new Error("Access Denied: You do not have permission for module: patient_registry");
  }
  return dbOps.getPatient(id);
});

ipcMain.handle('db:createPatient', async (event, patient) => {
  enforceModulePermission('patient_registry');
  const result = dbOps.createPatient(patient);
  // Trigger sync in background if online
  if (syncSimulationOnline) setTimeout(runSyncCycle, 200);
  return result;
});

ipcMain.handle('db:updatePatient', async (event, id, patient) => {
  enforceModulePermission('patient_registry');
  const result = dbOps.updatePatient(id, patient);
  if (syncSimulationOnline) setTimeout(runSyncCycle, 200);
  return result;
});

ipcMain.handle('db:deletePatient', async (event, id) => {
  enforceModulePermission('patient_registry');
  const result = dbOps.deletePatient(id);
  if (syncSimulationOnline) setTimeout(runSyncCycle, 200);
  return result;
});

// Appointments (Protected: appointments)
ipcMain.handle('db:getAppointments', async (event, date) => {
  enforceModulePermission('appointments');
  return dbOps.getAppointments(date);
});

ipcMain.handle('db:createAppointment', async (event, appointment) => {
  enforceModulePermission('appointments');
  const result = dbOps.createAppointment(appointment);
  if (syncSimulationOnline) setTimeout(runSyncCycle, 200);
  return result;
});

ipcMain.handle('db:updateAppointmentStatus', async (event, uid, status) => {
  enforceModulePermission('appointments');
  const result = dbOps.updateAppointmentStatus(uid, status);
  if (syncSimulationOnline) setTimeout(runSyncCycle, 200);
  return result;
});

ipcMain.handle('db:deleteAppointment', async (event, uid) => {
  enforceModulePermission('appointments');
  const result = dbOps.deleteAppointment(uid);
  if (syncSimulationOnline) setTimeout(runSyncCycle, 200);
  return result;
});

// Queue (Shared clinical workflow)
ipcMain.handle('db:getQueue', async () => {
  return dbOps.getQueue();
});

ipcMain.handle('db:addToQueue', async (event, patientId) => {
  const result = dbOps.addToQueue(patientId);
  if (syncSimulationOnline) setTimeout(runSyncCycle, 200);
  return result;
});

ipcMain.handle('db:updateQueueStatus', async (event, patientId, status) => {
  const result = dbOps.updateQueueStatus(patientId, status);
  if (syncSimulationOnline) setTimeout(runSyncCycle, 200);
  return result;
});

// Inventory (Protected: pharmacy)
ipcMain.handle('db:getInventory', async () => {
  enforceModulePermission('pharmacy');
  return dbOps.getInventory();
});

ipcMain.handle('db:getInventoryLowStock', async () => {
  enforceModulePermission('pharmacy');
  return dbOps.getInventoryLowStock();
});

ipcMain.handle('db:createInventoryItem', async (event, item) => {
  enforceModulePermission('pharmacy');
  return dbOps.createInventoryItem(item);
});

ipcMain.handle('db:updateInventoryItem', async (event, id, item) => {
  enforceModulePermission('pharmacy');
  return dbOps.updateInventoryItem(id, item);
});

ipcMain.handle('db:adjustInventoryStock', async (event, id, qty, reason) => {
  enforceModulePermission('pharmacy');
  return dbOps.adjustInventoryStock(id, qty, reason);
});

ipcMain.handle('db:searchInventory', async (event, query) => {
  // Allow inventory search if user has pharmacy or consultations
  if (!activeUserSession) {
    throw new Error('Unauthorized: No active session.');
  }
  const canPharmacy = dbOps.checkUserPermission(activeUserSession.id, 'pharmacy');
  const canConsult = dbOps.checkUserPermission(activeUserSession.id, 'consultations');
  if (!canPharmacy && !canConsult) {
    throw new Error("Access Denied: You do not have permission to search medications.");
  }
  return dbOps.searchInventory(query);
});

// Consultations (Protected: consultations)
ipcMain.handle('db:getConsultations', async (event, patientId) => {
  enforceModulePermission('consultations');
  return dbOps.getConsultations(patientId);
});

ipcMain.handle('db:createConsultation', async (event, consultation) => {
  enforceModulePermission('consultations');
  return dbOps.createConsultation(consultation);
});

// Prescriptions & Dispensing (Protected: consultations or pharmacy)
ipcMain.handle('db:getPrescriptionHistory', async (event, patientId) => {
  return dbOps.getPrescriptionHistory(patientId);
});

ipcMain.handle('db:getRecentPrescriptions', async (event, limit = 10) => {
  return dbOps.getRecentPrescriptions(limit);
});

ipcMain.handle('db:createPrescription', async (event, prescription) => {
  enforceModulePermission('consultations');
  return dbOps.createPrescription(prescription);
});

ipcMain.handle('db:updatePrescription', async (event, id, prescription) => {
  return dbOps.updatePrescription(id, prescription);
});

ipcMain.handle('db:dispensePrescription', async (event, prescriptionId, dispenseItems, doctorFee, patientId) => {
  enforceModulePermission('pharmacy');
  return dbOps.dispensePrescription(prescriptionId, dispenseItems, doctorFee, patientId);
});

// Reports (Protected: financial_reports)
ipcMain.handle('db:getSalesReport', async (event, startDate, endDate) => {
  enforceModulePermission('financial_reports');
  return dbOps.getSalesReport(startDate, endDate);
});

ipcMain.handle('db:getProfitSummary', async (event, startDate, endDate) => {
  enforceModulePermission('financial_reports');
  return dbOps.getProfitSummary(startDate, endDate);
});

// Patient Files
ipcMain.handle('file:openDialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Images & Documents', extensions: ['jpg', 'jpeg', 'png', 'pdf'] }
    ]
  });
  return result.filePaths;
});

ipcMain.handle('file:upload', async (event, patientId, srcPath) => {
  try {
    const filename = path.basename(srcPath);
    const destDir = path.join(patientFilesDir, patientId);
    
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const uniqueFilename = `${Date.now()}_${filename}`;
    const destPath = path.join(destDir, uniqueFilename);
    fs.copyFileSync(srcPath, destPath);
    
    return {
      name: filename,
      path: `${patientId}/${uniqueFilename}`,
      uploaded_at: new Date().toISOString()
    };
  } catch (error) {
    console.error('File upload error:', error);
    throw error;
  }
});

ipcMain.handle('file:uploadBase64', async (event, patientId, filename, base64Data) => {
  try {
    const rawBase64 = base64Data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(rawBase64, 'base64');

    const destDir = path.join(patientFilesDir, patientId);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const uniqueFilename = `${Date.now()}_${filename}`;
    const destPath = path.join(destDir, uniqueFilename);
    fs.writeFileSync(destPath, buffer);

    return {
      name: filename,
      path: `${patientId}/${uniqueFilename}`,
      uploaded_at: new Date().toISOString()
    };
  } catch (error) {
    console.error('Base64 upload error:', error);
    throw error;
  }
});

ipcMain.handle('file:getUrl', async (event, patientId, fileName) => {
  return `http://localhost:3000/patient-files/${patientId}/${fileName}`;
});

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return 'localhost';
}

ipcMain.handle('qr:generatePatientLink', async (event, patientId) => {
  try {
    const ip = getLocalIpAddress();
    const url = `http://${ip}:3000/mobile?patientId=${patientId}`;
    const qrDataUrl = await QRCode.toDataURL(url);

    const cloudBase = cloudTunnelUrl || 'https://gold-ads-cry.loca.lt';
    const cloudUrl = `${cloudBase}/mobile?patientId=${patientId}`;
    const cloudQrDataUrl = await QRCode.toDataURL(cloudUrl);

    return { 
      url, 
      qrDataUrl,
      cloudUrl,
      cloudQrDataUrl
    };
  } catch (error) {
    console.error('QR code generation error:', error);
    throw error;
  }
});

// V1 Sync API Handlers
ipcMain.handle('sync:handshake', async (event, baseUrl, apiKey) => {
  return performHandshake(baseUrl, apiKey);
});

ipcMain.handle('sync:getSettings', () => {
  return dbOps.getSyncSettings();
});

ipcMain.handle('sync:saveSettings', (event, settings) => {
  dbOps.saveSyncSettings(settings);
  return true;
});

ipcMain.handle('sync:getStatus', () => {
  const settings = dbOps.getSyncSettings();
  const lastSynced = settings.last_synced_at || dbOps.getLastSyncedAt();
  return {
    status: syncStatus,
    lastSynced: lastSynced,
    simulationOnline: syncSimulationOnline,
    error: lastSyncError,
    clinic: {
      name: settings.clinic_name || '',
      subdomain: settings.clinic_subdomain || '',
      timezone: settings.clinic_timezone || 'Asia/Colombo'
    }
  };
});

ipcMain.handle('sync:force', async () => {
  return runSyncCycle();
});

ipcMain.handle('sync:toggleSimulation', (event, online) => {
  syncSimulationOnline = online;
  if (!online) {
    updateSyncStatus('offline');
  } else {
    updateSyncStatus('idle');
    runSyncCycle();
  }
  return syncSimulationOnline;
});

// ==========================================
// APP LIFECYCLE
// ==========================================
app.whenReady().then(() => {
  // Initialize SQLite database
  initializeDatabase();

  // Start simulated Cloud API Server in background (port 3000)
  startCloudServer(3000);

  // Start background Cloud Tunnel
  startTunnel();

  createWindow();

  // Setup periodic sync loop (every 20 seconds)
  syncIntervalId = setInterval(runSyncCycle, 20000);

  // Initial sync attempt after startup
  setTimeout(runSyncCycle, 1500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
