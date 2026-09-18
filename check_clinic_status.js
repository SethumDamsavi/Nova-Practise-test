const { app } = require('electron');
const { initializeDatabase, dbOps } = require('./db.js');

app.whenReady().then(() => {
  try {
    initializeDatabase();
    const installed = dbOps.isInstallationCompleted();
    console.log(`CURRENT_INSTALLATION_STATUS: ${installed}`);
  } catch(e) {
    console.error(e);
  } finally {
    app.quit();
  }
});
