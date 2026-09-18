const path = require('path');
const fs = require('fs');

console.log('=== STARTING CLINIC DATABASE VERIFICATION ===');

const dbFile = path.join(__dirname, 'clinic.db');
const walFile = dbFile + '-wal';
const shmFile = dbFile + '-shm';

try {
  // Clear old database files if they exist before requiring db.js
  if (fs.existsSync(dbFile)) {
    try {
      fs.unlinkSync(dbFile);
      console.log('Cleaned up previous database file.');
    } catch (e) {
      console.log('Could not unlink database file (it might be locked, proceeding anyway):', e.message);
    }
  }
  if (fs.existsSync(walFile)) {
    try { fs.unlinkSync(walFile); } catch (e) {}
  }
  if (fs.existsSync(shmFile)) {
    try { fs.unlinkSync(shmFile); } catch (e) {}
  }

  // Load database module (opens connection)
  const { initializeDatabase, dbOps } = require('./db');

  // 2. Initialize database
  console.log('Initializing database schema...');
  initializeDatabase();
  console.log('Schema created successfully.');

  // 3. Test Authentication
  console.log('\nTesting Authentication...');
  const doctorUser = dbOps.loginUser('doctor', 'doctor123');
  if (doctorUser && doctorUser.roles.includes('doctor')) {
    console.log('✓ Login successful for doctor user.');
    console.log('  Permissions:', doctorUser.permissions);
  } else {
    throw new Error('Doctor login failed!');
  }

  const nurseUser = dbOps.loginUser('nurse', 'nurse123');
  if (nurseUser && nurseUser.roles.includes('receptionist') && nurseUser.roles.includes('pharmacist')) {
    console.log('✓ Login successful for nurse with combined roles.');
  } else {
    throw new Error('Nurse combined roles login failed!');
  }

  // 4. Test Patient Registration
  console.log('\nTesting Patient Registry...');
  const testPatient = {
    name: 'Kasun Perera',
    phone: '0779876543',
    age: 42,
    gender: 'Male',
    address: 'Kandy Road, Colombo',
    medical_history: 'Hypertension, no allergies.'
  };

  const patientId = dbOps.createPatient(testPatient);
  console.log(`✓ Patient registered with generated ID: ${patientId}`);

  const patientRecord = dbOps.getPatient(patientId);
  if (patientRecord && patientRecord.name === 'Kasun Perera') {
    console.log('✓ Patient retrieved successfully.');
  } else {
    throw new Error('Patient retrieval failed!');
  }

  // 5. Test Prescription Writing
  console.log('\nTesting Prescription Creation...');
  const inventory = dbOps.getInventory();
  const amox = inventory.find(i => i.name.startsWith('Amoxicillin'));
  if (!amox) {
    throw new Error('Amoxicillin inventory item not found!');
  }

  const prescriptionId = dbOps.createPrescription({
    patient_id: patientId,
    doctor_id: doctorUser.id,
    items: [
      {
        medicine_id: amox.id,
        name: amox.name,
        prescribed_qty: 20,
        dispensed_qty: 0,
        status: 'prescribed',
        notes: 'Twice daily after meals'
      }
    ]
  });
  console.log(`✓ Prescription saved with ID: ${prescriptionId}`);

  // 6. Test Atomic Dispensation Transaction
  console.log('\nTesting Atomic Dispensation Transaction...');
  const prevStock = amox.quantity;
  const dispenseQty = 20;

  console.log(`Initial stock for ${amox.name}: ${prevStock}`);
  console.log(`Dispensing: ${dispenseQty} units, Doctor Fee: 750 LKR`);

  dbOps.dispensePrescription(
    prescriptionId,
    [{ medicine_id: amox.id, quantity_dispensed: dispenseQty }],
    750,
    patientId
  );

  console.log('✓ Dispensation transaction committed successfully.');

  const updatedInventory = dbOps.getInventory();
  const updatedAmox = updatedInventory.find(i => i.id === amox.id);
  console.log(`Updated stock for ${amox.name}: ${updatedAmox.quantity}`);
  
  if (updatedAmox.quantity === prevStock - dispenseQty) {
    console.log('✓ Stock decremented correctly.');
  } else {
    throw new Error('Stock decrement mismatch!');
  }

  // Validate Sales and Profit Calculations
  console.log('\nVerifying Sales and Profit calculations...');
  const todayStr = new Date().toISOString().split('T')[0];
  const sales = dbOps.getSalesReport(todayStr, todayStr);
  const profitSummary = dbOps.getProfitSummary(todayStr, todayStr);

  console.log('Recorded Sales Count today:', sales.length);
  console.log('Profit Summary:', profitSummary);

  if (profitSummary.medicine_profit === 140.0 && profitSummary.doctor_fee_profit === 750.0 && profitSummary.total_profit === 890.0) {
    console.log('✓ Sales transaction logging and profit margins computed accurately.');
  } else {
    console.error('Expected medicine profit: 140, got:', profitSummary.medicine_profit);
    console.error('Expected doctor fee profit: 750, got:', profitSummary.doctor_fee_profit);
    console.error('Expected total profit: 890, got:', profitSummary.total_profit);
    throw new Error('Sales logic profit computation mismatch!');
  }

  console.log('\n=== CLINIC DATABASE VERIFICATION COMPLETED SUCCESSFULLY ===');
} catch (error) {
  console.error('\n❌ DATABASE VERIFICATION FAILED:', error.message);
  process.exit(1);
}
