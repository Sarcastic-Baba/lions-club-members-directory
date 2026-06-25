require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const https = require('https');

const projectRef = 'qexxpyezmqjpigiievpq';
const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sql = `
ALTER TABLE IF EXISTS members ADD COLUMN IF NOT EXISTS clerk_user_id TEXT UNIQUE;
ALTER TABLE IF EXISTS members ADD COLUMN IF NOT EXISTS specialty TEXT;
ALTER TABLE IF EXISTS members ADD COLUMN IF NOT EXISTS year_of_joining INTEGER;

CREATE TABLE IF NOT EXISTS members (
    id SERIAL PRIMARY KEY,
    clerk_user_id TEXT UNIQUE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    profession TEXT,
    specialty TEXT,
    club TEXT,
    designation TEXT,
    location TEXT,
    year_of_joining INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE members ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read members') THEN
        CREATE POLICY "Anyone can read members" ON members FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can create their profile') THEN
        CREATE POLICY "Users can create their profile" ON members FOR INSERT TO authenticated WITH CHECK (clerk_user_id = auth.uid()::text);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own profile') THEN
        CREATE POLICY "Users can update own profile" ON members FOR UPDATE TO authenticated USING (clerk_user_id = auth.uid()::text);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own profile') THEN
        CREATE POLICY "Users can delete own profile" ON members FOR DELETE TO authenticated USING (clerk_user_id = auth.uid()::text);
    END IF;
END $$;
`;

const body = JSON.stringify({ query: sql });

const options = {
    hostname: 'api.supabase.com',
    path: `/v1/projects/${projectRef}/database/query`,
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
    }
};

const req = https.request(options, function (res) {
    let data = '';
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function () {
        console.log('Status:', res.statusCode);
        if (res.statusCode === 200 || res.statusCode === 201) {
            console.log('Table created successfully!');
            // Now seed data
            seedData();
        } else {
            console.log('Response:', data.substring(0, 500));
            console.log('\nCould not create table via API. Please run data/supabase-schema.sql manually in the Supabase SQL Editor.');
            console.log('URL: https://supabase.com/dashboard/project/' + projectRef + '/sql/new');
        }
    });
});

req.on('error', function (e) {
    console.log('Error:', e.message);
    console.log('\nPlease run data/supabase-schema.sql manually in the Supabase SQL Editor.');
});

req.write(body);
req.end();

