const { app } = require('electron');
const { initializeDatabase, dbOps } = require('./db.js');

app.whenReady().then(() => {
  try {
    initializeDatabase();
    dbOps.setSyncSetting('installation_completed', 'false');
    console.log('Installation flag successfully set to "false". Wizard will trigger on next launch.');
  } catch(e) {
    console.error('Error resetting installation flag:', e);
  } finally {
    app.quit();
  }
});
