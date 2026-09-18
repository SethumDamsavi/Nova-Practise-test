const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Authentication & Session
  login: (username, password) => ipcRenderer.invoke('db:login', username, password),
  logout: () => ipcRenderer.invoke('auth:logout'),

  // Patients
  getPatients: () => ipcRenderer.invoke('db:getPatients'),
  getRecentPatients: (limit) => ipcRenderer.invoke('db:getRecentPatients', limit),
  getPatient: (id) => ipcRenderer.invoke('db:getPatient', id),
  createPatient: (patient) => ipcRenderer.invoke('db:createPatient', patient),
  updatePatient: (id, patient) => ipcRenderer.invoke('db:updatePatient', id, patient),
  deletePatient: (id) => ipcRenderer.invoke('db:deletePatient', id),

  // Appointments (v1 Sync Protocol)
  getAppointments: (date) => ipcRenderer.invoke('db:getAppointments', date),
  createAppointment: (appointment) => ipcRenderer.invoke('db:createAppointment', appointment),
  updateAppointmentStatus: (uid, status) => ipcRenderer.invoke('db:updateAppointmentStatus', uid, status),
  deleteAppointment: (uid) => ipcRenderer.invoke('db:deleteAppointment', uid),

  // Queue waiting room
  getQueue: () => ipcRenderer.invoke('db:getQueue'),
  addToQueue: (patientId) => ipcRenderer.invoke('db:addToQueue', patientId),
  updateQueueStatus: (patientId, status) => ipcRenderer.invoke('db:updateQueueStatus', patientId, status),

  // Inventory
  getInventory: () => ipcRenderer.invoke('db:getInventory'),
  getInventoryLowStock: () => ipcRenderer.invoke('db:getInventoryLowStock'),
  createInventoryItem: (item) => ipcRenderer.invoke('db:createInventoryItem', item),
  updateInventoryItem: (id, item) => ipcRenderer.invoke('db:updateInventoryItem', id, item),
  adjustInventoryStock: (id, qty, reason) => ipcRenderer.invoke('db:adjustInventoryStock', id, qty, reason),

  // Prescriptions
  getPrescriptionHistory: (patientId) => ipcRenderer.invoke('db:getPrescriptionHistory', patientId),
  getRecentPrescriptions: (limit) => ipcRenderer.invoke('db:getRecentPrescriptions', limit),
  createPrescription: (prescription) => ipcRenderer.invoke('db:createPrescription', prescription),
  updatePrescription: (id, prescription) => ipcRenderer.invoke('db:updatePrescription', id, prescription),

  // Consultations
  getConsultations: (patientId) => ipcRenderer.invoke('db:getConsultations', patientId),
  createConsultation: (consultation) => ipcRenderer.invoke('db:createConsultation', consultation),

  // Inventory & Medication Search
  searchInventory: (query) => ipcRenderer.invoke('db:searchInventory', query),

  // First Installation & Setup
  checkInstallation: () => ipcRenderer.invoke('system:checkInstallation'),
  getModules: () => ipcRenderer.invoke('system:getModules'),
  completeInstallation: (setupData) => ipcRenderer.invoke('system:completeInstallation', setupData),

  // User Permissions
  getUserModules: (userId) => ipcRenderer.invoke('db:getUserModules', userId),
  checkUserPermission: (userId, moduleSlug) => ipcRenderer.invoke('db:checkUserPermission', userId, moduleSlug),

  // Dispensing (atomic action)
  dispensePrescription: (prescriptionId, dispenseItems, doctorFee, patientId) => 
    ipcRenderer.invoke('db:dispensePrescription', prescriptionId, dispenseItems, doctorFee, patientId),

  // Reports
  getSalesReport: (startDate, endDate) => ipcRenderer.invoke('db:getSalesReport', startDate, endDate),
  getProfitSummary: (startDate, endDate) => ipcRenderer.invoke('db:getProfitSummary', startDate, endDate),

  // Local Patient File Management
  openFileDialog: () => ipcRenderer.invoke('file:openDialog'),
  uploadPatientFile: (patientId, srcPath) => ipcRenderer.invoke('file:upload', patientId, srcPath),
  uploadPatientFileBase64: (patientId, filename, base64Data) => ipcRenderer.invoke('file:uploadBase64', patientId, filename, base64Data),
  getPatientFileUrl: (patientId, fileName) => ipcRenderer.invoke('file:getUrl', patientId, fileName),
  generatePatientQrLink: (patientId) => ipcRenderer.invoke('qr:generatePatientLink', patientId),

  // Sync operations & v1 Cloudflare Protocol
  syncHandshake: (baseUrl, apiKey) => ipcRenderer.invoke('sync:handshake', baseUrl, apiKey),
  getSyncSettings: () => ipcRenderer.invoke('sync:getSettings'),
  saveSyncSettings: (settings) => ipcRenderer.invoke('sync:saveSettings', settings),
  getSyncStatus: () => ipcRenderer.invoke('sync:getStatus'),
  forceSync: () => ipcRenderer.invoke('sync:force'),
  toggleSyncSimulation: (online) => ipcRenderer.invoke('sync:toggleSimulation', online),
  onSyncUpdate: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('sync:update', listener);
    return () => ipcRenderer.removeListener('sync:update', listener);
  }
});
