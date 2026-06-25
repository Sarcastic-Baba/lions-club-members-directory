-- ============================================================
-- Lions Club District 321 C1 - Complete Database Schema
-- Run ALL of this at once in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/qexxpyezmqjpigiievpq/sql/new
-- ============================================================

-- Drop existing tables (clean slate)
DROP TABLE IF EXISTS post_reports CASCADE;
DROP TABLE IF EXISTS post_comments CASCADE;
DROP TABLE IF EXISTS post_reactions CASCADE;
DROP TABLE IF EXISTS posts CASCADE;
DROP TABLE IF EXISTS site_events CASCADE;
DROP TABLE IF EXISTS site_stats CASCADE;
DROP TABLE IF EXISTS members CASCADE;

-- ============================================
-- 1. Members table
-- ============================================
CREATE TABLE members (
    id              SERIAL PRIMARY KEY,
    clerk_user_id   TEXT UNIQUE,
    name            TEXT NOT NULL,
    email           TEXT,
    phone           TEXT,
    address         TEXT,
    profession      TEXT,
    specialty       TEXT,
    club            TEXT,
    designation     TEXT,
    location        TEXT,
    year_of_joining INTEGER,
    role            TEXT NOT NULL DEFAULT 'guest' CHECK (role IN ('guest', 'member', 'club_admin', 'district_admin')),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
    profile_photo_url TEXT,
    show_phone      BOOLEAN DEFAULT true,
    show_email      BOOLEAN DEFAULT false,
    can_post_until  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_select" ON members
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('member', 'club_admin', 'district_admin')
            AND m.status = 'active'
        )
    );

CREATE POLICY "members_insert" ON members
    FOR INSERT TO authenticated
    WITH CHECK (clerk_user_id = auth.uid()::text);

CREATE POLICY "members_update_own" ON members
    FOR UPDATE TO authenticated
    USING (clerk_user_id = auth.uid()::text);

CREATE POLICY "members_delete_own" ON members
    FOR DELETE TO authenticated
    USING (clerk_user_id = auth.uid()::text);

-- ============================================
-- 2. Site stats table
-- ============================================
CREATE TABLE site_stats (
    id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    members    INTEGER NOT NULL DEFAULT 34 CHECK (members >= 0),
    clubs      INTEGER NOT NULL DEFAULT 16 CHECK (clubs >= 0),
    years      INTEGER NOT NULL DEFAULT (EXTRACT(YEAR FROM NOW())::INTEGER - 1957) CHECK (years >= 0),
    updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO site_stats (id, members, clubs, years)
VALUES (1, 34, 16, EXTRACT(YEAR FROM NOW())::INTEGER - 1957);

ALTER TABLE site_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_stats_select" ON site_stats
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "site_stats_update_admin" ON site_stats
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
            AND m.status = 'active'
        )
    );

-- ============================================
-- 3. Site events table
-- ============================================
CREATE TABLE site_events (
    id            SERIAL PRIMARY KEY,
    title         TEXT NOT NULL CHECK (char_length(title) <= 80),
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    updated_by    INTEGER REFERENCES members(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO site_events (title, display_order)
VALUES
    ('Installation Ceremony', 1),
    ('Blood Donation Camp', 2),
    ('Cabinet Meeting', 3);

ALTER TABLE site_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_events_select" ON site_events
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "site_events_admin_all" ON site_events
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
            AND m.status = 'active'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
            AND m.status = 'active'
        )
    );

-- ============================================
-- 4. Posts table
-- ============================================
CREATE TABLE posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       INTEGER,
    content_type    TEXT NOT NULL DEFAULT 'text',
    body            TEXT,
    image_urls      TEXT[],
    status          TEXT NOT NULL DEFAULT 'active',
    comment_count   INTEGER NOT NULL DEFAULT 0,
    edited_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK after table creation
ALTER TABLE posts ADD CONSTRAINT fk_posts_author
    FOREIGN KEY (author_id) REFERENCES members(id) ON DELETE SET NULL;

