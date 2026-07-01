require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false }, db: { schema: 'public' } }
);

const members = [
    { name: 'Rajesh Kumar', club_name: 'Lions Club Patna Central', designation: 'President', location: 'Patna', profession: 'Advocate', specialty: 'Criminal Law', phone: '+91-9876543210', email: 'rajesh.kumar@lions321c1.org', address: '12, Gandhi Maidan Road, Patna, Bihar', year_of_joining: 2010, role: 'admin', status: 'active', show_phone: true, show_email: false },
    { name: 'Sunita Sharma', club_name: 'Lions Club Gaya', designation: 'Secretary', location: 'Gaya', profession: 'Doctor', specialty: 'General Medicine', phone: '+91-9876543211', email: 'sunita.sharma@lions321c1.org', address: '45, Medical College Road, Gaya, Bihar', year_of_joining: 2012, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Amit Verma', club_name: 'Lions Club Muzaffarpur', designation: 'Treasurer', location: 'Muzaffarpur', profession: 'Chartered Accountant', specialty: 'Auditing & Taxation', phone: '+91-9876543212', email: 'amit.verma@lions321c1.org', address: '78, Company Bagh, Muzaffarpur, Bihar', year_of_joining: 2015, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Priya Singh', club_name: 'Lions Club Patna Mahila', designation: 'Member', location: 'Patna', profession: 'Teacher', specialty: 'Mathematics', phone: '+91-9876543213', email: 'priya.singh@lions321c1.org', address: '34, Boring Road, Patna, Bihar', year_of_joining: 2018, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Vikash Anand', club_name: 'Lions Club Bhagalpur', designation: 'Vice President', location: 'Bhagalpur', profession: 'Businessman', specialty: 'Textile Industry', phone: '+91-9876543214', email: 'vikash.anand@lions321c1.org', address: '56, MG Road, Bhagalpur, Bihar', year_of_joining: 2011, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Meena Devi', club_name: 'Lions Club Darbhanga', designation: 'Joint Secretary', location: 'Darbhanga', profession: 'Social Worker', specialty: 'Women Empowerment', phone: '+91-9876543215', email: 'meena.devi@lions321c1.org', address: '23, Laheriasarai, Darbhanga, Bihar', year_of_joining: 2013, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Dr. Suresh Prasad', club_name: 'Lions Club Patna East', designation: 'Member', location: 'Patna', profession: 'Doctor', specialty: 'Cardiology', phone: '+91-9876543216', email: 'suresh.prasad@lions321c1.org', address: '89, Kankarbagh, Patna, Bihar', year_of_joining: 2014, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Anjali Gupta', club_name: 'Lions Club Hajipur', designation: 'Member', location: 'Hajipur', profession: 'Engineer', specialty: 'Civil Engineering', phone: '+91-9876543217', email: 'anjali.gupta@lions321c1.org', address: '12, Industrial Area, Hajipur, Bihar', year_of_joining: 2017, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Ravi Ranjan', club_name: 'Lions Club Purnia', designation: 'President', location: 'Purnia', profession: 'Businessman', specialty: 'Agriculture & Trading', phone: '+91-9876543218', email: 'ravi.ranjan@lions321c1.org', address: '67, Line Bazar, Purnia, Bihar', year_of_joining: 2009, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Kavita Jha', club_name: 'Lions Club Patna West', designation: 'Treasurer', location: 'Patna', profession: 'Chartered Accountant', specialty: 'Corporate Finance', phone: '+91-9876543219', email: 'kavita.jha@lions321c1.org', address: '90, Bailey Road, Patna, Bihar', year_of_joining: 2016, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Manoj Tiwari', club_name: 'Lions Club Samastipur', designation: 'Secretary', location: 'Samastipur', profession: 'Professor', specialty: 'Political Science', phone: '+91-9876543220', email: 'manoj.tiwari@lions321c1.org', address: '34, College Road, Samastipur, Bihar', year_of_joining: 2012, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Rekha Sinha', club_name: 'Lions Club Patna Mahila', designation: 'Vice President', location: 'Patna', profession: 'Advocate', specialty: 'Family Law', phone: '+91-9876543221', email: 'rekha.sinha@lions321c1.org', address: '56, Patna High Court, Patna, Bihar', year_of_joining: 2011, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Arun Kumar', club_name: 'Lions Club Chapra', designation: 'Member', location: 'Chapra', profession: 'Pharmacist', specialty: 'Clinical Pharmacy', phone: '+91-9876543222', email: 'arun.kumar@lions321c1.org', address: '78, Sadar Bazar, Chapra, Bihar', year_of_joining: 2019, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Nisha Kumari', club_name: 'Lions Club Motihari', designation: 'Member', location: 'Motihari', profession: 'Teacher', specialty: 'Science & Biology', phone: '+91-9876543223', email: 'nisha.kumari@lions321c1.org', address: '12, Bapudham, Motihari, Bihar', year_of_joining: 2020, role: 'member', status: 'active', show_phone: true, show_email: false },
    { name: 'Sanjay Singh', club_name: 'Lions Club Patna Central', designation: 'Member', location: 'Patna', profession: 'Engineer', specialty: 'Software Engineering', phone: '+91-9876543224', email: 'sanjay.singh@lions321c1.org', address: '34, Rajendra Nagar, Patna, Bihar', year_of_joining: 2018, role: 'member', status: 'active', show_phone: true, show_email: false }
];

async function seed() {
    console.log('Seeding ' + members.length + ' members with roles...');
    
    const { data, error } = await supabase.from('members').insert(members).select('id, name, role');
    
    if (error) {
        console.error('Seed error:', error.message);
        
        // Check if column names match
        console.log('\nTrying with alternate column names...');
        const alt = members.map(m => ({
            name: m.name,
            club: m.club_name,
            designation: m.designation,
            location: m.location,
            profession: m.profession,
            specialty: m.specialty,
            phone: m.phone,
            email: m.email,
            address: m.address,
            year_of_joining: m.year_of_joining,
            role: m.role,
            status: m.status
        }));
        const { data: a, error: ae } = await supabase.from('members').insert(alt).select('id, name, role');
        if (ae) {
            console.error('Alt seed also failed:', ae.message);
        } else {
            console.log('Seeded ' + a.length + ' members with club column!');
        }
        return;
    }
    
    console.log('Seeded ' + data.length + ' members successfully!');
    data.forEach(function (m) {
        console.log('  - ' + m.name + ' (' + m.role + ')');
    });
}

seed();
