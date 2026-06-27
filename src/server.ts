/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import {join} from 'node:path';
import { createClient } from '@supabase/supabase-js';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();

// Enable robust CORS headers to allow Android APKs and third-party mobile webviews to communicate with API endpoints
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,Content-Type,Authorization,Accept,Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Configure body parsers with limits for full photo uploads / database backup size
app.use(express.json({ limit: '65mb' }));
app.use(express.urlencoded({ extended: true, limit: '65mb' }));

const angularApp = new AngularNodeAppEngine();

// Instantiate Supabase client with fallback credentials, sanitizing to prevent duplicate /rest/v1 paths
const rawSupabaseUrl = process.env['SUPABASE_URL'] || 'https://eaclevtsoslnwljwejal.supabase.co';
const supabaseUrl = rawSupabaseUrl.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const supabaseKey = process.env['SUPABASE_KEY'] || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhY2xldnRzb3NsbndsandlamFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3Njk5NTQsImV4cCI6MjA5NzM0NTk1NH0.UhnO7arkrcojV4FOcIuNVyDs3BvJTHewZ2T0BDIr-jA';
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Supabase Web Forms & Ledger Synchronization API Endpoints
 */
app.post('/api/supabase/save', async (req, res) => {
  try {
    const { settings, customers, collections, expenses, employees, collectionGroups, usersList, backupsList } = req.body;

    console.log('\n--- [SUPABASE SAVE REQUEST HANDLER STARTED] ---');
    console.log(`[Config] Target Supabase project API Endpoint URL is: "${supabaseUrl}"`);
    console.log(`[Received Payload Summary]:`);
    console.log(`  - Settings: ${settings ? 'Present' : 'Not Loaded'}`);
    console.log(`  - Customers count: ${customers ? customers.length : 0}`);
    console.log(`  - Collections count: ${collections ? collections.length : 0}`);
    console.log(`  - Expenses count: ${expenses ? expenses.length : 0}`);
    console.log(`  - Employees/Attendance count: ${employees ? employees.length : 0}`);
    console.log(`  - CollectionGroups count: ${collectionGroups ? collectionGroups.length : 0}`);

        // 1. Unified persistence table "sri_finance_store" for schema-less complete backup fidelity.
    const keysToSave = [
      { store_key: 'settings', payload: settings || {} },
      { store_key: 'customers', payload: customers || [] },
      { store_key: 'collections', payload: collections || [] },
      { store_key: 'expenses', payload: expenses || [] },
      { store_key: 'employees', payload: employees || [] },
      { store_key: 'collectionGroups', payload: collectionGroups || [] },
      { store_key: 'usersList', payload: usersList || [] },
      { store_key: 'backupsList', payload: backupsList || [] }
    ];

    let storeUpsertSuccess = false;
    let storeUpsertError = null;

    console.log(`\n[Operations] Starting step 1: Unified persist-all state into table 'sri_finance_store'...`);
    console.log(`[Payload - sri_finance_store]: Serializing ${keysToSave.length} keys to bulk upsert`);
    try {
      const startStoreTime = Date.now();
      const { data, error } = await supabase
        .from('sri_finance_store')
        .upsert(
          keysToSave.map(item => ({
            store_key: item.store_key,
            payload: item.payload,
            updated_at: new Date().toISOString()
          })),
          { onConflict: 'store_key' }
        )
        .select();
      
      const duration = Date.now() - startStoreTime;
      if (!error) {
        storeUpsertSuccess = true;
        console.log(`[Success - sri_finance_store]: Bulk upsert returned successfully in ${duration}ms! Rows impacted/returned: ${data ? data.length : 0}`);
      } else {
        storeUpsertError = error;
        const errMsg = error && typeof error === 'object'
          ? `message="${(error as any).message || ''}" code="${(error as any).code || ''}" details="${(error as any).details || ''}" hint="${(error as any).hint || ''}"`
          : String(error);
        console.warn(`[Warning - sri_finance_store]: DB rejected upsert in ${duration}ms! Details: ${errMsg}`);
      }
    } catch (e) {
      storeUpsertError = e;
      const exceptionMsg = e instanceof Error ? e.message : String(e);
      console.warn(`[Exception - sri_finance_store]: Failed execution!`, exceptionMsg);
    }

    // 2. Relational Mapping: Attempt to write to individual relational tables if they exist in Supabase.
    const relationalUpsertLog: string[] = [];

    // --- CUSTOMERS Sync ---
    if (customers && customers.length > 0) {
      console.log(`\n[Operations] Starting step 2A: Synchronizing 'customers' collection table...`);
      try {
        const sanitizedCustomers = customers.map((c: any) => ({
          id: String(c.id),
          name: String(c.name || ''),
          english_name: c.englishName ? String(c.englishName) : null,
          phone: c.phone ? String(c.phone) : '',
          address: c.address ? String(c.address) : null,
          father_name: c.fatherName ? String(c.fatherName) : null,
          occupation: c.occupation ? String(c.occupation) : null,
          id_proof_type: c.idProofType ? String(c.idProofType) : null,
          id_proof_number: c.idProofNumber ? String(c.idProofNumber) : null,
          profile_photo: c.profilePhoto ? String(c.profilePhoto) : null,
          files_count: c.filesCount !== undefined && c.filesCount !== null ? Number(c.filesCount) : null,
          created_at: c.createdAt || c.created_at || null
        }));

        console.log(`[Payload - customers]: Upserting list with total size ${sanitizedCustomers.length} records`);
        const startCustTime = Date.now();
        const { data, error } = await supabase.from('customers').upsert(sanitizedCustomers, { onConflict: 'id' }).select();
        const duration = Date.now() - startCustTime;

        if (error) {
          console.warn(`[Warning - customers]: Table rejected records! Error: "${error.message}" (Code: ${error.code})`);
          relationalUpsertLog.push(`customers: ${error.message}`);
        } else {
          console.log(`[Success - customers]: Upsert accomplished in ${duration}ms natively! Upserted count: ${data ? data.length : 0}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Exception - customers]: Table runtime crash!`, msg);
        relationalUpsertLog.push(`customers table exception: ${msg}`);
      }
    }

    // --- COLLECTIONS Sync ---
    if (collections && collections.length > 0) {
      console.log(`\n[Operations] Starting step 2B: Synchronizing 'collections' payment ledger table...`);
      try {
        const sanitizedCollections = collections.map((c: any) => ({
          id: String(c.id),
          customer_id: c.customerId ? String(c.customerId) : null,
          customer_name: c.customerName ? String(c.customerName) : null,
          loan_id: c.loanId ? String(c.loanId) : null,
          amount: c.amount !== undefined && c.amount !== null ? Number(c.amount) : null,
          interest_amount: c.interestAmount !== undefined && c.interestAmount !== null ? Number(c.interestAmount) : null,
          principal_amount: c.principalAmount !== undefined && c.principalAmount !== null ? Number(c.principalAmount) : null,
          line_type: c.line ? String(c.line) : null,
          date: c.date ? String(c.date) : null,
          notes: c.notes ? String(c.notes) : null,
          payment_method: c.paymentMethod ? String(c.paymentMethod) : null
        }));

        console.log(`[Payload - collections]: Upserting list with total size ${sanitizedCollections.length} records`);
        const startCollTime = Date.now();
        const { data, error } = await supabase.from('collections').upsert(sanitizedCollections, { onConflict: 'id' }).select();
        const duration = Date.now() - startCollTime;

        if (error) {
          console.warn(`[Warning - collections]: Table rejected records! Error: "${error.message}" (Code: ${error.code})`);
          relationalUpsertLog.push(`collections: ${error.message}`);
        } else {
          console.log(`[Success - collections]: Upsert accomplished in ${duration}ms natively! Upserted count: ${data ? data.length : 0}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Exception - collections]: Table runtime crash!`, msg);
        relationalUpsertLog.push(`collections table exception: ${msg}`);
      }
    }

    // --- EXPENSES Sync ---
    if (expenses && expenses.length > 0) {
      console.log(`\n[Operations] Starting step 2C: Synchronizing 'expenses' ledger table...`);
      try {
        const sanitizedExpenses = expenses.map((e: any) => ({
          id: String(e.id),
          type: e.type ? String(e.type) : null,
          amount: e.amount !== undefined && e.amount !== null ? Number(e.amount) : null,
          date: e.date ? String(e.date) : null,
          description: e.description ? String(e.description) : null
        }));

        console.log(`[Payload - expenses]: Upserting list with total size ${sanitizedExpenses.length} records`);
        const startExpTime = Date.now();
        const { data, error } = await supabase.from('expenses').upsert(sanitizedExpenses, { onConflict: 'id' }).select();
        const duration = Date.now() - startExpTime;

        if (error) {
          console.warn(`[Warning - expenses]: Table rejected records! Error: "${error.message}" (Code: ${error.code})`);
          relationalUpsertLog.push(`expenses: ${error.message}`);
        } else {
          console.log(`[Success - expenses]: Upsert accomplished in ${duration}ms natively! Upserted count: ${data ? data.length : 0}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Exception - expenses]: Table runtime crash!`, msg);
        relationalUpsertLog.push(`expenses table exception: ${msg}`);
      }
    }

    // --- EMPLOYEES & ATTENDANCE Sync ---
    if (employees && employees.length > 0) {
      console.log(`\n[Operations] Starting step 2D: Synchronizing 'employees' (Attendance Register) table...`);
      try {
        const sanitizedEmployees = employees.map((emp: any) => ({
          id: String(emp.id),
          name: String(emp.name || ''),
          role: emp.role ? String(emp.role) : null,
          phone: emp.phone ? String(emp.phone) : '',
          status: emp.status ? String(emp.status) : 'Active',
          collection_group: emp.collectionGroup ? String(emp.collectionGroup) : null,
          salary: emp.salary !== undefined && emp.salary !== null ? Number(emp.salary) : null,
          join_date: emp.joinDate ? String(emp.joinDate) : null
        }));

        console.log(`[Payload - employees / attendance_register]: Upserting list with total size ${sanitizedEmployees.length} records`);
        const startEmpTime = Date.now();
        const { data, error } = await supabase.from('employees').upsert(sanitizedEmployees, { onConflict: 'id' }).select();
        const duration = Date.now() - startEmpTime;

        if (error) {
          console.warn(`[Warning - employees]: Table rejected records! Error: "${error.message}" (Code: ${error.code})`);
          relationalUpsertLog.push(`employees: ${error.message}`);
        } else {
          console.log(`[Success - employees]: Upsert accomplished in ${duration}ms natively! Upserted count: ${data ? data.length : 0}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Exception - employees]: Table runtime crash!`, msg);
        relationalUpsertLog.push(`employees table exception: ${msg}`);
      }
    }

    const storeUpsertErrorMessage = storeUpsertError
      ? (typeof storeUpsertError === 'object'
          ? JSON.stringify(storeUpsertError)
          : String(storeUpsertError))
      : null;

    console.log(`\n--- [SUPABASE SAVE COMPLETED] Success: ${storeUpsertSuccess || relationalUpsertLog.length === 0} ---`);

    res.json({
      success: storeUpsertSuccess || relationalUpsertLog.length === 0,
      storeUpsertSuccess,
      storeUpsertError: storeUpsertErrorMessage,
      relationalUpsertLog
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Error handling save endpoint:', msg);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/supabase/load', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sri_finance_store')
      .select('store_key, payload');

    if (error) {
      console.warn('Unified store load warning:', error.message);
      res.status(200).json({ success: false, error: error.message });
      return;
    }

    if (!data || data.length === 0) {
      res.json({ success: true, empty: true });
      return;
    }

    const state: Record<string, unknown> = {};
    data.forEach((row) => {
      const r = row as { store_key: string; payload: unknown };
      state[r.store_key] = r.payload;
    });

    res.json({
      success: true,
      data: state
    });
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Error handling load endpoint:', msg);
    res.status(500).json({ error: msg });
    return;
  }
});

app.put('/api/supabase/update', async (req, res) => {
  try {
    const { store_key, payload, table, record } = req.body;
    console.log(`\n--- [SUPABASE UPDATE ENDPOINT TRIGGERED] ---`);
    console.log(`Store Key: ${store_key}, Table: ${table}`);

    if (store_key && payload) {
      const { error } = await supabase
        .from('sri_finance_store')
        .upsert({ store_key, payload, updated_at: new Date().toISOString() }, { onConflict: 'store_key' });

      if (error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
    }

    if (table && record && record.id) {
      const { error } = await supabase
        .from(table)
        .upsert(record, { onConflict: 'id' });

      if (error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
    }

    res.json({ success: true, message: 'Updated successfully' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

app.delete('/api/supabase/delete', async (req, res) => {
  try {
    const { store_key, table, id } = req.body;
    console.log(`\n--- [SUPABASE DELETE ENDPOINT TRIGGERED] ---`);
    console.log(`Store Key: ${store_key}, Table: ${table}, ID: ${id}`);

    if (store_key) {
      const { error } = await supabase
        .from('sri_finance_store')
        .delete()
        .eq('store_key', store_key);

      if (error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
    }

    if (table && id) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', id);

      if (error) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
    }

    res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

app.get('/api/supabase/test', async (req, res) => {
  try {
    console.log('\n--- [SUPABASE DIAGNOSTIC TEST ENDPOINT TRIGGERED] ---');
    const urlSet = !!process.env['SUPABASE_URL'] || supabaseUrl.includes('supabase.co');
    const keySet = !!process.env['SUPABASE_KEY'] || supabaseKey.length > 25;
    
    console.log(`[Config] Checking Supabase Credentials Status:`);
    console.log(`  - SUPABASE_URL: ${urlSet ? 'Configured (' + supabaseUrl + ')' : 'MISSING'}`);
    console.log(`  - SUPABASE_KEY: ${keySet ? 'Configured (Length: ' + supabaseKey.length + ')' : 'MISSING'}`);
    
    const startTime = Date.now();
    const { data, error } = await supabase
      .from('sri_finance_store')
      .select('store_key, updated_at')
      .limit(1);
    const duration = Date.now() - startTime;
    
    if (error) {
      console.warn(`[Diagnostics] Database rejected ping request in ${duration}ms! Error: "${error.message}" (Code: ${error.code})`);
      res.json({
        success: false,
        urlSet,
        keySet,
        supabaseUrl,
        supabasePingMs: duration,
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
    } else {
      console.log(`[Diagnostics] Database ping completed successfully in ${duration}ms! Data returned count: ${data ? data.length : 0}`);
      res.json({
        success: true,
        urlSet,
        keySet,
        supabaseUrl,
        supabasePingMs: duration,
        storeRowsCount: data ? data.length : 0
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Diagnostics] Server encountered critical exception during test:', msg);
    res.status(500).json({
      success: false,
      error: msg
    });
  }
});


/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