CREATE INDEX idx_posts_created ON posts (created_at DESC)
    WHERE status = 'active';

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_select" ON posts
    FOR SELECT TO authenticated
    USING (status IN ('active', 'under_review'));

CREATE POLICY "posts_insert" ON posts
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('member', 'club_admin', 'district_admin')
            AND m.status = 'active'
        )
    );

CREATE POLICY "posts_update_own" ON posts
    FOR UPDATE TO authenticated
    USING (author_id IN (SELECT id FROM members WHERE clerk_user_id = auth.uid()::text));

CREATE POLICY "posts_delete_admin" ON posts
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
        )
    );

-- ============================================
-- 4. Post reactions table
-- ============================================
CREATE TABLE post_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID NOT NULL,
    member_id   INTEGER NOT NULL,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (post_id, member_id)
);

ALTER TABLE post_reactions ADD CONSTRAINT fk_reactions_post
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
ALTER TABLE post_reactions ADD CONSTRAINT fk_reactions_member
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reactions_select" ON post_reactions
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "reactions_insert" ON post_reactions
    FOR INSERT TO authenticated
    WITH CHECK (member_id IN (SELECT id FROM members WHERE clerk_user_id = auth.uid()::text));

CREATE POLICY "reactions_delete_own" ON post_reactions
    FOR DELETE TO authenticated
    USING (member_id IN (SELECT id FROM members WHERE clerk_user_id = auth.uid()::text));

-- ============================================
-- 5. Post comments table
-- ============================================
CREATE TABLE post_comments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID NOT NULL,
    author_id   INTEGER,
    body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE post_comments ADD CONSTRAINT fk_comments_post
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
ALTER TABLE post_comments ADD CONSTRAINT fk_comments_author
    FOREIGN KEY (author_id) REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments_select" ON post_comments
    FOR SELECT TO authenticated
    USING (deleted_at IS NULL);

CREATE POLICY "comments_insert" ON post_comments
    FOR INSERT TO authenticated
    WITH CHECK (author_id IN (SELECT id FROM members WHERE clerk_user_id = auth.uid()::text));

CREATE POLICY "comments_delete_own" ON post_comments
    FOR DELETE TO authenticated
    USING (author_id IN (SELECT id FROM members WHERE clerk_user_id = auth.uid()::text));

CREATE POLICY "comments_update_admin" ON post_comments
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
        )
    );

-- ============================================
-- 6. Post reports table
-- ============================================
CREATE TABLE post_reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID NOT NULL,
    reporter_id INTEGER,
    reason      TEXT NOT NULL,
    reviewed    BOOLEAN DEFAULT false,
    reviewed_by INTEGER,
    reviewed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (post_id, reporter_id)
);

ALTER TABLE post_reports ADD CONSTRAINT fk_reports_post
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
ALTER TABLE post_reports ADD CONSTRAINT fk_reports_reporter
    FOREIGN KEY (reporter_id) REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE post_reports ADD CONSTRAINT fk_reports_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES members(id);

ALTER TABLE post_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reports_insert" ON post_reports
    FOR INSERT TO authenticated
    WITH CHECK (reporter_id IN (SELECT id FROM members WHERE clerk_user_id = auth.uid()::text));

CREATE POLICY "reports_select_admin" ON post_reports
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
        )
    );

CREATE POLICY "reports_update_admin" ON post_reports
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
        )
    );

