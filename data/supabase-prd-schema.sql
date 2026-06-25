-- ============================================================
-- Lions Club District 321 C1 - PRD-Compliant Database Schema
-- Run in Supabase SQL Editor or via setup script
-- ============================================================

-- Enable pg_trgm extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- 1. MEMBERS TABLE — Add PRD columns
-- ============================================

-- Add PRD-specified columns (idempotent)
ALTER TABLE members ADD COLUMN IF NOT EXISTS lion_id TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS club_name TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS years_as_lion INTEGER;
ALTER TABLE members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'guest';
ALTER TABLE members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE members ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS show_phone BOOLEAN DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS show_email BOOLEAN DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS can_post_until TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows: copy name→full_name, club→club_name, location→city
UPDATE members SET full_name = name WHERE full_name IS NULL;
UPDATE members SET club_name = club WHERE club_name IS NULL;
UPDATE members SET city = location WHERE city IS NULL;
UPDATE members SET years_as_lion = year_of_joining WHERE years_as_lion IS NULL;
UPDATE members SET role = 'member' WHERE role = 'guest' AND clerk_user_id IS NULL;
UPDATE members SET status = 'active' WHERE status = 'pending' AND clerk_user_id IS NULL;
UPDATE members SET role = 'member' WHERE role IS NULL OR role = '';
UPDATE members SET status = 'active' WHERE status IS NULL OR status = '';
UPDATE members SET role = 'guest' WHERE role NOT IN ('guest', 'member', 'club_admin', 'district_admin');
UPDATE members SET status = 'pending' WHERE status NOT IN ('pending', 'active', 'suspended');

ALTER TABLE members ALTER COLUMN role SET DEFAULT 'guest';
ALTER TABLE members ALTER COLUMN status SET DEFAULT 'pending';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'members_role_check'
    ) THEN
        ALTER TABLE members ADD CONSTRAINT members_role_check
            CHECK (role IN ('guest', 'member', 'club_admin', 'district_admin'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'members_status_check'
    ) THEN
        ALTER TABLE members ADD CONSTRAINT members_status_check
            CHECK (status IN ('pending', 'active', 'suspended'));
    END IF;
END $$;

-- Add unique constraint on lion_id (after backfill)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'members_lion_id_key'
    ) THEN
        ALTER TABLE members ADD CONSTRAINT members_lion_id_key UNIQUE (lion_id);
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Enable RLS
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- Drop old policies, recreate PRD-compliant ones
DROP POLICY IF EXISTS "members_select" ON members;
DROP POLICY IF EXISTS "members_insert" ON members;
DROP POLICY IF EXISTS "members_update_own" ON members;
DROP POLICY IF EXISTS "members_delete_own" ON members;
DROP POLICY IF EXISTS "Anyone can read members" ON members;
DROP POLICY IF EXISTS "Users can create their profile" ON members;
DROP POLICY IF EXISTS "Users can update own profile" ON members;
DROP POLICY IF EXISTS "Users can delete own profile" ON members;
DROP POLICY IF EXISTS "Members visible to authenticated members" ON members;

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

-- Also allow service_role full access (for server-side operations)
CREATE POLICY "members_service_role_all" ON members
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================
-- 1b. SITE STATS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS site_stats (
    id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    members    INTEGER NOT NULL DEFAULT 34 CHECK (members >= 0),
    clubs      INTEGER NOT NULL DEFAULT 16 CHECK (clubs >= 0),
    years      INTEGER NOT NULL DEFAULT (EXTRACT(YEAR FROM NOW())::INTEGER - 1957) CHECK (years >= 0),
    updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO site_stats (id, members, clubs, years)
VALUES (1, 34, 16, EXTRACT(YEAR FROM NOW())::INTEGER - 1957)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE site_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_stats_select" ON site_stats;
CREATE POLICY "site_stats_select" ON site_stats
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "site_stats_update_admin" ON site_stats;
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
-- 1c. SITE EVENTS TABLE
-- ============================================
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

DROP POLICY IF EXISTS "site_events_select" ON site_events;
CREATE POLICY "site_events_select" ON site_events
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "site_events_admin_all" ON site_events;
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
-- 2. PENDING CLAIMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS pending_claims (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_user_id   TEXT UNIQUE NOT NULL,
    lion_id         TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    club_name       TEXT NOT NULL,
    city            TEXT,
    phone           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    rejection_note  TEXT,
    reviewed_by     INTEGER REFERENCES members(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pending_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_claims_insert" ON pending_claims;
CREATE POLICY "pending_claims_insert" ON pending_claims
    FOR INSERT TO authenticated
    WITH CHECK (clerk_user_id = auth.uid()::text);

DROP POLICY IF EXISTS "pending_claims_select_own" ON pending_claims;
CREATE POLICY "pending_claims_select_own" ON pending_claims
    FOR SELECT TO authenticated
    USING (clerk_user_id = auth.uid()::text);

DROP POLICY IF EXISTS "pending_claims_select_admin" ON pending_claims;
CREATE POLICY "pending_claims_select_admin" ON pending_claims
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
            AND m.status = 'active'
        )
    );

DROP POLICY IF EXISTS "pending_claims_update_admin" ON pending_claims;
CREATE POLICY "pending_claims_update_admin" ON pending_claims
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
-- 3. MEMBER PROFESSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS member_professions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id           INTEGER REFERENCES members(id) ON DELETE CASCADE,
    profession          TEXT NOT NULL,
    profession_aliases  TEXT[],
    speciality          TEXT,
    speciality_aliases  TEXT[],
    years_experience    INTEGER,
    is_primary          BOOLEAN DEFAULT false,
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- Trigram indexes for fuzzy search
CREATE INDEX IF NOT EXISTS idx_profession_trgm ON member_professions
    USING GIN (profession gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_speciality_trgm ON member_professions
    USING GIN (speciality gin_trgm_ops);

ALTER TABLE member_professions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "member_professions_select" ON member_professions;
CREATE POLICY "member_professions_select" ON member_professions
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('member', 'club_admin', 'district_admin')
            AND m.status = 'active'
        )
    );

