# Product Requirements Document
## Lions Club District 321 C1 — Member Network Platform

**Version:** 1.0  
**Status:** Draft  
**Last Updated:** June 2026  
**Owner:** District 321 C1 Technology Committee

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Goals & Success Metrics](#2-goals--success-metrics)
3. [Users & Roles](#3-users--roles)
4. [Tech Stack](#4-tech-stack)
5. [Feature 1 — Member Identity & Directory](#5-feature-1--member-identity--directory)
6. [Feature 2 — Natural Language Member Search](#6-feature-2--natural-language-member-search)
7. [Feature 3 — Community Feed (Posts, Reactions, Comments)](#7-feature-3--community-feed-posts-reactions-comments)
8. [Database Schema](#8-database-schema)
9. [API Routes](#9-api-routes)
10. [Security & Access Control](#10-security--access-control)
11. [Non-Functional Requirements](#11-non-functional-requirements)
12. [Open Questions](#12-open-questions)
13. [Out of Scope (v1)](#13-out-of-scope-v1)

---

## 1. Product Overview

The Lions Club District 321 C1 Member Network is a private, invite-verified digital platform for Lions members across the district. Its primary purpose is to make the human capital within the district — the professions, specialities, and expertise of its members — searchable and accessible to every Lion.

A secondary purpose is to give members a shared space to post announcements, share moments from club activities, and engage with one another through reactions and comments.

The platform is members-only. Every user must claim a verified Lion ID before they can view the directory or the feed.

---

## 2. Goals & Success Metrics

| Goal | Metric | Target (6 months post-launch) |
|------|--------|-------------------------------|
| Member adoption | % of district members with claimed profiles | ≥ 60% |
| Search utility | Searches per active user per month | ≥ 4 |
| Feed engagement | Posts per week across all clubs | ≥ 10 |
| Reaction/comment rate | % of posts that receive at least one reaction | ≥ 50% |
| Admin workload | Avg. claim approval time | < 24 hours |

---

## 3. Users & Roles

### 3.1 Role Definitions

| Role | Description | Access |
|------|-------------|--------|
| `guest` | Signed up via Clerk but Lion ID not yet verified | Can only see the claim form and a pending screen |
| `member` | Verified Lion with an approved, active profile | Full read access to directory and feed; can post, react, comment |
| `club_admin` | A Lion designated by their club president | Can approve/reject claims from their own club; moderate feed posts from their club |
| `district_admin` | District 321 C1 technology committee members | Full admin access; can approve any claim; manage all members; moderate all content |

### 3.2 Role Assignment

- Roles are stored in Supabase and synced to Clerk's `publicMetadata` on change.
- A new Clerk sign-up always starts as `guest`.
- `district_admin` promotes a `member` to `club_admin` or `district_admin` manually.

---

## 4. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 14 (App Router) | Web UI |
| Hosting | Vercel | Deployment, edge functions |
| Auth | Clerk | Sign-up, sign-in, JWT, session management |
| Database | Supabase (PostgreSQL) | All persistent data |
| Storage | Supabase Storage | Image uploads for posts and profile photos |
| LLM | Anthropic Claude (`claude-sonnet-4-6`) | Natural language query parsing |
| Search | PostgreSQL `pg_trgm` + `GIN` index | Fuzzy text match on professions |
| Realtime | Supabase Realtime | Live comment/reaction counts on feed |

---

## 5. Feature 1 — Member Identity & Directory

### 5.1 Sign-Up & Claim Flow

```
User signs up (Clerk)
  → Redirected to /claim
  → Fills: Lion ID · Full name · Club name · Phone · City
  → Submission creates a row in pending_claims (status: pending)
  → Admin notified (email)
  → Admin approves → member row created, clerk_user_id linked, role set to 'member'
  → Admin rejects → user notified with reason; can re-submit
```

- A Lion ID may only be claimed once. If the ID already exists in `members`, the claim is rejected and the user is asked to contact the district admin.
- Profile is not visible in the directory until `status = 'active'`.

### 5.2 Member Profile

Each member profile contains:

**Identity fields**  
Full name, Lion ID, Club name, City, Phone (visible only to members), Profile photo (optional, uploaded to Supabase Storage), Years as Lion, Current designation/title within Lions.

**Profession fields** (supports multiple entries)  
Primary profession, Profession aliases, Speciality, Speciality aliases, Years of experience, is_primary flag.

**Visibility fields**  
Members control which fields are visible to other members (phone, email). All other fields are always visible to members.

### 5.3 Directory Listing

- Accessible only to users with role `member` and above.
- Paginated grid or list of member cards showing: name, club, city, primary profession, speciality.
- Filterable by club name and city.
- Clicking a card opens the full profile.

---

## 6. Feature 2 — Natural Language Member Search

### 6.1 Overview

Members can type a free-text query to find other Lions by profession, speciality, location, or any combination. The system uses an LLM to parse the query into structured filters before hitting the database.

### 6.2 Query Flow

```
Member types: "I need a cardiologist who is also a CA in Pune"

POST /api/search
  → Claude receives the raw query with a structured extraction prompt
  → Returns JSON:
    {
      "professions": ["doctor", "physician", "medical"],
      "specialities": ["cardiologist", "cardiology", "heart specialist"],
      "secondary_professions": ["CA", "chartered accountant", "accountant"],
      "location": "Pune"
    }
  → Supabase query uses pg_trgm similarity on profession + speciality columns
  → Results ranked by: (a) speciality match, (b) profession match, (c) proximity
  → Response returned with match explanation per result
```

### 6.3 LLM Prompt Design

The Claude system prompt for search extraction must:

- Map informal terms to canonical forms (`CA` → `chartered accountant`, `heart doctor` → `cardiologist`).
- Handle compound queries (`doctor and also a lawyer`).
- Extract location if mentioned.
- Return structured JSON only — no prose.
- Gracefully return an empty array for fields it cannot extract (never hallucinate professions).

### 6.4 Fallback Behaviour

If the LLM call fails or times out (> 5 seconds), the system falls back to a simple `ilike` text search across `profession` and `speciality` columns directly on the raw query string.

### 6.5 Search Result Display

Each result card shows:
- Member name, photo, club, city
- Matched profession and speciality (highlighted)
- A short "Why this match" explanation (one line, generated by Claude alongside the filter JSON)
- Contact button (reveals phone/email per the member's visibility settings)

---

## 7. Feature 3 — Community Feed (Posts, Reactions, Comments)

### 7.1 Overview

The Community Feed is a shared, district-wide bulletin board visible to all verified members. Members can post text updates or images, react with emoji, and leave comments. The feed is not public — it requires a verified Lion account.

### 7.2 Post Types

| Type | Description |
|------|-------------|
| `text` | Plain text post, max 2000 characters |
| `image` | Up to 4 images per post, with optional caption (max 500 characters) |
| `text_image` | Text body (max 1000 characters) + up to 4 images |

### 7.3 Creating a Post

**Trigger:** "New Post" button visible in the feed to any `member`.

**Composer UI:**
- Text area with character counter.
- Image upload button (triggers Supabase Storage upload on file select, returns URL before submit).
- Image preview grid (up to 4 tiles); each tile has a remove button.
- Post button — disabled until at least text or one image is present.
- Discard button — confirms before clearing the composer.

**Post submit flow:**
```
Member writes post (text and/or images already uploaded to Storage)
  → POST /api/posts
  → Validates content (length, image URL validity)
  → Inserts into posts table (author_id, content_type, body, image_urls[], created_at)
  → Returns new post object
  → Feed prepends the post optimistically in the UI
```

**Constraints:**
- A member may not post more than 10 times in a 24-hour rolling window (rate-limited at the API route level).
- Images must be uploaded to Supabase Storage before the post is submitted. Direct external URLs are not allowed.
- Maximum image file size: 5 MB per image.
- Accepted formats: JPEG, PNG, WEBP.

### 7.4 Feed Display

- Feed is reverse-chronological by default.
- Infinite scroll (page size: 20 posts).
- Each post card shows:
  - Author name, profile photo, club, city
  - Post timestamp (relative: "2 hours ago"; absolute on hover)
  - Post content (text and/or image grid)
  - Reaction bar (counts per emoji + the member's own reaction if any)
  - Comment count with expand toggle
  - Three-dot menu (Edit/Delete for own posts; Report for others')

**Image display:**
- 1 image → full width.
- 2 images → side by side (50/50).
- 3 images → one full width + two below (50/50).
- 4 images → 2×2 grid.
- Clicking any image opens a full-screen lightbox.

### 7.5 Reactions

Members can react to any post with a single emoji from a fixed set.

**Allowed reactions:**

| Emoji | Meaning |
|-------|---------|
| 👍 | Like |
| ❤️ | Love |
| 👏 | Clap |
| 🙏 | Grateful |
| 💡 | Insightful |

**Behaviour:**
- A member can only have one active reaction per post at a time.
- Tapping a reaction you've already selected removes it (toggle).
- Tapping a different reaction replaces your current one.
- Reaction counts update in real-time via Supabase Realtime.

**Data model:** `post_reactions(id, post_id, member_id, emoji, created_at)` with a UNIQUE constraint on `(post_id, member_id)` — enforces one reaction per member per post at the database level.

### 7.6 Comments

**Comment thread behaviour:**
- Comments are flat (no nested replies in v1).
- Expand/collapse toggle on the post card shows/hides the comment thread.
- Comment input appears at the bottom of the thread when expanded.
- Comments display: author photo, name, comment text, timestamp.

**Posting a comment:**
```
Member types in comment input (max 500 characters)
  → POST /api/posts/[postId]/comments
  → Inserts into post_comments table
  → Returns comment object
  → Appended to thread immediately (optimistic UI)
  → post.comment_count incremented (maintained as a denormalized counter on the posts table)
```

**Constraints:**
- Minimum 1 character, maximum 500 characters.
- Members can delete their own comments.
- `district_admin` and `club_admin` can delete any comment on posts from their scope.

### 7.7 Edit & Delete Posts

**Edit:**
- Only the post author can edit their post.
- Text content is editable; images cannot be added or removed after posting (v1 simplification).
- Edited posts show an "Edited" label with timestamp.
- `PATCH /api/posts/[postId]` — updates `body` and sets `edited_at`.

**Delete:**
- The post author, `club_admin` (for posts from their club), and `district_admin` can delete a post.
- Deletion is soft: `deleted_at` is set on the row; the post is replaced in the feed with "This post has been removed."
- Associated comments and reactions are not deleted from the database but are no longer shown.

### 7.8 Reporting

Members can report a post using the three-dot menu.

- `POST /api/posts/[postId]/report` with a required `reason` field (enum: `spam`, `offensive`, `misinformation`, `other`).
- Report is inserted into a `post_reports` table visible only to admins.
- A post with 3 or more unique member reports is automatically hidden from the feed pending admin review (status set to `under_review`).
- Admins see a "Reports" tab in the admin dashboard listing all flagged posts.

### 7.9 Admin Moderation

`district_admin` and `club_admin` can:
- Delete any post within their scope from the feed or from the admin dashboard.
- Dismiss a report (marking it reviewed without deleting the post).
- Ban a member from posting for 7 days (`can_post_until` date field on the member row).

---

## 8. Database Schema

### 8.1 Core Tables

```sql
-- Members (one row per verified Lion)
CREATE TABLE members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id     text UNIQUE NOT NULL,
  lion_id           text UNIQUE NOT NULL,
  full_name         text NOT NULL,
  club_name         text NOT NULL,
  city              text,
  phone             text,
  email             text,
  profile_photo_url text,
  designation       text,
  years_as_lion     int,
  role              text NOT NULL DEFAULT 'member',  -- guest | member | club_admin | district_admin
  status            text NOT NULL DEFAULT 'active',  -- active | inactive | suspended
  show_phone        boolean DEFAULT true,
  show_email        boolean DEFAULT false,
  can_post_until    timestamptz,                      -- null = no ban
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Pending claims (pre-verification)
CREATE TABLE pending_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id   text UNIQUE NOT NULL,
  lion_id         text NOT NULL,
  full_name       text NOT NULL,
  club_name       text NOT NULL,
  city            text,
  phone           text,
  status          text NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  rejection_note  text,
  reviewed_by     uuid REFERENCES members(id),
  reviewed_at     timestamptz,
  created_at      timestamptz DEFAULT now()
);

-- Member professions (one member can have multiple)
CREATE TABLE member_professions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id           uuid REFERENCES members(id) ON DELETE CASCADE,
  profession          text NOT NULL,
  profession_aliases  text[],   -- ["CA", "chartered accountant", "accountant"]
  speciality          text,
  speciality_aliases  text[],   -- ["cardiologist", "cardiology", "heart specialist"]
  years_experience    int,
  is_primary          boolean DEFAULT false,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_profession_trgm ON member_professions
  USING GIN (profession gin_trgm_ops);
CREATE INDEX idx_speciality_trgm ON member_professions
  USING GIN (speciality gin_trgm_ops);
```

### 8.2 Feed Tables

```sql
-- Posts
CREATE TABLE posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       uuid REFERENCES members(id) ON DELETE SET NULL,
  content_type    text NOT NULL,  -- text | image | text_image
  body            text,           -- null for image-only posts
  image_urls      text[],         -- Supabase Storage public URLs
  status          text NOT NULL DEFAULT 'active',  -- active | under_review | deleted
  comment_count   int NOT NULL DEFAULT 0,          -- denormalized counter
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_posts_created ON posts (created_at DESC)
  WHERE status = 'active';

-- Reactions
CREATE TABLE post_reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid REFERENCES posts(id) ON DELETE CASCADE,
  member_id   uuid REFERENCES members(id) ON DELETE CASCADE,
  emoji       text NOT NULL,  -- 👍 | ❤️ | 👏 | 🙏 | 💡
  created_at  timestamptz DEFAULT now(),
  UNIQUE (post_id, member_id)   -- one reaction per member per post
);

-- Comments
CREATE TABLE post_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid REFERENCES posts(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES members(id) ON DELETE SET NULL,
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  deleted_at  timestamptz,
  created_at  timestamptz DEFAULT now()
);

-- Reports
CREATE TABLE post_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid REFERENCES posts(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES members(id) ON DELETE SET NULL,
  reason      text NOT NULL,  -- spam | offensive | misinformation | other
  reviewed    boolean DEFAULT false,
  reviewed_by uuid REFERENCES members(id),
  reviewed_at timestamptz,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (post_id, reporter_id)   -- one report per member per post
);
```

### 8.3 Key RLS Policies (Row Level Security)

```sql
-- Members: visible only to other active members
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_select" ON members
  FOR SELECT USING (
    auth.jwt() ->> 'role' IN ('member', 'club_admin', 'district_admin')
    AND status = 'active'
  );

-- Posts: visible to members; own posts always visible to author
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_select" ON posts
  FOR SELECT USING (
    auth.jwt() ->> 'role' IN ('member', 'club_admin', 'district_admin')
    AND status IN ('active', 'under_review')
  );

CREATE POLICY "posts_insert" ON posts
  FOR INSERT WITH CHECK (
    auth.jwt() ->> 'role' IN ('member', 'club_admin', 'district_admin')
  );

CREATE POLICY "posts_update_own" ON posts
  FOR UPDATE USING (
    author_id = (SELECT id FROM members WHERE clerk_user_id = auth.jwt() ->> 'sub')
  );

-- Reactions: members only
ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reactions_all" ON post_reactions
  FOR ALL USING (
    auth.jwt() ->> 'role' IN ('member', 'club_admin', 'district_admin')
  );

-- Comments: members can see all; delete own only
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments_select" ON post_comments
  FOR SELECT USING (
    auth.jwt() ->> 'role' IN ('member', 'club_admin', 'district_admin')
    AND deleted_at IS NULL
  );

CREATE POLICY "comments_insert" ON post_comments
  FOR INSERT WITH CHECK (
    auth.jwt() ->> 'role' IN ('member', 'club_admin', 'district_admin')
  );
```

---

## 9. API Routes

### 9.1 Auth & Identity

| Method | Route | Auth required | Description |
|--------|-------|---------------|-------------|
| POST | `/api/claim` | Clerk session (guest) | Submit Lion ID claim |
| GET | `/api/claim/status` | Clerk session | Check claim status |

### 9.2 Members & Search

| Method | Route | Auth required | Description |
|--------|-------|---------------|-------------|
| GET | `/api/members` | member | Paginated member list |
| GET | `/api/members/[id]` | member | Single member profile |
| PATCH | `/api/members/[id]` | member (own) | Update own profile |
| POST | `/api/search` | member | NL search via Claude + Supabase |

### 9.3 Feed — Posts

| Method | Route | Auth required | Description |
|--------|-------|---------------|-------------|
| GET | `/api/posts` | member | Paginated feed (cursor-based) |
| POST | `/api/posts` | member | Create a post |
| PATCH | `/api/posts/[id]` | member (own) | Edit post text |
| DELETE | `/api/posts/[id]` | member (own) or admin | Soft-delete post |
| POST | `/api/posts/[id]/report` | member | Report a post |

### 9.4 Feed — Reactions

| Method | Route | Auth required | Description |
|--------|-------|---------------|-------------|
| POST | `/api/posts/[id]/reactions` | member | Add or replace reaction |
| DELETE | `/api/posts/[id]/reactions` | member | Remove own reaction |

### 9.5 Feed — Comments

| Method | Route | Auth required | Description |
|--------|-------|---------------|-------------|
| GET | `/api/posts/[id]/comments` | member | Paginated comments (oldest first) |
| POST | `/api/posts/[id]/comments` | member | Add comment |
| DELETE | `/api/posts/[id]/comments/[commentId]` | member (own) or admin | Delete comment |

### 9.6 Admin

| Method | Route | Auth required | Description |
|--------|-------|---------------|-------------|
| GET | `/api/admin/claims` | club_admin / district_admin | List pending claims |
| POST | `/api/admin/claims/[id]/approve` | club_admin / district_admin | Approve claim |
| POST | `/api/admin/claims/[id]/reject` | club_admin / district_admin | Reject claim with note |
| GET | `/api/admin/reports` | club_admin / district_admin | List flagged posts |
| POST | `/api/admin/reports/[id]/dismiss` | club_admin / district_admin | Dismiss report |
| POST | `/api/admin/members/[id]/ban` | district_admin | Ban member from posting |

### 9.7 Storage

| Method | Route | Auth required | Description |
|--------|-------|---------------|-------------|
| POST | `/api/upload` | member | Presigned URL for Supabase Storage image upload |

All image uploads go through `/api/upload` which validates file type and size before issuing a presigned Supabase Storage URL. The client uploads directly to Supabase; the returned public URL is what gets stored in `posts.image_urls[]`.

---

## 10. Security & Access Control

### 10.1 JWT Flow (Clerk → Supabase)

1. Clerk issues a JWT containing `sub` (Clerk user ID) and `publicMetadata.role`.
2. Next.js API routes use `@clerk/nextjs` to validate the session and extract the JWT.
3. The Supabase client is initialized with the Clerk JWT passed as the `Authorization` header.
4. Supabase RLS policies read `auth.jwt() ->> 'role'` and `auth.jwt() ->> 'sub'` to enforce access rules.

### 10.2 Key Security Rules

- No unauthenticated access to any member data or feed content.
- `guest` users see only the claim form — RLS blocks all other tables.
- Member phone numbers and emails are never exposed via the member list endpoint — only via the individual profile endpoint, subject to the member's `show_phone` / `show_email` settings.
- Image uploads are scoped to authenticated members only. Supabase Storage bucket policy mirrors RLS.
- The Anthropic API key is stored as a Vercel environment variable and never sent to the client.
- Rate limiting on post creation (10 posts / 24h per member) is enforced at the API route level before the Supabase insert.

### 10.3 Moderation Scope

| Action | member | club_admin | district_admin |
|--------|--------|------------|----------------|
| Delete own post | ✓ | ✓ | ✓ |
| Delete others' post | ✗ | Own club only | ✓ |
| Delete any comment | ✗ | Own club only | ✓ |
| Approve claims | ✗ | Own club only | ✓ |
| Ban member from posting | ✗ | ✗ | ✓ |
| View reports dashboard | ✗ | ✓ | ✓ |

---

## 11. Non-Functional Requirements

### 11.1 Performance

- Feed initial load: < 1.5s (p95) on 4G.
- NL search response (including Claude + Supabase round-trip): < 4s (p95).
- Image upload: client uploads directly to Supabase Storage via presigned URL; should not add latency to post creation.
- Supabase Realtime subscription for reaction/comment count updates: < 500ms propagation.

### 11.2 Scalability

- District 321 C1 has approximately 1,200 members. The platform is designed for up to 5,000 members without architectural changes.
- Supabase free tier is acceptable for launch; upgrade to Pro when storage exceeds 500 MB or DB size exceeds 500 MB.

### 11.3 Availability

- Vercel: 99.99% uptime SLA on Pro plan.
- Supabase: 99.9% uptime SLA on Pro plan.
- LLM dependency (Claude): if the Anthropic API is unavailable, the search feature degrades gracefully to direct `pg_trgm` fuzzy search. The rest of the platform is unaffected.

### 11.4 Accessibility

- All interactive elements have keyboard focus states.
- Images in posts require alt text input from the poster (optional field but prompted).
- Minimum contrast ratio of 4.5:1 for all body text.
- Feed is usable on mobile screens from 375px width.

### 11.5 Data Retention

- Deleted posts and comments retain their row in the database (soft delete) for 90 days, after which a scheduled Supabase function purges them.
- Reaction data is hard-deleted when the associated post is hard-deleted.
- Uploaded images in Supabase Storage for deleted posts are purged on the same 90-day schedule.

---

## 12. Open Questions

| # | Question | Owner | Due |
|---|----------|-------|-----|
| 1 | Should the feed be district-wide only, or should members also be able to filter by club? | District admin committee | Before development begins |
| 2 | Do we want push notifications (PWA or email) when a member's post gets a comment? | Product owner | Sprint 2 |
| 3 | Should there be a dedicated "Announcements" post type that only admins can create, which is pinned to the top? | District admin committee | Before Sprint 1 |
| 4 | What is the exact Lion ID format? Is it numeric, alphanumeric, club-prefixed? This affects the claim validation regex. | District admin | Before development begins |
| 5 | Should `club_admin` be able to approve claims from any club, or only their own? The schema currently restricts to own club. | District admin committee | Before Sprint 1 |
| 6 | Do we need a mobile app (React Native / Expo) in v1, or is a mobile-responsive web app sufficient? | Technology committee | Before project kickoff |

---

## 13. Out of Scope (v1)

The following are explicitly deferred to a future release:

- **Direct messaging** between members.
- **Events calendar** — listing Lion meetings, fundraisers, and service projects.
- **Nested comment replies** — v1 has flat comment threads only.
- **Post scheduling** — posts go live immediately.
- **Club-level sub-feeds** — v1 has a single district-wide feed.
- **Mobile application** — v1 is a responsive web app; native apps are a v2 consideration.
- **Search analytics dashboard** — recording which queries were run, for district intelligence.
- **Email digest** — weekly email summarising top posts and new members.
- **Member endorsements** — Lions vouching for each other's professional expertise.
- **Lions project showcase** — dedicated feature for posting about service projects with structured fields.

---

*Document prepared for Lions Club District 321 C1. All data is private to verified members and subject to the district's data privacy policy.*
