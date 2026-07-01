require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { createClient } = require('@supabase/supabase-js');

const results = {};

function check(name, ok, detail) {
    results[name] = { ok, detail };
    const icon = ok ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${name}${detail ? ': ' + detail : ''}`);
}

async function run() {
    console.log('Testing API keys...\n');

    // 1. Supabase Database
    console.log('--- Supabase Database ---');
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        check('Supabase URL', false, 'Missing SUPABASE_URL');
        check('Supabase Key', false, 'Missing SUPABASE_SERVICE_ROLE_KEY');
    } else {
        check('Supabase URL', supabaseUrl.includes('.supabase.co'), supabaseUrl);
        check('Supabase Key', supabaseKey.startsWith('eyJ'), 'JWT format looks valid');

        try {
            const supabase = createClient(supabaseUrl, supabaseKey);
            const { data, error } = await supabase.from('members').select('id').limit(1);
            if (error) {
                check('Supabase DB Query', false, error.message);
                if (error.message.includes('relation') && error.message.includes('does not exist')) {
                    console.log('    -> The "members" table does not exist yet. Run data/supabase-prd-schema.sql in Supabase SQL Editor.');
                }
            } else {
                check('Supabase DB Query', true, `Connected, found ${data.length} row(s)`);
            }
        } catch (e) {
            check('Supabase DB Connection', false, e.message);
        }
    }

    // 2. Clerk
    console.log('\n--- Clerk ---');
    const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY;
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;

    if (!clerkPublishableKey || clerkPublishableKey === 'your_clerk_publishable_key_here') {
        check('Clerk Publishable Key', false, 'Not configured (placeholder key)');
    } else {
        check('Clerk Publishable Key', clerkPublishableKey.startsWith('pk_'), clerkPublishableKey.substring(0, 12) + '...');
    }

    if (!clerkSecretKey || clerkSecretKey === 'your_clerk_secret_key_here') {
        check('Clerk Secret Key', false, 'Not configured (placeholder key)');
    } else {
        check('Clerk Secret Key', clerkSecretKey.startsWith('sk_'), clerkSecretKey.substring(0, 12) + '...');
    }

    // 3. OpenRouter
    console.log('\n--- OpenRouter ---');
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterKey || openrouterKey === 'your_openrouter_api_key_here') {
        check('OpenRouter API', false, 'Not configured (placeholder key)');
    } else {
        check('OpenRouter Key', true, openrouterKey.substring(0, 10) + '...');
    }

    console.log('\n=== Summary ===');
    let pass = 0, fail = 0;
    for (const [name, r] of Object.entries(results)) {
        if (r.ok) pass++; else fail++;
    }
    console.log(`  Passed: ${pass}, Failed: ${fail}`);
    if (fail === 0) console.log('  All checks passed!');
    else console.log('  Fix the FAIL items above.');
}

run().catch(e => console.error('Test failed:', e));
