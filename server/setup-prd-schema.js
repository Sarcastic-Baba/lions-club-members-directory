require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { createClient } = require('@supabase/supabase-js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_REF = 'qexxpyezmqjpigiievpq';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY || !SUPABASE_URL) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in server/.env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const SQL_EDITOR_URL = `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`;

async function checkTable(table) {
    const { data, error } = await supabase
        .from(table)
        .select('*')
        .limit(1);
    if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('not found')) {
            return { exists: false, reason: error.message };
        }
        return { exists: false, reason: error.message };
    }
    // Try to get column count
    if (data && data.length > 0) {
        const cols = Object.keys(data[0]);
        return { exists: true, columns: cols.length, sample: cols };
    }
    return { exists: true, columns: 0 };
}

async function checkColumn(table, column) {
    const { error } = await supabase.from(table).select(column).limit(1);
    if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('does not exist')) return false;
    }
    return true;
}

async function main() {
    console.log('\n==========================================');
    console.log('  Lions Club 321 C1 — PRD Schema Setup');
    console.log('==========================================');
    console.log('  Project: ' + PROJECT_REF);
    console.log('  DB: ' + SUPABASE_URL);

    // Check what's missing
    console.log('\n--- Checking current schema ---\n');

    const missing = [];

    // Check tables
    for (const table of ['members', 'pending_claims', 'member_professions', 'posts', 'post_reactions', 'post_comments', 'post_reports']) {
        const result = await checkTable(table);
        if (result.exists) {
            console.log(`  ${table}: OK (${result.columns} columns${result.sample ? ': ' + result.sample.join(', ') : ''})`);
        } else {
            console.log(`  ${table}: MISSING — ${result.reason}`);
            if (table !== 'members') missing.push(`table:${table}`);
        }
    }

    // Check PRD columns on members
    console.log('');
    const prdColumns = ['lion_id', 'full_name', 'club_name', 'city', 'years_as_lion'];
    for (const col of prdColumns) {
        const exists = await checkColumn('members', col);
        if (!exists) {
            console.log(`  members.${col}: MISSING`);
            missing.push(`column:members.${col}`);
        } else {
            console.log(`  members.${col}: OK`);
        }
    }

    // Check feed-related columns
    console.log('');
    const feedColumns = ['role', 'status', 'profile_photo_url', 'show_phone', 'show_email', 'can_post_until', 'updated_at'];
    for (const col of feedColumns) {
        const exists = await checkColumn('members', col);
        console.log(`  members.${col}: ${exists ? 'OK' : 'MISSING'}`);
        if (!exists) missing.push(`column:members.${col}`);
    }

    // Check storage
    console.log('');
    const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();
    if (!bucketErr && buckets) {
        for (const name of ['post-images', 'profile-photos']) {
            const found = buckets.find(b => b.name === name);
            console.log(`  storage:${name}: ${found ? 'OK' : 'MISSING'}`);
            if (!found) missing.push(`bucket:${name}`);
        }
    }

    if (missing.length === 0) {
        console.log('\n  All PRD schema elements are in place!');
        process.exit(0);
    }

    console.log(`\n  ${missing.length} items need to be created: ${missing.join(', ')}`);

    console.log('\n==========================================');
    console.log('  TO CREATE MISSING SCHEMA — 2 OPTIONS');
    console.log('==========================================\n');

    console.log('  Option 1: Supabase Dashboard (recommended)');
    console.log('    1. Open: ' + SQL_EDITOR_URL);
    console.log('    2. Paste the contents of: data\\supabase-prd-schema.sql');
    console.log('    3. Click "Run" (the SQL is idempotent — safe to re-run)\n');

    console.log('  Option 2: Run this command to copy SQL to clipboard:');
    console.log('    Get-Content data\\supabase-prd-schema.sql | Set-Clipboard');
    console.log('    Then paste into the SQL Editor at ' + SQL_EDITOR_URL + '\n');

    console.log('  After running the SQL, verify with:');
    console.log('    node server\\setup-prd-schema.js\n');

    // Open SQL editor in browser
    try {
        exec('start "" "' + SQL_EDITOR_URL + '"');
        console.log('  (Browser opened to Supabase SQL Editor)\n');
    } catch (e) {}

    console.log('==========================================\n');
}

main().catch((e) => {
    console.error('\nFatal error:', e.message);
    process.exit(1);
});
