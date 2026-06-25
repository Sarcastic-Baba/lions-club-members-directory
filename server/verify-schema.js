require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verify() {
    console.log('=== Schema Verification ===\n');

    // Check all table structures by fetching one row
    const tables = ['members', 'pending_claims', 'member_professions', 'posts', 'post_reactions', 'post_comments', 'post_reports'];

    for (const table of tables) {
        const { data, error } = await supabase
            .from(table)
            .select('*')
            .limit(1);

        if (error) {
            console.error(`  ${table}: ERROR - ${error.message}`);
        } else if (data && data.length > 0) {
            const columns = Object.keys(data[0]);
            console.log(`  ${table}: ${columns.length} columns - [${columns.join(', ')}]`);
        } else {
            console.log(`  ${table}: exists (0 rows)`);
        }
    }

    // Check if members has PRD columns
    console.log('\n=== Checking PRD columns on members ===');
    const { data: member } = await supabase
        .from('members')
        .select('lion_id, full_name, club_name, city, years_as_lion, role, status, show_phone, show_email, can_post_until, profile_photo_url, updated_at')
        .limit(1);

    if (member && member.length > 0) {
        console.log('  PRD columns present:', Object.keys(member[0]).join(', '));
    } else {
        // Try to get the columns by querying for them individually to see errors
        const fields = ['lion_id', 'full_name', 'club_name', 'city', 'years_as_lion', 'role', 'status', 'show_phone', 'show_email', 'can_post_until', 'profile_photo_url', 'updated_at'];
        for (const f of fields) {
            const { error } = await supabase.from('members').select(f).limit(1);
            console.log(`    ${f}: ${error ? 'MISSING (' + error.message + ')' : 'OK'}`);
        }
    }

    // Check indexes
    console.log('\n=== Checking indexes ===');
    const { data: indexes, error: idxErr } = await supabase.rpc('exec_sql', {
        sql: "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%trgm%' OR indexname = 'idx_posts_created'"
    }).maybeSingle();

    if (idxErr) {
        console.log('  (could not query indexes via RPC)');
    }

    // Check storage
    console.log('\n=== Storage buckets ===');
    const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();
    if (!bucketErr && buckets) {
        buckets.forEach(b => console.log(`  ${b.name}: public=${b.public}`));
    }
}

verify().catch(console.error);
