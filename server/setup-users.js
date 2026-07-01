require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

const ADMIN_EMAIL = 'admin@lions321c1.org';
const ADMIN_PASSWORD = 'LionsAdmin@2026';
const MEMBER_EMAIL = 'member@lions321c1.org';
const MEMBER_PASSWORD = 'LionsMember@2026';

async function main() {
    console.log('\n=== Setting up test users ===\n');

    // ---- Create admin user ----
    console.log('Creating admin user...');
    
    // Check if admin user already exists
    let adminUserId = null;
    const { data: existingAdmin } = await supabase
        .from('members')
        .select('id, clerk_user_id')
        .eq('clerk_user_id', ADMIN_EMAIL) // fallback check by email
        .maybeSingle();
    
    if (!existingAdmin) {
        // Create in Supabase Auth
        const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
            email: ADMIN_EMAIL,
            password: ADMIN_PASSWORD,
            email_confirm: true,
            user_metadata: { full_name: 'District Admin' }
        });

        if (authErr) {
            if (authErr.message.includes('already been registered')) {
                console.log('  Admin auth user already exists, fetching...');
                // Find existing user by email
                const { data: users } = await supabase.auth.admin.listUsers();
                const existing = (users?.users || []).find(u => u.email === ADMIN_EMAIL);
                if (existing) adminUserId = existing.id;
            } else {
                console.error('  Failed to create admin auth user:', authErr.message);
            }
        } else {
            adminUserId = authUser.user.id;
            console.log('  Admin auth user created:', authUser.user.email);
        }
    } else {
        adminUserId = existingAdmin.clerk_user_id;
        console.log('  Admin member record already exists.');
    }

    if (adminUserId) {
        // Create/update member record
        const { data: memberRecord } = await supabase
            .from('members')
            .select('id')
            .eq('clerk_user_id', adminUserId)
            .maybeSingle();

        if (!memberRecord) {
            const { error: insertErr } = await supabase
                .from('members')
                .insert([{
                    clerk_user_id: adminUserId,
                    name: 'District Admin',
                    email: ADMIN_EMAIL,
                    role: 'admin',
                    status: 'active',
                    club: 'District 321 C1 Office',
                    designation: 'District Administrator',
                    location: 'Patna',
                    show_phone: true,
                    show_email: true
                }]);
            if (insertErr) {
                console.error('  Failed to create admin member record:', insertErr.message);
            } else {
                console.log('  Admin member record created with role: admin');
            }
        } else {
            // Ensure role is correct
            await supabase.from('members')
                .update({ role: 'admin', status: 'active' })
                .eq('clerk_user_id', adminUserId);
            console.log('  Admin member record updated.');
        }
    }

    // ---- Create member user ----
    console.log('\nCreating member user...');

    let memberUserId = null;
    const { data: existingMember } = await supabase
        .from('members')
        .select('id, clerk_user_id')
        .eq('clerk_user_id', MEMBER_EMAIL)
        .maybeSingle();

    if (!existingMember) {
        const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
            email: MEMBER_EMAIL,
            password: MEMBER_PASSWORD,
            email_confirm: true,
            user_metadata: { full_name: 'Test Member' }
        });

        if (authErr) {
            if (authErr.message.includes('already been registered')) {
                console.log('  Member auth user already exists, fetching...');
                const { data: users } = await supabase.auth.admin.listUsers();
                const existing = (users?.users || []).find(u => u.email === MEMBER_EMAIL);
                if (existing) memberUserId = existing.id;
            } else {
                console.error('  Failed to create member auth user:', authErr.message);
            }
        } else {
            memberUserId = authUser.user.id;
            console.log('  Member auth user created:', authUser.user.email);
        }
    } else {
        memberUserId = existingMember.clerk_user_id;
        console.log('  Member record already exists.');
    }

    if (memberUserId) {
        const { data: memberRecord } = await supabase
            .from('members')
            .select('id')
            .eq('clerk_user_id', memberUserId)
            .maybeSingle();

        if (!memberRecord) {
            const { error: insertErr } = await supabase
                .from('members')
                .insert([{
                    clerk_user_id: memberUserId,
                    name: 'Test Member',
                    email: MEMBER_EMAIL,
                    role: 'member',
                    status: 'active',
                    club: 'Lions Club Patna Central',
                    designation: 'Member',
                    location: 'Patna',
                    profession: 'Engineer',
                    show_phone: true,
                    show_email: false
                }]);
            if (insertErr) {
                console.error('  Failed to create member record:', insertErr.message);
            } else {
                console.log('  Member record created with role: member');
            }
        } else {
            await supabase.from('members')
                .update({ role: 'member', status: 'active' })
                .eq('clerk_user_id', memberUserId);
            console.log('  Member record updated.');
        }
    }

    // ---- Summary ----
    console.log('\n==========================================');
    console.log('  Test Users Ready');
    console.log('==========================================');
    console.log('');
    console.log('  Admin:');
    console.log('    Email:    ' + ADMIN_EMAIL);
    console.log('    Password: ' + ADMIN_PASSWORD);
    console.log('    Role:     admin');
    console.log('');
    console.log('  Member:');
    console.log('    Email:    ' + MEMBER_EMAIL);
    console.log('    Password: ' + MEMBER_PASSWORD);
    console.log('    Role:     member');
    console.log('');
    console.log('  Start the server: npm start');
    console.log('  Then open http://localhost:3000');
    console.log('');
}

main().catch(e => console.error('Fatal:', e.message));
