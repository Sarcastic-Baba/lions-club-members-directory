-- Run this in your Supabase SQL Editor to create the members table
-- and seed it with the current static member data.

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

-- Enable Row-Level Security (optional)
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all members
CREATE POLICY "Authenticated users can read members"
ON members FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert/update/delete members
CREATE POLICY "Authenticated users can insert members"
ON members FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update members"
ON members FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete members"
ON members FOR DELETE
TO authenticated
USING (true);

-- Seed existing members
INSERT INTO members (name, club, designation, location, profession, phone, email, address) VALUES
('Rajesh Kumar', 'Lions Club Patna Central', 'President', 'Patna', 'Advocate', '+91-9876543210', 'rajesh.kumar@lions321c1.org', '12, Gandhi Maidan Road, Patna, Bihar'),
('Sunita Sharma', 'Lions Club Gaya', 'Secretary', 'Gaya', 'Doctor', '+91-9876543211', 'sunita.sharma@lions321c1.org', '45, Medical College Road, Gaya, Bihar'),
('Amit Verma', 'Lions Club Muzaffarpur', 'Treasurer', 'Muzaffarpur', 'Chartered Accountant', '+91-9876543212', 'amit.verma@lions321c1.org', '78, Company Bagh, Muzaffarpur, Bihar'),
('Priya Singh', 'Lions Club Patna Mahila', 'Member', 'Patna', 'Teacher', '+91-9876543213', 'priya.singh@lions321c1.org', '34, Boring Road, Patna, Bihar'),
('Vikash Anand', 'Lions Club Bhagalpur', 'Vice President', 'Bhagalpur', 'Businessman', '+91-9876543214', 'vikash.anand@lions321c1.org', '56, MG Road, Bhagalpur, Bihar'),
('Meena Devi', 'Lions Club Darbhanga', 'Joint Secretary', 'Darbhanga', 'Social Worker', '+91-9876543215', 'meena.devi@lions321c1.org', '23, Laheriasarai, Darbhanga, Bihar'),
('Dr. Suresh Prasad', 'Lions Club Patna East', 'Member', 'Patna', 'Doctor', '+91-9876543216', 'suresh.prasad@lions321c1.org', '89, Kankarbagh, Patna, Bihar'),
('Anjali Gupta', 'Lions Club Hajipur', 'Member', 'Hajipur', 'Engineer', '+91-9876543217', 'anjali.gupta@lions321c1.org', '12, Industrial Area, Hajipur, Bihar'),
('Ravi Ranjan', 'Lions Club Purnia', 'President', 'Purnia', 'Businessman', '+91-9876543218', 'ravi.ranjan@lions321c1.org', '67, Line Bazar, Purnia, Bihar'),
('Kavita Jha', 'Lions Club Patna West', 'Treasurer', 'Patna', 'Chartered Accountant', '+91-9876543219', 'kavita.jha@lions321c1.org', '90, Bailey Road, Patna, Bihar'),
('Manoj Tiwari', 'Lions Club Samastipur', 'Secretary', 'Samastipur', 'Professor', '+91-9876543220', 'manoj.tiwari@lions321c1.org', '34, College Road, Samastipur, Bihar'),
('Rekha Sinha', 'Lions Club Patna Mahila', 'Vice President', 'Patna', 'Advocate', '+91-9876543221', 'rekha.sinha@lions321c1.org', '56, Patna High Court, Patna, Bihar'),
('Arun Kumar', 'Lions Club Chapra', 'Member', 'Chapra', 'Pharmacist', '+91-9876543222', 'arun.kumar@lions321c1.org', '78, Sadar Bazar, Chapra, Bihar'),
('Nisha Kumari', 'Lions Club Motihari', 'Member', 'Motihari', 'Teacher', '+91-9876543223', 'nisha.kumari@lions321c1.org', '12, Bapudham, Motihari, Bihar'),
('Sanjay Singh', 'Lions Club Patna Central', 'Member', 'Patna', 'Engineer', '+91-9876543224', 'sanjay.singh@lions321c1.org', '34, Rajendra Nagar, Patna, Bihar');
