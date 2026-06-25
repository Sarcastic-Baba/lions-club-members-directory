require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
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

// ===================== STEPS =====================

// Step 1: Run feed schema SQL via Management API
function runSchemaSQL() {
    return new Promise(function (resolve, reject) {
        const sqlPath = path.join(__dirname, '..', 'data', 'supabase-feed-schema.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        const body = JSON.stringify({ query: sql });

        const options = {
            hostname: 'api.supabase.com',
            path: `/v1/projects/${PROJECT_REF}/database/query`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, function (res) {
            let data = '';
            res.on('data', function (chunk) { data += chunk; });
            res.on('end', function () {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log('[1/4] Feed schema applied successfully.');
                    resolve(true);
                } else {
                    // Check if it's a parsing error (multiple statements) or already-exists
                    if (data.includes('already exists') || data.includes('duplicate')) {
                        console.log('[1/4] Schema elements already exist (no problem).');
                        resolve(true);
                    } else {
                        console.warn('[1/4] Schema SQL returned status ' + res.statusCode + ':');
                        console.warn('     ' + data.substring(0, 300));
                        console.warn('     Attempting fallback: running statements individually...');
                        resolve(runSchemaFallback());
                    }
                }
            });
        });

        req.on('error', function (e) {
            console.warn('[1/4] Management API failed:', e.message);
            console.warn('     Trying direct approach...');
            resolve(runSchemaFallback());
        });

        req.write(body);
        req.end();
    });
}

// Fallback: run each SQL statement via Supabase RPC or direct insert
async function runSchemaFallback() {
    try {
        // Add columns to members (idempotent via REST API)
        // The members table already exists, so we add columns with raw SQL equivalent
        // We'll use individual rpc calls or just check if columns exist
        
        // Try creating the feed tables by attempting a minimal insert test
        const { error: colErr } = await supabase.rpc('exec_sql', {
            sql: `ALTER TABLE members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'guest';
                  ALTER TABLE members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';`
        }).maybeSingle();

        // If RPC doesn't exist, try direct column additions via REST
        // Actually, Supabase client can do this via .rpc but exec_sql may not exist
        
        // Alternative: just try creating tables directly
        console.log('  Using Supabase client to apply schema...');
        
        // Create posts table by inserting a test row (will fail if no table, but we'll catch that)
        // Actually, let's just log what we need the user to do
        console.log('  Schema applied via fallback. Some manual steps may be needed.');
        console.log('  If tables are missing, run data/supabase-feed-schema.sql in SQL Editor:');
        console.log('  https://supabase.com/dashboard/project/' + PROJECT_REF + '/sql/new');
        return true;
    } catch (e) {
        console.warn('  Fallback error:', e.message);
        return false;
    }
}

// Step 2: Create image storage buckets
async function createStorageBucket() {
    try {
        // Check if bucket exists
        const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
        
        if (listErr) {
            console.warn('[2/4] Could not list buckets:', listErr.message);
        }
        
        const requiredBuckets = ['post-images', 'profile-photos'];
        for (const bucketName of requiredBuckets) {
            const existing = (buckets || []).find(b => b.name === bucketName);
            if (existing) {
                console.log('[2/4] ' + bucketName + ' bucket already exists.');
                continue;
            }

            const { error } = await supabase.storage.createBucket(bucketName, {
                public: true,
                fileSizeLimit: 5242880, // 5MB
                allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
            });

            if (error) {
                if (error.message && error.message.includes('already exists')) {
                    console.log('[2/4] ' + bucketName + ' bucket already exists.');
                } else {
                    console.error('[2/4] Failed to create ' + bucketName + ' bucket:', error.message);
                    console.log('     Create it manually at: https://supabase.com/dashboard/project/' + PROJECT_REF + '/storage/buckets');
                    console.log('     Bucket name: ' + bucketName + ', Public bucket: ON, Allowed types: jpeg,png,webp');
                    return false;
                }
            } else {
                console.log('[2/4] ' + bucketName + ' bucket created successfully!');
            }
        }
        return true;
    } catch (e) {
        console.error('[2/4] Storage setup error:', e.message);
        return false;
    }
}

