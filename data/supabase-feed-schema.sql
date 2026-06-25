-- Run this in your Supabase SQL Editor to add feed support
-- Lions Club District 321 C1 - Community Feed Schema

-- ============================================
-- 1. Update members table with new columns
-- ============================================
ALTER TABLE members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'guest';
ALTER TABLE members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE members ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS show_phone BOOLEAN DEFAULT true;
ALTER TABLE members ADD COLUMN IF NOT EXISTS show_email BOOLEAN DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS can_post_until TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

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

-- Editable public stats shown on the homepage/dashboard.
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
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "site_stats_update_admin" ON site_stats;
CREATE POLICY "site_stats_update_admin" ON site_stats
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
            AND m.status = 'active'
        )
    );

-- Editable upcoming events shown in the right panel.
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
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "site_events_admin_all" ON site_events;
CREATE POLICY "site_events_admin_all" ON site_events
    FOR ALL
    TO authenticated
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

-- Update RLS policies for feed access
DROP POLICY IF EXISTS "Anyone can read members" ON members;
CREATE POLICY "Members visible to authenticated members"
ON members FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM members m
        WHERE m.clerk_user_id = auth.uid()::text
        AND m.role IN ('member', 'club_admin', 'district_admin')
        AND m.status = 'active'
    )
);

DROP POLICY IF EXISTS "Users can create their profile" ON members;
CREATE POLICY "Users can create their profile"
ON members FOR INSERT
TO authenticated
WITH CHECK (clerk_user_id = auth.uid()::text);

DROP POLICY IF EXISTS "Users can update own profile" ON members;
CREATE POLICY "Users can update own profile"
ON members FOR UPDATE
TO authenticated
USING (clerk_user_id = auth.uid()::text);

-- ============================================
-- 2. Posts table
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

CREATE POLICY "posts_select" ON posts
    FOR SELECT
    TO authenticated
    USING (
        status IN ('active', 'under_review')
    );

CREATE POLICY "posts_insert" ON posts
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('member', 'club_admin', 'district_admin')
            AND m.status = 'active'
        )
    );

CREATE POLICY "posts_update_own" ON posts
    FOR UPDATE
    TO authenticated
    USING (
        author_id IN (
            SELECT id FROM members WHERE clerk_user_id = auth.uid()::text
        )
    );

CREATE POLICY "posts_delete_admin" ON posts
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
        )
    );

-- ============================================
-- 3. Post reactions table
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

CREATE POLICY "reactions_select" ON post_reactions
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "reactions_insert" ON post_reactions
    FOR INSERT
    TO authenticated
    WITH CHECK (
        member_id IN (
            SELECT id FROM members WHERE clerk_user_id = auth.uid()::text
        )
    );

CREATE POLICY "reactions_delete_own" ON post_reactions
    FOR DELETE
    TO authenticated
    USING (
        member_id IN (
            SELECT id FROM members WHERE clerk_user_id = auth.uid()::text
        )
    );

-- ============================================
-- 4. Post comments table
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

CREATE POLICY "comments_select" ON post_comments
    FOR SELECT
    TO authenticated
    USING (deleted_at IS NULL);

CREATE POLICY "comments_insert" ON post_comments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        author_id IN (
            SELECT id FROM members WHERE clerk_user_id = auth.uid()::text
        )
    );

CREATE POLICY "comments_delete_own" ON post_comments
    FOR DELETE
    TO authenticated
    USING (
        author_id IN (
            SELECT id FROM members WHERE clerk_user_id = auth.uid()::text
        )
    );

CREATE POLICY "comments_delete_admin" ON post_comments
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
        )
    );

-- ============================================
-- 5. Post reports table
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

CREATE POLICY "reports_insert" ON post_reports
    FOR INSERT
    TO authenticated
    WITH CHECK (
        reporter_id IN (
            SELECT id FROM members WHERE clerk_user_id = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS "reports_select_admin" ON post_reports;
CREATE POLICY "reports_select_admin" ON post_reports
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
            AND m.status = 'active'
        )
    );

DROP POLICY IF EXISTS "reports_update_admin" ON post_reports;
CREATE POLICY "reports_update_admin" ON post_reports
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.role IN ('club_admin', 'district_admin')
            AND m.status = 'active'
        )
    );

-- ============================================
-- 6. Supabase Storage buckets for images
-- ============================================
-- Run this in Supabase dashboard > Storage > New Bucket
-- Bucket names: "post-images", "profile-photos"
-- Make it public (or private with signed URLs)
-- Policy: Allow authenticated uploads
