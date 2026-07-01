-- Simplify member roles to the two roles used by the app:
--   admin  - full admin access
--   member - regular member access
--
-- Approval state remains separate in members.status:
--   pending | active | suspended

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_role_check;

UPDATE members
SET role = 'admin'
WHERE role IN ('club_admin', 'district_admin');

UPDATE members
SET role = 'member'
WHERE role IS NULL
   OR role = ''
   OR role = 'guest';

ALTER TABLE members ALTER COLUMN role SET DEFAULT 'member';

ALTER TABLE members ADD CONSTRAINT members_role_check
    CHECK (role IN ('member', 'admin'));