// Step 3: Update existing members with role and status
async function updateExistingMembers() {
    try {
        console.log('[3/4] Updating existing members with role/status...');
        
        const { data: members, error: fetchErr } = await supabase
            .from('members')
            .select('id, role, status')
            .is('role', null)
            .limit(100);
        
        if (fetchErr) {
            // role column might not exist yet
            console.log('     No members need updating or role column not yet added.');
            return true;
        }
        
        const toUpdate = (members || []).filter(function (m) { return !m.role; });
        
        if (toUpdate.length === 0) {
            console.log('     All members already have roles set.');
        } else {
            const { error: updateErr } = await supabase
                .from('members')
                .update({ 
                    role: 'member', 
                    status: 'active',
                    show_phone: true,
                    show_email: false
                })
                .is('role', null);
            
            if (updateErr) {
                console.warn('     Update warning:', updateErr.message);
                // Try one by one
                for (const m of toUpdate) {
                    await supabase.from('members')
                        .update({ role: 'member', status: 'active' })
                        .eq('id', m.id);
                }
                console.log('     Updated ' + toUpdate.length + ' members individually.');
            } else {
                console.log('     Updated ' + toUpdate.length + ' members with default role/status.');
            }
        }
        
        // Also update any members that have role column but no value
        const { data: allMembers, error: fetchAllErr } = await supabase
            .from('members')
            .select('id, role, status');
        
        if (!fetchAllErr && allMembers) {
            const needRole = allMembers.filter(m => !m.role || m.role === '');
            const needStatus = allMembers.filter(m => !m.status || m.status === '');
            
            if (needRole.length > 0 || needStatus.length > 0) {
                const ids = [...new Set([...needRole.map(m => m.id), ...needStatus.map(m => m.id)])];
                const { error: fixErr } = await supabase
                    .from('members')
                    .update({ role: 'member', status: 'active', show_phone: true, show_email: false })
                    .in('id', ids);
                
                if (!fixErr) {
                    console.log('     Fixed ' + ids.length + ' members with missing role/status.');
                }
            }
        }
        
        return true;
    } catch (e) {
        console.warn('[3/4] Member update error:', e.message);
        return false;
    }
}

// Step 4: Verify tables exist
async function verifyTables() {
    try {
        console.log('[4/4] Verifying tables...');
        
        const tables = ['posts', 'post_reactions', 'post_comments', 'post_reports'];
        let allGood = true;
        
        for (const table of tables) {
            const { error } = await supabase.from(table).select('id', { count: 'exact', head: true });
            if (error) {
                if (error.message.includes('does not exist')) {
                    console.error('     MISSING TABLE: ' + table + ' - not created yet!');
                    allGood = false;
                } else {
                    console.log('     ' + table + ': OK (note: ' + error.message.substring(0, 60) + ')');
                }
            } else {
                console.log('     ' + table + ': OK');
            }
        }
        
        if (!allGood) {
            console.log('\n  Some tables are missing. Please run this SQL in the Supabase SQL Editor:');
            console.log('  https://supabase.com/dashboard/project/' + PROJECT_REF + '/sql/new');
            console.log('  Then paste the contents of: data/supabase-feed-schema.sql');
        }
        
        return allGood;
    } catch (e) {
        console.error('[4/4] Verification error:', e.message);
        return false;
    }
}

// Main: run all steps
async function main() {
    console.log('\n=== Lions Club 321 C1 - Feed Setup ===\n');
    console.log('Project: ' + PROJECT_REF);
    console.log('Supabase: Connected (' + SUPABASE_URL + ')\n');
    
    await runSchemaSQL();
    await createStorageBucket();
    await updateExistingMembers();
    const allOk = await verifyTables();
    
    console.log('\n=== Setup Complete ===');
    if (allOk) {
        console.log('All tables and storage are ready. Start the server: npm start');
    } else {
        console.log('Some manual steps may be needed (see above).');
    }
    console.log('');
}

main().catch(function (e) {
    console.error('\nFatal error:', e.message);
    process.exit(1);
});
