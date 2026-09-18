const { app } = require('electron');
const path = require('path');
const fs = require('fs');

async function runTests() {
  console.log('=== RUNNING COMPREHENSIVE END-TO-END VERIFICATION ===\n');
  
  // Use a dedicated clean test database to test from step 1 (installation) to dispensing
  const testDbPath = path.join(__dirname, 'test_e2e_clinic.db');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  // Force db.js to use test database path
  process.env.TEST_DB_PATH = testDbPath;
  const { initializeDatabase, dbOps } = require('./db.js');
  initializeDatabase();

  try {
    // -------------------------------------------------------------
    // TEST 1: Installation Detection
    // -------------------------------------------------------------
    console.log('TEST 1: Installation detection flag...');
    const isInstalledInitial = dbOps.isInstallationCompleted();
    console.log(`Initial isInstallationCompleted: ${isInstalledInitial}`);
    if (isInstalledInitial !== false) {
      throw new Error(`Expected isInstallationCompleted to be false on fresh DB, got ${isInstalledInitial}`);
    }
    console.log('  PASSED: System correctly detects uninstalled fresh state.\n');

    // -------------------------------------------------------------
    // TEST 2: Installation Setup Wizard Submission
    // -------------------------------------------------------------
    console.log('TEST 2: Installation Setup (Doctor & Receptionist + Module Permissions)...');
    const modules = dbOps.getModules();
    console.log(`Available system modules in DB: ${modules.map(m => m.slug).join(', ')}`);
    if (modules.length < 6) {
      throw new Error(`Expected at least 6 default modules, got ${modules.length}`);
    }

    const installPayload = {
      doctor: {
        name: 'Dr. Emily Vance',
        username: 'dr.vance',
        password: 'DoctorPassword123'
      },
      receptionist: {
        name: 'Michael Scott',
        username: 'mscott',
        password: 'RecPassword123'
      },
      doctorModules: ['dashboard', 'appointments', 'consultations', 'patient_registry', 'pharmacy', 'financial_reports'],
      receptionistModules: ['dashboard', 'appointments', 'patient_registry'] // Receptionist does NOT have pharmacy or financial_reports
    };

    const installResult = dbOps.completeInstallation(installPayload);
    if (!installResult || !installResult.success) {
      throw new Error('completeInstallation failed');
    }

    const isInstalledAfter = dbOps.isInstallationCompleted();
    console.log(`isInstallationCompleted after wizard: ${isInstalledAfter}`);
    if (isInstalledAfter !== true) {
      throw new Error('Expected isInstallationCompleted to be true after setup');
    }
    console.log('  PASSED: Installation completed flag successfully saved.\n');

    // -------------------------------------------------------------
    // TEST 3: Login Authentication & Module-Based Permissions
    // -------------------------------------------------------------
    console.log('TEST 3: Role-based Login & Module permissions...');
    
    // Doctor Login
    const docLogin = dbOps.loginUser('dr.vance', 'DoctorPassword123');
    if (!docLogin) throw new Error('Doctor login failed');
    console.log(`Doctor logged in: Name="${docLogin.name}", Role="${docLogin.role}"`);
    console.log(`Doctor assigned modules: ${docLogin.modules.join(', ')}`);
    if (docLogin.name !== 'Dr. Emily Vance') {
      throw new Error(`Expected Doctor Name "Dr. Emily Vance", got "${docLogin.name}"`);
    }
    if (!docLogin.modules.includes('pharmacy') || !docLogin.modules.includes('consultations')) {
      throw new Error('Doctor missing assigned modules');
    }

    // Receptionist Login
    const recLogin = dbOps.loginUser('mscott', 'RecPassword123');
    if (!recLogin) throw new Error('Receptionist login failed');
    console.log(`Receptionist logged in: Name="${recLogin.name}", Role="${recLogin.role}"`);
    console.log(`Receptionist assigned modules: ${recLogin.modules.join(', ')}`);
    if (recLogin.name !== 'Michael Scott') {
      throw new Error(`Expected Receptionist Name "Michael Scott", got "${recLogin.name}"`);
    }
    if (recLogin.modules.includes('pharmacy')) {
      throw new Error('Receptionist should NOT have pharmacy module assigned');
    }
    if (recLogin.modules.includes('financial_reports')) {
      throw new Error('Receptionist should NOT have financial_reports module assigned');
    }

    // Backend Permission Check Helper
    const recCanAccessPharmacy = dbOps.checkUserPermission(recLogin.id, 'pharmacy');
    const docCanAccessPharmacy = dbOps.checkUserPermission(docLogin.id, 'pharmacy');
    console.log(`Permission check for 'pharmacy': Doctor=${docCanAccessPharmacy}, Receptionist=${recCanAccessPharmacy}`);
    if (recCanAccessPharmacy !== false || docCanAccessPharmacy !== true) {
      throw new Error('checkUserPermission failed');
    }
    console.log('  PASSED: Login returned actual full names, roles, and relational module permissions.\n');

    // -------------------------------------------------------------
    // TEST 4: Patient Registration & Live Drug Inventory Search
    // -------------------------------------------------------------
    console.log('TEST 4: Patient & Live Medication Search...');
    const patientId = dbOps.createPatient({
      name: 'Johnathan Doe',
      age: 42,
      gender: 'Male',
      phone: '0771234567',
      medical_history: 'Hypertension, Penicillin Allergy'
    });
    console.log(`Created Patient ID: ${patientId}`);

    // Create a new unique drug in inventory with known stock
    const drugId = dbOps.createInventoryItem({
      name: 'Ciprofloxacin HCl 500mg',
      code: 'MED-CIPRO-500',
      category: 'Antibiotics',
      dosage_form: 'Tablet',
      quantity: 50,
      cost_price: 15.00,
      selling_price: 30.00,
      min_stock_level: 20
    });
    console.log(`Created Pharmacy Inventory Drug ID: ${drugId} (Initial Stock: 50)`);

    const searchHits = dbOps.searchInventory('Ciprofloxacin');
    console.log(`Medication Search Hits: ${searchHits.length} found. Name: ${searchHits[0]?.name}, Stock: ${searchHits[0]?.quantity}`);
    if (searchHits.length === 0 || searchHits[0].quantity !== 50) {
      throw new Error('Medication search failed');
    }
    console.log('  PASSED: Pharmacy inventory search correctly returns drug details and live stock.\n');

    // -------------------------------------------------------------
    // TEST 5: Draft Prescription Creation (MUST NOT DEDUCT STOCK)
    // -------------------------------------------------------------
    console.log('TEST 5: Draft Prescription creation & Stock Invariance check...');
    const initialDrugBeforeRx = dbOps.getInventory().find(i => i.id === drugId);
    console.log(`Stock BEFORE prescription: ${initialDrugBeforeRx.quantity}`);

    const rxItems = [
      {
        medicine_id: drugId,
        is_custom: 0,
        name: 'Ciprofloxacin HCl 500mg',
        dosage: '500mg',
        frequency: 'BD (Twice Daily)',
        duration: '5 days',
        quantity: 15,
        prescribed_qty: 15,
        dispensed_qty: 0,
        selling_price: 30.00
      },
      {
        medicine_id: null,
        is_custom: 1, // CUSTOM MEDICATION
        name: 'Custom Vitamin Formulation B-Comp',
        dosage: '1 capsule',
        frequency: 'OD (Once Daily)',
        duration: '30 days',
        quantity: 30,
        prescribed_qty: 30,
        dispensed_qty: 0,
        selling_price: 0
      }
    ];

    const rxResult = dbOps.createPrescription({
      patient_id: patientId,
      doctor_id: docLogin.id,
      items: rxItems
    });
    console.log(`Prescription created: Rx #${rxResult.id}`);

    // CRITICAL REQUIREMENT VERIFICATION:
    // Adding to prescription MUST NOT deduct stock!
    const drugAfterDraftRx = dbOps.getInventory().find(i => i.id === drugId);
    console.log(`Stock AFTER prescription saved: ${drugAfterDraftRx.quantity}`);
    if (drugAfterDraftRx.quantity !== 50) {
      throw new Error(`CRITICAL FAILURE: Stock decremented during draft prescription! Expected 50, got ${drugAfterDraftRx.quantity}`);
    }
    console.log('  PASSED: Draft prescription creation preserved stock untouched (50 == 50).\n');

    // -------------------------------------------------------------
    // TEST 6: Consultations Module Record Creation & Retrieval
    // -------------------------------------------------------------
    console.log('TEST 6: Consultation record with symptoms, diagnosis & fee...');
    const consultResult = dbOps.createConsultation({
      patient_id: patientId,
      doctor_id: docLogin.id,
      symptoms: 'Mild fever, occasional headache, throat scratchiness',
      diagnosis: 'Viral Pharyngitis',
      notes: 'Advised warm saline gargle and adequate bed rest',
      doctor_fee: 1500.00,
      prescription_id: rxResult.id
    });
    console.log(`Consultation created: #${consultResult.id}`);

    const consultationsList = dbOps.getConsultations(patientId);
    if (consultationsList.length === 0) throw new Error('Failed to retrieve patient consultations');
    const cRec = consultationsList[0];
    console.log(`Retrieved Consultation: Patient="${cRec.patient_name}", Diagnosis="${cRec.diagnosis}", Fee=Rs.${cRec.doctor_fee}, Prescribed Items count=${JSON.parse(cRec.prescription_items).length}`);
    if (cRec.diagnosis !== 'Viral Pharyngitis' || cRec.doctor_fee !== 1500.00) {
      throw new Error('Consultation record fields mismatch');
    }
    console.log('  PASSED: Consultations record successfully persisted and linked to prescription.\n');

    // -------------------------------------------------------------
    // TEST 7: Insufficient Stock Prevention at Dispensing
    // -------------------------------------------------------------
    console.log('TEST 7: Pharmacy Dispensing - Insufficient Stock Prevention...');
    let threwInsufficientError = false;
    try {
      // Attempt to dispense 999 units when stock is only 50
      dbOps.dispensePrescription(
        rxResult.id,
        [
          {
            medicine_id: drugId,
            is_custom: 0,
            quantity_to_dispense: 999,
            selling_price: 5.00
          }
        ],
        1500.00,
        patientId
      );
    } catch (err) {
      threwInsufficientError = true;
      console.log(`  Expected Insufficient Stock caught: "${err.message}"`);
    }

    if (!threwInsufficientError) {
      throw new Error('CRITICAL FAILURE: Dispensing did NOT throw error on insufficient stock!');
    }
    console.log('  PASSED: System blocked negative inventory and threw Insufficient stock warning.\n');

    // -------------------------------------------------------------
    // TEST 8: Successful Dispense & Custom Medicine Handling
    // -------------------------------------------------------------
    console.log('TEST 8: Pharmacy Dispensing - Valid Dispense with Custom & Pharmacy items...');
    // Dispense 15 Paracetamol and 30 Custom capsules
    const dispenseResult = dbOps.dispensePrescription(
      rxResult.id,
      [
        {
          medicine_id: drugId,
          is_custom: 0,
          quantity_to_dispense: 15,
          selling_price: 5.00
        },
        {
          medicine_id: null,
          is_custom: 1,
          quantity_to_dispense: 30,
          selling_price: 0
        }
      ],
      1500.00,
      patientId
    );

    const drugAfterFinalDispense = dbOps.getInventory().find(i => i.id === drugId);
    console.log(`Stock AFTER final dispensing: ${drugAfterFinalDispense.quantity} (Expected: 50 - 15 = 35)`);
    if (drugAfterFinalDispense.quantity !== 35) {
      throw new Error(`Expected stock 35, got ${drugAfterFinalDispense.quantity}`);
    }

    const rxAfterDispense = dbOps.getPrescriptionHistory(patientId)[0];
    console.log(`Prescription Status after dispense: ${rxAfterDispense.status}`);
    if (rxAfterDispense.status !== 'dispensed') {
      throw new Error(`Expected prescription status 'dispensed', got ${rxAfterDispense.status}`);
    }

    // Check financial sales record
    const today = new Date().toISOString().split('T')[0];
    const salesReport = dbOps.getSalesReport(today, today);
    console.log(`Sales Report records generated: ${salesReport.length} transactions`);
    const feeSale = salesReport.find(s => s.type === 'doctor_fee');
    const medSale = salesReport.find(s => s.type === 'medicine' && s.item_ref === drugId);
    if (!feeSale || !medSale) {
      throw new Error('Expected both doctor_fee and medicine entries in sales report');
    }
    console.log(`  Fee recorded: Rs. ${feeSale.amount}, Medicine Sale recorded: Rs. ${medSale.amount}`);
    console.log('  PASSED: Pharmacy dispensing completed with atomic inventory deduction and profit tracking.\n');

    console.log('====================================================');
    console.log('ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY! (8/8)');
    console.log('====================================================');

  } catch (err) {
    console.error('\n❌ VERIFICATION TEST FAILED:', err);
    process.exit(1);
  } finally {
    // Clean up test DB
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch(e){}
    }
    app.quit();
  }
}

app.whenReady().then(runTests);
