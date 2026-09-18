const http = require('http');
const fs = require('fs');
const path = require('path');
const { initializeDatabase, dbOps } = require('./db');

console.log('=== STARTING MOBILE INTEGRATION VERIFICATION ===');

try {
  // Initialize db to ensure tables are loaded
  initializeDatabase();

  // Create a dummy patient if none exist
  const patients = dbOps.getPatients();
  let patientId;
  if (patients.length === 0) {
    patientId = dbOps.createPatient({
      name: 'Mobile Verification Test',
      age: 29,
      gender: 'Female',
      phone: '0770000000',
      address: 'Test Ward, Sri Lanka',
      medical_history: 'None'
    });
  } else {
    patientId = patients[0].id;
  }

  console.log(`Using patient ID for test: ${patientId}`);

  // Test local IP address resolution
  const os = require('os');
  function getLocalIp() {
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
  const ip = getLocalIp();
  console.log(`✓ Detected PC local Wi-Fi IP address: ${ip}`);

  // Start Express server in the background (starts server on port 3000)
  const { startCloudServer, stopCloudServer } = require('./cloud_server');
  const server = startCloudServer(3000);
  console.log('Mock Cloud Server started.');

  // Create a sample Base64 Image string (1x1 transparent pixel)
  const sampleBase64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  // Make HTTP request to mock server mobile upload API
  const payload = JSON.stringify({
    patientId: patientId,
    fileName: 'verification_wound_photo.png',
    fileData: sampleBase64Image
  });

  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/mobile/upload',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  console.log('Sending mock mobile upload request to /api/mobile/upload...');
  const req = http.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => responseData += chunk);
    res.on('end', () => {
      console.log(`Server responded with status code: ${res.statusCode}`);
      const data = JSON.parse(responseData);
      
      if (res.statusCode === 200 && data.success) {
        console.log('✓ Upload request succeeded.');
        console.log('Uploaded File Metadata:', data.file);
        
        // Verify file was written to disk
        const filePath = path.join(__dirname, 'patient_files', patientId, data.file.path.split('/')[1]);
        if (fs.existsSync(filePath)) {
          console.log(`✓ File verified on disk: ${filePath}`);
          
          // Verify that it is written to the database (since this writes to cloudDb, we check cloud_clinic.db)
          const CloudDb = require('better-sqlite3');
          const cDb = new CloudDb(path.join(__dirname, 'cloud_clinic.db'));
          const pRec = cDb.prepare('SELECT files FROM patients WHERE id = ?').get(patientId);
          const files = JSON.parse(pRec.files);
          const hasFile = files.some(f => f.name === 'verification_wound_photo.png');
          
          if (hasFile) {
            console.log('✓ File saved inside cloud database registry successfully.');
            console.log('\n=== MOBILE INTEGRATION VERIFIED SUCCESSFULLY ===');
          } else {
            console.error('File metadata missing in database records.');
            process.exit(1);
          }
        } else {
          console.error('File not found on disk.');
          process.exit(1);
        }
      } else {
        console.error('Upload request failed:', data.error);
        process.exit(1);
      }
      
      stopCloudServer();
      process.exit(0);
    });
  });

  req.on('error', (e) => {
    console.error('HTTP Request failed:', e.message);
    stopCloudServer();
    process.exit(1);
  });

  req.write(payload);
  req.end();

} catch (error) {
  console.error('❌ MOBILE INTEGRATION VERIFICATION FAILED:', error.message);
  process.exit(1);
}
