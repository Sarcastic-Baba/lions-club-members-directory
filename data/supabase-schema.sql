-- Run this in your Supabase SQL Editor to create/update the members table
-- for individual login profiles.

-- Add new columns if running as an update on existing table
ALTER TABLE members ADD COLUMN IF NOT EXISTS clerk_user_id TEXT UNIQUE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS specialty TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS year_of_joining INTEGER;

-- Full table creation (for fresh setup)
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

-- Enable Row-Level Security
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- Anyone can read the directory (public listing)
CREATE POLICY "Anyone can read members"
ON members FOR SELECT
USING (true);

-- Authenticated users can insert their own profile
CREATE POLICY "Users can create their profile"
ON members FOR INSERT
TO authenticated
WITH CHECK (clerk_user_id = auth.uid()::text);

-- Authenticated users can update only their own profile
CREATE POLICY "Users can update own profile"
ON members FOR UPDATE
TO authenticated
USING (clerk_user_id = auth.uid()::text);

-- Authenticated users can delete only their own profile
CREATE POLICY "Users can delete own profile"
ON members FOR DELETE
TO authenticated
USING (clerk_user_id = auth.uid()::text);

-- Seed existing members (without clerk_user_id — these are directory entries only)
-- Editable upcoming events shown in the website right panel.
CREATE TABLE IF NOT EXISTS site_events (
    id            SERIAL PRIMARY KEY,
    title         TEXT NOT NULL CHECK (char_length(title) <= 80),
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    updated_by    INTEGER REFERENCES members(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO site_events (title, display_order)
SELECT title, display_order
FROM (
    VALUES
        ('Installation Ceremony', 1),
        ('Blood Donation Camp', 2),
        ('Cabinet Meeting', 3)
) AS seed(title, display_order)
WHERE NOT EXISTS (SELECT 1 FROM site_events);

ALTER TABLE site_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read site events" ON site_events;
CREATE POLICY "Anyone can read site events"
ON site_events FOR SELECT
USING (true);

INSERT INTO members (name, email, phone, address, profession, club, designation, location) VALUES
('Rajesh Kumar', 'rajesh.kumar@lions321c1.org', '+91-9876543210', '12, Gandhi Maidan Road, Patna, Bihar', 'Advocate', 'Lions Club Patna Central', 'President', 'Patna'),
('Sunita Sharma', 'sunita.sharma@lions321c1.org', '+91-9876543211', '45, Medical College Road, Gaya, Bihar', 'Doctor', 'Lions Club Gaya', 'Secretary', 'Gaya'),
('Amit Verma', 'amit.verma@lions321c1.org', '+91-9876543212', '78, Company Bagh, Muzaffarpur, Bihar', 'Chartered Accountant', 'Lions Club Muzaffarpur', 'Treasurer', 'Muzaffarpur'),
('Priya Singh', 'priya.singh@lions321c1.org', '+91-9876543213', '34, Boring Road, Patna, Bihar', 'Teacher', 'Lions Club Patna Mahila', 'Member', 'Patna'),
('Vikash Anand', 'vikash.anand@lions321c1.org', '+91-9876543214', '56, MG Road, Bhagalpur, Bihar', 'Businessman', 'Lions Club Bhagalpur', 'Vice President', 'Bhagalpur'),
('Meena Devi', 'meena.devi@lions321c1.org', '+91-9876543215', '23, Laheriasarai, Darbhanga, Bihar', 'Social Worker', 'Lions Club Darbhanga', 'Joint Secretary', 'Darbhanga'),
('Dr. Suresh Prasad', 'suresh.prasad@lions321c1.org', '+91-9876543216', '89, Kankarbagh, Patna, Bihar', 'Doctor', 'Lions Club Patna East', 'Member', 'Patna'),
('Anjali Gupta', 'anjali.gupta@lions321c1.org', '+91-9876543217', '12, Industrial Area, Hajipur, Bihar', 'Engineer', 'Lions Club Hajipur', 'Member', 'Hajipur'),
('Ravi Ranjan', 'ravi.ranjan@lions321c1.org', '+91-9876543218', '67, Line Bazar, Purnia, Bihar', 'Businessman', 'Lions Club Purnia', 'President', 'Purnia'),
('Kavita Jha', 'kavita.jha@lions321c1.org', '+91-9876543219', '90, Bailey Road, Patna, Bihar', 'Chartered Accountant', 'Lions Club Patna West', 'Treasurer', 'Patna'),
('Manoj Tiwari', 'manoj.tiwari@lions321c1.org', '+91-9876543220', '34, College Road, Samastipur, Bihar', 'Professor', 'Lions Club Samastipur', 'Secretary', 'Samastipur'),
('Rekha Sinha', 'rekha.sinha@lions321c1.org', '+91-9876543221', '56, Patna High Court, Patna, Bihar', 'Advocate', 'Lions Club Patna Mahila', 'Vice President', 'Patna'),
('Arun Kumar', 'arun.kumar@lions321c1.org', '+91-9876543222', '78, Sadar Bazar, Chapra, Bihar', 'Pharmacist', 'Lions Club Chapra', 'Member', 'Chapra'),
('Nisha Kumari', 'nisha.kumari@lions321c1.org', '+91-9876543223', '12, Bapudham, Motihari, Bihar', 'Teacher', 'Lions Club Motihari', 'Member', 'Motihari'),
('Sanjay Singh', 'sanjay.singh@lions321c1.org', '+91-9876543224', '34, Rajendra Nagar, Patna, Bihar', 'Engineer', 'Lions Club Patna Central', 'Member', 'Patna')
ON CONFLICT (id) DO NOTHING;