function seedData() {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const members = [
        { name: 'Rajesh Kumar', email: 'rajesh.kumar@lions321c1.org', phone: '+91-9876543210', address: '12, Gandhi Maidan Road, Patna, Bihar', profession: 'Advocate', specialty: 'Criminal Law', club: 'Lions Club Patna Central', designation: 'President', location: 'Patna', year_of_joining: 2010 },
        { name: 'Sunita Sharma', email: 'sunita.sharma@lions321c1.org', phone: '+91-9876543211', address: '45, Medical College Road, Gaya, Bihar', profession: 'Doctor', specialty: 'General Medicine', club: 'Lions Club Gaya', designation: 'Secretary', location: 'Gaya', year_of_joining: 2012 },
        { name: 'Amit Verma', email: 'amit.verma@lions321c1.org', phone: '+91-9876543212', address: '78, Company Bagh, Muzaffarpur, Bihar', profession: 'Chartered Accountant', specialty: 'Auditing & Taxation', club: 'Lions Club Muzaffarpur', designation: 'Treasurer', location: 'Muzaffarpur', year_of_joining: 2015 },
        { name: 'Priya Singh', email: 'priya.singh@lions321c1.org', phone: '+91-9876543213', address: '34, Boring Road, Patna, Bihar', profession: 'Teacher', specialty: 'Mathematics', club: 'Lions Club Patna Mahila', designation: 'Member', location: 'Patna', year_of_joining: 2018 },
        { name: 'Vikash Anand', email: 'vikash.anand@lions321c1.org', phone: '+91-9876543214', address: '56, MG Road, Bhagalpur, Bihar', profession: 'Businessman', specialty: 'Textile Industry', club: 'Lions Club Bhagalpur', designation: 'Vice President', location: 'Bhagalpur', year_of_joining: 2011 },
        { name: 'Meena Devi', email: 'meena.devi@lions321c1.org', phone: '+91-9876543215', address: '23, Laheriasarai, Darbhanga, Bihar', profession: 'Social Worker', specialty: 'Women Empowerment', club: 'Lions Club Darbhanga', designation: 'Joint Secretary', location: 'Darbhanga', year_of_joining: 2013 },
        { name: 'Dr. Suresh Prasad', email: 'suresh.prasad@lions321c1.org', phone: '+91-9876543216', address: '89, Kankarbagh, Patna, Bihar', profession: 'Doctor', specialty: 'Cardiology', club: 'Lions Club Patna East', designation: 'Member', location: 'Patna', year_of_joining: 2014 },
        { name: 'Anjali Gupta', email: 'anjali.gupta@lions321c1.org', phone: '+91-9876543217', address: '12, Industrial Area, Hajipur, Bihar', profession: 'Engineer', specialty: 'Civil Engineering', club: 'Lions Club Hajipur', designation: 'Member', location: 'Hajipur', year_of_joining: 2017 },
        { name: 'Ravi Ranjan', email: 'ravi.ranjan@lions321c1.org', phone: '+91-9876543218', address: '67, Line Bazar, Purnia, Bihar', profession: 'Businessman', specialty: 'Agriculture & Trading', club: 'Lions Club Purnia', designation: 'President', location: 'Purnia', year_of_joining: 2009 },
        { name: 'Kavita Jha', email: 'kavita.jha@lions321c1.org', phone: '+91-9876543219', address: '90, Bailey Road, Patna, Bihar', profession: 'Chartered Accountant', specialty: 'Corporate Finance', club: 'Lions Club Patna West', designation: 'Treasurer', location: 'Patna', year_of_joining: 2016 },
        { name: 'Manoj Tiwari', email: 'manoj.tiwari@lions321c1.org', phone: '+91-9876543220', address: '34, College Road, Samastipur, Bihar', profession: 'Professor', specialty: 'Political Science', club: 'Lions Club Samastipur', designation: 'Secretary', location: 'Samastipur', year_of_joining: 2012 },
        { name: 'Rekha Sinha', email: 'rekha.sinha@lions321c1.org', phone: '+91-9876543221', address: '56, Patna High Court, Patna, Bihar', profession: 'Advocate', specialty: 'Family Law', club: 'Lions Club Patna Mahila', designation: 'Vice President', location: 'Patna', year_of_joining: 2011 },
        { name: 'Arun Kumar', email: 'arun.kumar@lions321c1.org', phone: '+91-9876543222', address: '78, Sadar Bazar, Chapra, Bihar', profession: 'Pharmacist', specialty: 'Clinical Pharmacy', club: 'Lions Club Chapra', designation: 'Member', location: 'Chapra', year_of_joining: 2019 },
        { name: 'Nisha Kumari', email: 'nisha.kumari@lions321c1.org', phone: '+91-9876543223', address: '12, Bapudham, Motihari, Bihar', profession: 'Teacher', specialty: 'Science & Biology', club: 'Lions Club Motihari', designation: 'Member', location: 'Motihari', year_of_joining: 2020 },
        { name: 'Sanjay Singh', email: 'sanjay.singh@lions321c1.org', phone: '+91-9876543224', address: '34, Rajendra Nagar, Patna, Bihar', profession: 'Engineer', specialty: 'Software Engineering', club: 'Lions Club Patna Central', designation: 'Member', location: 'Patna', year_of_joining: 2018 }
    ];

    supabase.from('members').insert(members).select('id').then(function (r) {
        if (r.error) {
            console.log('Seed failed:', r.error.message);
        } else {
            console.log('Seeded', r.data.length, 'members!');
        }
    });
}
