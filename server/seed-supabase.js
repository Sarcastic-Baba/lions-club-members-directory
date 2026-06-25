require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const members = [
    { name: 'Rajesh Kumar', club: 'Lions Club Patna Central', designation: 'President', location: 'Patna', profession: 'Advocate', phone: '+91-9876543210', email: 'rajesh.kumar@lions321c1.org', address: '12, Gandhi Maidan Road, Patna, Bihar' },
    { name: 'Sunita Sharma', club: 'Lions Club Gaya', designation: 'Secretary', location: 'Gaya', profession: 'Doctor', phone: '+91-9876543211', email: 'sunita.sharma@lions321c1.org', address: '45, Medical College Road, Gaya, Bihar' },
    { name: 'Amit Verma', club: 'Lions Club Muzaffarpur', designation: 'Treasurer', location: 'Muzaffarpur', profession: 'Chartered Accountant', phone: '+91-9876543212', email: 'amit.verma@lions321c1.org', address: '78, Company Bagh, Muzaffarpur, Bihar' },
    { name: 'Priya Singh', club: 'Lions Club Patna Mahila', designation: 'Member', location: 'Patna', profession: 'Teacher', phone: '+91-9876543213', email: 'priya.singh@lions321c1.org', address: '34, Boring Road, Patna, Bihar' },
    { name: 'Vikash Anand', club: 'Lions Club Bhagalpur', designation: 'Vice President', location: 'Bhagalpur', profession: 'Businessman', phone: '+91-9876543214', email: 'vikash.anand@lions321c1.org', address: '56, MG Road, Bhagalpur, Bihar' },
    { name: 'Meena Devi', club: 'Lions Club Darbhanga', designation: 'Joint Secretary', location: 'Darbhanga', profession: 'Social Worker', phone: '+91-9876543215', email: 'meena.devi@lions321c1.org', address: '23, Laheriasarai, Darbhanga, Bihar' },
    { name: 'Dr. Suresh Prasad', club: 'Lions Club Patna East', designation: 'Member', location: 'Patna', profession: 'Doctor', phone: '+91-9876543216', email: 'suresh.prasad@lions321c1.org', address: '89, Kankarbagh, Patna, Bihar' },
    { name: 'Anjali Gupta', club: 'Lions Club Hajipur', designation: 'Member', location: 'Hajipur', profession: 'Engineer', phone: '+91-9876543217', email: 'anjali.gupta@lions321c1.org', address: '12, Industrial Area, Hajipur, Bihar' },
    { name: 'Ravi Ranjan', club: 'Lions Club Purnia', designation: 'President', location: 'Purnia', profession: 'Businessman', phone: '+91-9876543218', email: 'ravi.ranjan@lions321c1.org', address: '67, Line Bazar, Purnia, Bihar' },
    { name: 'Kavita Jha', club: 'Lions Club Patna West', designation: 'Treasurer', location: 'Patna', profession: 'Chartered Accountant', phone: '+91-9876543219', email: 'kavita.jha@lions321c1.org', address: '90, Bailey Road, Patna, Bihar' },
    { name: 'Manoj Tiwari', club: 'Lions Club Samastipur', designation: 'Secretary', location: 'Samastipur', profession: 'Professor', phone: '+91-9876543220', email: 'manoj.tiwari@lions321c1.org', address: '34, College Road, Samastipur, Bihar' },
    { name: 'Rekha Sinha', club: 'Lions Club Patna Mahila', designation: 'Vice President', location: 'Patna', profession: 'Advocate', phone: '+91-9876543221', email: 'rekha.sinha@lions321c1.org', address: '56, Patna High Court, Patna, Bihar' },
    { name: 'Arun Kumar', club: 'Lions Club Chapra', designation: 'Member', location: 'Chapra', profession: 'Pharmacist', phone: '+91-9876543222', email: 'arun.kumar@lions321c1.org', address: '78, Sadar Bazar, Chapra, Bihar' },
    { name: 'Nisha Kumari', club: 'Lions Club Motihari', designation: 'Member', location: 'Motihari', profession: 'Teacher', phone: '+91-9876543223', email: 'nisha.kumari@lions321c1.org', address: '12, Bapudham, Motihari, Bihar' },
    { name: 'Sanjay Singh', club: 'Lions Club Patna Central', designation: 'Member', location: 'Patna', profession: 'Engineer', phone: '+91-9876543224', email: 'sanjay.singh@lions321c1.org', address: '34, Rajendra Nagar, Patna, Bihar' }
];

async function seed() {
    console.log('Creating members table and seeding data...\n');

    // Create table via REST (Supabase allows SQL via REST with service_role key)
    const sql = `
        CREATE TABLE IF NOT EXISTS members (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            club TEXT,
            designation TEXT,
            location TEXT,
            profession TEXT,
            phone TEXT,
            email TEXT,
            address TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    `;

    // Try creating the table via Supabase's SQL endpoint
    try {
        const fetch = (await import('node-fetch')).default || globalThis.fetch;
    } catch (_) {}

    // Use the REST API to execute SQL
    const https = require('https');
    const url = new URL(process.env.SUPABASE_URL + '/rest/v1/rpc/exec_sql');

    // First insert approach: just try inserting and let it create table if needed
    // Actually, let's just try inserting - if table doesn't exist, we'll tell user to run SQL
    console.log('Inserting members...');
    const { data, error } = await supabase.from('members').insert(members).select('id');

    if (error) {
        console.log('FAILED:', error.message);
        console.log('\nThe members table does not exist. Options:');
        console.log('  1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/qexxpyezmqjpigiievpq');
        console.log('  2. Open SQL Editor');
        console.log('  3. Paste and run the contents of data/supabase-schema.sql');
        return;
    }

    console.log('SUCCESS: Inserted', data.length, 'members!\n');
    console.log('First 3 entries:');
    for (let i = 0; i < Math.min(3, data.length); i++) {
        console.log('  -', members[i].name, '(' + members[i].designation + ')');
    }
}

seed().catch(e => console.error('Seed error:', e));