-- ============================================
-- 7. Seed 15 members
-- ============================================
INSERT INTO members (name, email, phone, address, profession, specialty, club, designation, location, year_of_joining, role, status, show_phone, show_email)
VALUES
    ('Rajesh Kumar', 'rajesh.kumar@lions321c1.org', '+91-9876543210', '12, Gandhi Maidan Road, Patna, Bihar', 'Advocate', 'Criminal Law', 'Lions Club Patna Central', 'President', 'Patna', 2010, 'district_admin', 'active', true, false),
    ('Sunita Sharma', 'sunita.sharma@lions321c1.org', '+91-9876543211', '45, Medical College Road, Gaya, Bihar', 'Doctor', 'General Medicine', 'Lions Club Gaya', 'Secretary', 'Gaya', 2012, 'club_admin', 'active', true, false),
    ('Amit Verma', 'amit.verma@lions321c1.org', '+91-9876543212', '78, Company Bagh, Muzaffarpur, Bihar', 'Chartered Accountant', 'Auditing & Taxation', 'Lions Club Muzaffarpur', 'Treasurer', 'Muzaffarpur', 2015, 'member', 'active', true, false),
    ('Priya Singh', 'priya.singh@lions321c1.org', '+91-9876543213', '34, Boring Road, Patna, Bihar', 'Teacher', 'Mathematics', 'Lions Club Patna Mahila', 'Member', 'Patna', 2018, 'member', 'active', true, false),
    ('Vikash Anand', 'vikash.anand@lions321c1.org', '+91-9876543214', '56, MG Road, Bhagalpur, Bihar', 'Businessman', 'Textile Industry', 'Lions Club Bhagalpur', 'Vice President', 'Bhagalpur', 2011, 'member', 'active', true, false),
    ('Meena Devi', 'meena.devi@lions321c1.org', '+91-9876543215', '23, Laheriasarai, Darbhanga, Bihar', 'Social Worker', 'Women Empowerment', 'Lions Club Darbhanga', 'Joint Secretary', 'Darbhanga', 2013, 'member', 'active', true, false),
    ('Dr. Suresh Prasad', 'suresh.prasad@lions321c1.org', '+91-9876543216', '89, Kankarbagh, Patna, Bihar', 'Doctor', 'Cardiology', 'Lions Club Patna East', 'Member', 'Patna', 2014, 'member', 'active', true, false),
    ('Anjali Gupta', 'anjali.gupta@lions321c1.org', '+91-9876543217', '12, Industrial Area, Hajipur, Bihar', 'Engineer', 'Civil Engineering', 'Lions Club Hajipur', 'Member', 'Hajipur', 2017, 'member', 'active', true, false),
    ('Ravi Ranjan', 'ravi.ranjan@lions321c1.org', '+91-9876543218', '67, Line Bazar, Purnia, Bihar', 'Businessman', 'Agriculture & Trading', 'Lions Club Purnia', 'President', 'Purnia', 2009, 'member', 'active', true, false),
    ('Kavita Jha', 'kavita.jha@lions321c1.org', '+91-9876543219', '90, Bailey Road, Patna, Bihar', 'Chartered Accountant', 'Corporate Finance', 'Lions Club Patna West', 'Treasurer', 'Patna', 2016, 'member', 'active', true, false),
    ('Manoj Tiwari', 'manoj.tiwari@lions321c1.org', '+91-9876543220', '34, College Road, Samastipur, Bihar', 'Professor', 'Political Science', 'Lions Club Samastipur', 'Secretary', 'Samastipur', 2012, 'member', 'active', true, false),
    ('Rekha Sinha', 'rekha.sinha@lions321c1.org', '+91-9876543221', '56, Patna High Court, Patna, Bihar', 'Advocate', 'Family Law', 'Lions Club Patna Mahila', 'Vice President', 'Patna', 2011, 'member', 'active', true, false),
    ('Arun Kumar', 'arun.kumar@lions321c1.org', '+91-9876543222', '78, Sadar Bazar, Chapra, Bihar', 'Pharmacist', 'Clinical Pharmacy', 'Lions Club Chapra', 'Member', 'Chapra', 2019, 'member', 'active', true, false),
    ('Nisha Kumari', 'nisha.kumari@lions321c1.org', '+91-9876543223', '12, Bapudham, Motihari, Bihar', 'Teacher', 'Science & Biology', 'Lions Club Motihari', 'Member', 'Motihari', 2020, 'member', 'active', true, false),
    ('Sanjay Singh', 'sanjay.singh@lions321c1.org', '+91-9876543224', '34, Rajendra Nagar, Patna, Bihar', 'Engineer', 'Software Engineering', 'Lions Club Patna Central', 'Member', 'Patna', 2018, 'member', 'active', true, false);
