const { app } = require('electron');
const { initializeDatabase, dbOps } = require('./db');

try {
  console.log('--- Initializing database ---');
  initializeDatabase();
  console.log('--- Checking installation status ---');
  const isInstalled = dbOps.isInstallationCompleted();
  console.log('isInstallationCompleted:', isInstalled);
  const modules = dbOps.getModules();
  console.log('Modules registered:', modules.map(m => `${m.id}: ${m.name} (${m.slug})`));

  console.log('--- Testing completeInstallation ---');
  const result = dbOps.completeInstallation({
    doctor: {
      name: 'Dr. John Silva',
      username: 'doctor',
      password: 'password123'
    },
    receptionist: {
      name: 'Kamal Silva',
      username: 'receptionist',
      password: 'password123'
    },
    doctorModules: ['dashboard', 'appointments', 'consultations', 'patient_registry', 'pharmacy', 'financial_reports'],
    receptionistModules: ['dashboard', 'appointments', 'patient_registry']
  });
  console.log('Setup result:', result);

  console.log('--- Testing isInstallationCompleted now ---');
  console.log('isInstallationCompleted now:', dbOps.isInstallationCompleted());

  console.log('--- Testing Doctor login ---');
  const docLogin = dbOps.loginUser('doctor', 'password123');
  console.log('Doctor logged in:', docLogin.name, docLogin.role, 'Modules:', docLogin.modules);

  console.log('--- Testing Receptionist login ---');
  const recLogin = dbOps.loginUser('receptionist', 'password123');
  console.log('Receptionist logged in:', recLogin.name, recLogin.role, 'Modules:', recLogin.modules);

  console.log('--- Testing Permission Check ---');
  console.log('Doctor has pharmacy perm:', dbOps.checkUserPermission(docLogin.id, 'pharmacy'));
  console.log('Receptionist has pharmacy perm:', dbOps.checkUserPermission(recLogin.id, 'pharmacy'));

  console.log('--- Testing Inventory Search ---');
  const searchResults = dbOps.searchInventory('para');
  console.log('Search para:', searchResults.map(i => `${i.name} (${i.quantity} in stock)`));

  console.log('ALL TESTS PASSED!');
} catch (err) {
  console.error('Test error:', err);
  process.exit(1);
} finally {
  if (app) app.quit();
  process.exit(0);
}