DROP POLICY IF EXISTS "member_professions_insert" ON member_professions;
CREATE POLICY "member_professions_insert" ON member_professions
    FOR INSERT TO authenticated
    WITH CHECK (
        member_id IN (
            SELECT id FROM members WHERE clerk_user_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS "member_professions_update_own" ON member_professions;
CREATE POLICY "member_professions_update_own" ON member_professions
    FOR UPDATE TO authenticated
    USING (
        member_id IN (
            SELECT id FROM members WHERE clerk_user_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS "member_professions_delete_own" ON member_professions;
CREATE POLICY "member_professions_delete_own" ON member_professions
    FOR DELETE TO authenticated
    USING (
        member_id IN (
            SELECT id FROM members WHERE clerk_user_id = auth.uid()::text
        )
    );

-- ============================================
-- 4. POSTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,
    content_type    TEXT NOT NULL DEFAULT 'text',
    body            TEXT,
    image_urls      TEXT[],
    status          TEXT NOT NULL DEFAULT 'active',
    comment_count   INTEGER NOT NULL DEFAULT 0,
    edited_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC)
    WHERE status = 'active';

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "posts_select" ON posts;
CREATE POLICY "posts_select" ON posts
    FOR SELECT TO authenticated
    USING (status IN ('active', 'under_review'));

DROP POLICY IF EXISTS "posts_insert" ON posts;
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

DROP POLICY IF EXISTS "posts_update_own" ON posts;
CREATE POLICY "posts_update_own" ON posts
    FOR UPDATE TO authenticated
    USING (author_id IN (SELECT id FROM members WHERE clerk_user_id = auth.uid()::text));

DROP POLICY IF EXISTS "posts_delete_admin" ON posts;
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
-- 5. POST REACTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS post_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID REFERENCES posts(id) ON DELETE CASCADE,
    member_id   INTEGER REFERENCES members(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (post_id, member_id)
);

ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reactions_select" ON post_reactions;
CREATE POLICY "reactions_select" ON post_reactions
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "reactions_insert" ON post_reactions;
CREATE POLICY "reactions_insert" ON post_reactions
    FOR INSERT TO authenticated
    WITH CHECK (member_id IN (SELECT id FROM members WHERE clerk_user_id = auth.uid()::text));

DROP POLICY IF EXISTS "reactions_delete_own" ON post_reactions;
CREATE POLICY "reactions_delete_own" ON post_reactions
    FOR DELETE TO authenticated
    USING (member_id IN (SELECT id FROM members WHERE clerk_user_id = auth.uid()::text));

-- ============================================
-- 6. POST COMMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS post_comments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID REFERENCES posts(id) ON DELETE CASCADE,
    author_id   INTEGER REFERENCES members(id) ON DELETE SET NULL,
    body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_select" ON post_comments;
CREATE POLICY "comments_select" ON post_comments
    FOR SELECT TO authenticated
    USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "comments_insert" ON post_comments;
CREATE POLICY "comments_insert" ON post_comments
    FOR INSERT TO authenticated
    WITH CHECK (author_id IN (SELECT id FROM members WHERE clerk_user_id = auth.uid()::text));

DROP POLICY IF EXISTS "comments_delete_own" ON post_comments;
CREATE POLICY "comments_delete_own" ON post_comments
    FOR DELETE TO authenticated
    USING (author_id IN (SELECT id FROM members WHERE clerk_user_id = auth.uid()::text));

DROP POLICY IF EXISTS "comments_update_admin" ON post_comments;
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
-- 7. POST REPORTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS post_reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID REFERENCES posts(id) ON DELETE CASCADE,
    reporter_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    reason      TEXT NOT NULL,
    reviewed    BOOLEAN DEFAULT false,
    reviewed_by INTEGER REFERENCES members(id),
    reviewed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (post_id, reporter_id)
);

ALTER TABLE post_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_insert" ON post_reports;
CREATE POLICY "reports_insert" ON post_reports
    FOR INSERT TO authenticated
    WITH CHECK (reporter_id IN (SELECT id FROM members WHERE clerk_user_id = auth.uid()::text));

DROP POLICY IF EXISTS "reports_select_admin" ON post_reports;
CREATE POLICY "reports_select_admin" ON post_reports
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
        )
    );

DROP POLICY IF EXISTS "reports_update_admin" ON post_reports;
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
-- 8. STORAGE BUCKET SETUP (run in dashboard if not exists)
-- ============================================
-- Bucket: post-images (public, 5MB, jpeg/png/webp)
-- Bucket: profile-photos (public, 5MB, jpeg/png/webp)
