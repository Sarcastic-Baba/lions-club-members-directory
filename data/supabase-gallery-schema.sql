-- Admin-managed gallery images.
-- Run this in Supabase SQL Editor before using the gallery upload controls.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS gallery_images (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_url       TEXT NOT NULL,
    storage_path    TEXT,
    caption         TEXT CHECK (caption IS NULL OR char_length(caption) <= 180),
    display_order   INTEGER NOT NULL DEFAULT 0,
    created_by      INTEGER REFERENCES members(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gallery_images_order
    ON gallery_images (display_order ASC, created_at DESC);

ALTER TABLE gallery_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gallery_select_active_members" ON gallery_images;
CREATE POLICY "gallery_select_active_members" ON gallery_images
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.status = 'active'
            AND m.role IN ('member', 'admin', 'district_admin')
        )
    );

DROP POLICY IF EXISTS "gallery_insert_admins" ON gallery_images;
CREATE POLICY "gallery_insert_admins" ON gallery_images
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.status = 'active'
            AND m.role IN ('admin', 'district_admin')
        )
    );

DROP POLICY IF EXISTS "gallery_delete_admins" ON gallery_images;
CREATE POLICY "gallery_delete_admins" ON gallery_images
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM members m
            WHERE m.clerk_user_id = auth.uid()::text
            AND m.status = 'active'
            AND m.role IN ('admin', 'district_admin')
        )
    );

-- Images are uploaded to the existing public "post-images" bucket under gallery/.
