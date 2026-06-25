require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { clerkMiddleware, getAuth } = require('@clerk/express');
const multer = require('multer');
const rag = require('./rag');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only JPEG, PNG, and WEBP images are allowed'));
    }
});

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

// --- Supabase clients ---
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Admin client (service role — for server-side operations, bypasses RLS)
const supabase = supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    })
    : null;

const supabaseConfigured = !!(supabaseUrl && supabaseServiceKey);

// --- Clerk config ---
const clerkConfigured = !!(process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const tempAdminId = process.env.TEMP_ADMIN_ID || '';
const tempAdminPassword = process.env.TEMP_ADMIN_PASSWORD || '';
const tempAdminTokenSecret = process.env.TEMP_ADMIN_TOKEN_SECRET || process.env.CLERK_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const tempAdminConfigured = !!(tempAdminId && tempAdminPassword && tempAdminTokenSecret);
const tempAdminSessionMs = 2 * 60 * 60 * 1000;
const VALID_MEMBER_ROLES = ['guest', 'member', 'club_admin', 'district_admin'];
const VALID_MEMBER_STATUSES = ['pending', 'active', 'suspended'];
const protectedPages = [
    '/directory.html',
    '/feed.html',
    '/profile.html',
    '/admin.html',
    '/dg-office.html',
    '/gallery.html'
];

// --- Auth middleware: verify Clerk JWT and look up member record ---
app.use((req, res, next) => {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer temp.')) {
        req.tempAdminAuthorization = authHeader;
        delete req.headers.authorization;
    }
    next();
});

app.use(clerkMiddleware());

app.use((req, res, next) => {
    if (req.tempAdminAuthorization) {
        req.headers.authorization = req.tempAdminAuthorization;
    }
    next();
});

function parseCookies(req) {
    const header = req.headers.cookie || '';
    return header.split(';').reduce((cookies, part) => {
        const index = part.indexOf('=');
        if (index === -1) return cookies;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (key) cookies[key] = decodeURIComponent(value);
        return cookies;
    }, {});
}

function signTempAdminPayload(payloadBase64) {
    return crypto
        .createHmac('sha256', tempAdminTokenSecret)
        .update(payloadBase64)
        .digest('base64url');
}

function safeEqual(left, right) {
    const leftBuffer = Buffer.from(left || '');
    const rightBuffer = Buffer.from(right || '');
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createTempAdminToken() {
    const payload = {
        sub: 'temp_admin:' + tempAdminId,
        name: 'Temporary Admin',
        email: tempAdminId,
        role: 'district_admin',
        exp: Date.now() + tempAdminSessionMs
    };
    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return 'temp.' + payloadBase64 + '.' + signTempAdminPayload(payloadBase64);
}

function verifyTempAdminToken(token) {
    if (!tempAdminConfigured || !token || !token.startsWith('temp.')) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const expected = signTempAdminPayload(parts[1]);
    if (!safeEqual(parts[2], expected)) return null;

    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!payload || payload.sub !== 'temp_admin:' + tempAdminId) return null;
        if (!payload.exp || payload.exp < Date.now()) return null;
        return payload;
    } catch (err) {
        return null;
    }
}

function getTempAdminTokenFromRequest(req) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer temp.')) {
        return authHeader.slice('Bearer '.length);
    }
    return parseCookies(req).temp_admin_token || null;
}

function buildTempAdminMember(payload) {
    return {
        id: null,
        clerk_user_id: payload.sub,
        name: payload.name || 'Temporary Admin',
        email: payload.email || tempAdminId,
        club: 'District 321 C1',
        designation: 'Temporary Admin',
        location: 'Admin',
        role: 'district_admin',
        status: 'active',
        isTempAdmin: true
    };
}

async function memberMiddleware(req, res, next) {
    const tempPayload = verifyTempAdminToken(getTempAdminTokenFromRequest(req));
    if (tempPayload) {
        req.currentUserId = tempPayload.sub;
        req.currentMember = buildTempAdminMember(tempPayload);
        return next();
    }

    const { userId } = getAuth(req);
    if (!userId) {
        req.currentUserId = null;
        req.currentMember = null;
        return next();
    }

    req.currentUserId = userId;

    if (supabase) {
        const { data: member } = await supabase
            .from('members')
            .select('*')
            .eq('clerk_user_id', userId)
            .maybeSingle();

        req.currentMember = member || null;
    } else {
        req.currentMember = null;
    }
    next();
}

app.use(memberMiddleware);

// --- Helper: require a signed-in Clerk session ---
function requireSignedIn(req, res, next) {
    if (req.currentUserId) return next();

    if (protectedPages.includes(req.path)) {
        return res.redirect(302, '/login.html?next=' + encodeURIComponent(req.originalUrl));
    }

    return res.status(401).json({ error: 'Authentication required' });
}

// --- Helper: require a verified member ---
function requireMember(req, res, next) {
    if (!supabase) {
        return res.status(501).json({ error: 'Supabase not configured' });
    }
    if (!req.currentMember) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.currentMember.status !== 'active') {
        return res.status(403).json({ error: 'Account not active. Please contact an admin.' });
    }
    if (req.currentMember.role === 'guest') {
        return res.status(403).json({ error: 'Lion ID verification required' });
    }
    next();
}

// --- Helper: require admin (club_admin or district_admin) ---
function requireAdmin(req, res, next) {
    if (!req.currentMember) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.currentMember.status !== 'active') {
        return res.status(403).json({ error: 'Account not active. Please contact an admin.' });
    }
    if (!['club_admin', 'district_admin'].includes(req.currentMember.role)) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

function sanitizeMemberForClient(member) {
    if (!member) return null;
    const showPhone = member.show_phone !== false;
    const showEmail = member.show_email === true;

    return {
        id: member.id,
        name: member.name,
        email: showEmail ? member.email : null,
        phone: showPhone ? member.phone : null,
        address: member.address,
        profession: member.profession,
        specialty: member.specialty,
        club: member.club,
        designation: member.designation,
        location: member.location,
        year_of_joining: member.year_of_joining,
        profile_photo_url: member.profile_photo_url,
        show_phone: showPhone,
        show_email: showEmail,
        role: member.role,
        status: member.status,
        relevance: member.relevance
    };
}

function validateMemberRole(role) {
    if (role && !VALID_MEMBER_ROLES.includes(role)) {
        const err = new Error('Invalid member role');
        err.statusCode = 400;
        throw err;
    }
}

function validateMemberStatus(status) {
    if (status && !VALID_MEMBER_STATUSES.includes(status)) {
        const err = new Error('Invalid member status');
        err.statusCode = 400;
        throw err;
    }
}

function parseNonNegativeInteger(value, fieldName) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
        const err = new Error(`${fieldName} must be a non-negative integer`);
        err.statusCode = 400;
        throw err;
    }
    return number;
}

const DEFAULT_PUBLIC_STATS = {
    members: 34,
    clubs: 16,
    years: new Date().getFullYear() - 1957
};

const DEFAULT_UPCOMING_EVENTS = [
    'Installation Ceremony',
    'Blood Donation Camp',
    'Cabinet Meeting'
];

async function getComputedStats(req) {
    let membersCount = 0;
    let clubsCount = 0;
    let myClubMembers = 0;
    let recentPosts = 0;
    let club = null;
    let designation = null;

    if (supabase) {
        const { count: mCount } = await supabase
            .from('members')
            .select('id', { count: 'exact', head: true });

        if (mCount != null) membersCount = mCount;

        const { data: clubs } = await supabase
            .from('members')
            .select('club')
            .neq('club', null)
            .neq('club', '');

        if (clubs) {
            const uniqueClubs = [...new Set(clubs.map(c => c.club).filter(Boolean))];
            clubsCount = uniqueClubs.length;
        }

        if (req.currentMember) {
            club = req.currentMember.club;
            designation = req.currentMember.designation;
            if (club) {
                const { count: myCount } = await supabase
                    .from('members')
                    .select('id', { count: 'exact', head: true })
                    .eq('club', club);
                if (myCount != null) myClubMembers = myCount;
            }
        }

        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { count: pCount } = await supabase
            .from('posts')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', since)
            .in('status', ['active', 'under_review']);
        if (pCount != null) recentPosts = pCount;
    }

    return {
        members: membersCount || DEFAULT_PUBLIC_STATS.members,
        clubs: clubsCount || DEFAULT_PUBLIC_STATS.clubs,
        myClubMembers,
        recentPosts,
        club,
        designation,
        years: DEFAULT_PUBLIC_STATS.years
    };
}

async function getPublicStatOverrides() {
    if (!supabase) return null;

    try {
        const { data, error } = await supabase
            .from('site_stats')
            .select('members, clubs, years, updated_at')
            .eq('id', 1)
            .maybeSingle();

        if (error) {
            console.warn('[Stats] site_stats override unavailable:', error.message);
            return null;
        }

        return data || null;
    } catch (err) {
        console.warn('[Stats] site_stats override unavailable:', err.message);
        return null;
    }
}

function applyPublicStatOverrides(stats, overrides) {
    if (!overrides) return stats;

    return {
        ...stats,
        members: overrides.members != null ? overrides.members : stats.members,
        clubs: overrides.clubs != null ? overrides.clubs : stats.clubs,
        years: overrides.years != null ? overrides.years : stats.years
    };
}

function normalizeEventRows(rows) {
    return (rows || [])
        .map(row => ({
            id: row.id,
            title: String(row.title || '').trim(),
            display_order: row.display_order || 0
        }))
        .filter(event => event.title);
}

async function getUpcomingEvents(options = {}) {
    const fallbackToDefaults = options.fallbackToDefaults !== false;
    if (!supabase) {
        return fallbackToDefaults
            ? DEFAULT_UPCOMING_EVENTS.map((title, index) => ({ id: null, title, display_order: index + 1 }))
            : [];
    }

    try {
        const { data, error } = await supabase
            .from('site_events')
            .select('id, title, display_order')
            .eq('is_active', true)
            .order('display_order', { ascending: true })
            .order('id', { ascending: true });

        if (error) throw error;
        return normalizeEventRows(data);
    } catch (err) {
        console.warn('[Events] site_events unavailable:', err.message);
        if (fallbackToDefaults) {
            return DEFAULT_UPCOMING_EVENTS.map((title, index) => ({ id: null, title, display_order: index + 1 }));
        }
        throw err;
    }
}

function parseUpcomingEvents(value) {
    if (!Array.isArray(value)) {
        const err = new Error('events must be an array');
        err.statusCode = 400;
        throw err;
    }

    if (value.length > 10) {
        const err = new Error('events cannot contain more than 10 items');
        err.statusCode = 400;
        throw err;
    }

    return value.map(item => {
        const title = typeof item === 'string' ? item : item && item.title;
        return String(title || '').trim();
    }).filter(Boolean).map(title => {
        if (title.length > 80) {
            const err = new Error('event titles must be 80 characters or less');
            err.statusCode = 400;
            throw err;
        }
        return title;
    });
}

async function adminCanModeratePost(member, postId) {
    if (!member || !supabase) return false;
    if (member.role === 'district_admin') return true;
    if (member.role !== 'club_admin') return false;

    const { data: post } = await supabase
        .from('posts')
        .select('author_id')
        .eq('id', postId)
        .maybeSingle();

    if (!post || !post.author_id) return false;

    const { data: author } = await supabase
        .from('members')
        .select('club')
        .eq('id', post.author_id)
        .maybeSingle();

    return !!author && author.club === member.club;
}

// --- Middleware ---
app.use(cors());
app.use(express.json());

app.get(protectedPages, requireSignedIn, (req, res) => {
    res.sendFile(path.join(__dirname, '..', req.path.slice(1)));
});

app.get('/data/*', requireMember, (req, res, next) => {
    const dataRoot = path.join(__dirname, '..', 'data');
    const requestedPath = path.normalize(path.join(dataRoot, req.params[0] || ''));

    if (!requestedPath.startsWith(dataRoot)) {
        return res.status(400).json({ error: 'Invalid data path' });
    }

    res.sendFile(requestedPath, (err) => {
        if (err) next();
    });
});

// Serve static files from parent directory (local dev only; Vercel handles statics natively)
if (!process.env.VERCEL) {
    app.use(express.static(path.join(__dirname, '..')));
}

// --- Auth config endpoint ---
app.get('/api/auth/config', (req, res) => {
    res.json({
        clerkConfigured,
        clerkPublishableKey: clerkConfigured ? process.env.CLERK_PUBLISHABLE_KEY : null,
        tempAdminConfigured
    });
});

app.post('/api/auth/temp-admin/login', (req, res) => {
    if (!tempAdminConfigured) {
        return res.status(404).json({ error: 'Temporary admin login is not configured' });
    }

    const { adminId, password } = req.body || {};
    if (adminId !== tempAdminId || password !== tempAdminPassword) {
        return res.status(401).json({ error: 'Invalid temporary admin credentials' });
    }

    const token = createTempAdminToken();
    res.cookie('temp_admin_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: !!process.env.VERCEL,
        path: '/',
        maxAge: tempAdminSessionMs
    });
    res.json({
        token,
        user: {
            id: 'temp_admin:' + tempAdminId,
            fullName: 'Temporary Admin',
            email: tempAdminId,
            isTempAdmin: true
        }
    });
});

app.get('/api/auth/temp-admin/session', (req, res) => {
    if (!req.currentMember || !req.currentMember.isTempAdmin) {
        return res.status(401).json({ error: 'No temporary admin session' });
    }
    res.json({
        user: {
            id: req.currentUserId,
            fullName: req.currentMember.name,
            email: req.currentMember.email,
            isTempAdmin: true
        },
        profile: req.currentMember
    });
});

app.post('/api/auth/temp-admin/logout', (req, res) => {
    res.clearCookie('temp_admin_token', {
        httpOnly: true,
        sameSite: 'lax',
        secure: !!process.env.VERCEL,
        path: '/'
    });
    res.json({ success: true });
});

// --- Members API (Supabase) ---
app.get('/api/members', requireMember, async (req, res) => {
    try {
        let members;
        if (supabase) {
            const { data, error } = await supabase
                .from('members')
                .select('*')
                .order('id', { ascending: true });
            if (error) throw error;
            members = data;
        } else {
            members = rag.getStaticMembers();
        }
        const visibleMembers = (members || [])
            .filter(member => member.status === 'active' && member.role !== 'guest')
            .map(sanitizeMemberForClient);
        res.json({ members: visibleMembers, total: visibleMembers.length });
    } catch (err) {
        console.error('[API] Error fetching members:', err.message);
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

// --- AI Search endpoint ---
app.post('/api/ai-search', requireMember, async (req, res) => {
    try {
        const { query } = req.body;
        if (!query || !query.trim()) {
            return res.status(400).json({ error: 'Query is required' });
        }

        let members;
        if (supabase) {
            const { data, error } = await supabase
                .from('members')
                .select('*')
                .order('id', { ascending: true });
            if (error) throw error;
            if (data) {
                members = data.filter(member => member.status === 'active' && member.role !== 'guest');
                rag.setMembers(members);
                await rag.ensureEmbeddings(
                    DEEPSEEK_API_KEY && DEEPSEEK_API_KEY !== 'your_deepseek_api_key_here' ? DEEPSEEK_API_KEY : null
                );
            }
        }
        if (!members) {
            members = rag.members.length > 0 ? rag.members : rag.getStaticMembers();
        }

        const relevantMembers = rag.searchMembers(query, 5)
            .map(sanitizeMemberForClient)
            .filter(Boolean);

        const contextParts = relevantMembers.map((m, i) => {
            return `[Member ${i + 1}]
Name: ${m.name}
Designation: ${m.designation}
Club: ${m.club}
Location: ${m.location}
Profession: ${m.profession}${m.specialty ? ' (' + m.specialty + ')' : ''}
Phone: ${m.phone || 'Hidden'}
Email: ${m.email || 'Hidden'}
Address: ${m.address}${m.year_of_joining ? '\nYear of Joining: ' + m.year_of_joining : ''}`;
        });

        const context = contextParts.join('\n\n');

        let aiResponse = '';
        let llmUsed = false;

        if (DEEPSEEK_API_KEY && DEEPSEEK_API_KEY !== 'your_deepseek_api_key_here') {
            try {
                const systemPrompt = `You are an assistant for Lions Club District 321 C1, helping members find other Lions members who can help with specific needs. 

Given a user's query and a list of relevant members from the directory, recommend the most suitable members and explain WHY they are relevant to the query. 

Rules:
- Only recommend members from the provided list — never make up names.
- If no member fits well, say so honestly.
- Be concise but helpful. Format your response with bullet points for each recommended member.
- Include their name, designation, location, profession, and contact info.
- If the query is about a specific skill or profession (e.g., "I need a doctor"), prioritize members with matching professions.
- If the query is about a location, prioritize members from that area.`;

                const llmResp = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: DEEPSEEK_MODEL,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: `QUERY: ${query}\n\nRELEVANT MEMBERS FROM DIRECTORY:\n${context}` }
                        ],
                        temperature: 0.3,
                        max_tokens: 600
                    })
                });

                if (llmResp.ok) {
                    const data = await llmResp.json();
                    aiResponse = data.choices?.[0]?.message?.content || '';
                    llmUsed = true;
                }
            } catch (e) {
                console.warn('[LLM] DeepSeek call failed:', e.message);
            }
        }

        res.json({
            query,
            relevantMembers,
            aiResponse: aiResponse || null,
            llmUsed,
            totalMembers: members.length
        });

    } catch (err) {
        console.error('[API] Error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Profile API ---
app.get('/api/profile', async (req, res) => {
    try {
        if (!req.currentUserId) return res.status(401).json({ error: 'Authentication required' });
        if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });
        if (req.currentMember && req.currentMember.isTempAdmin) {
            return res.json({ profile: req.currentMember });
        }

        const { data, error } = await supabase
            .from('members')
            .select('*')
            .eq('clerk_user_id', req.currentUserId)
            .maybeSingle();

        if (error) throw error;
        res.json({ profile: data || null });
    } catch (err) {
        console.error('[Profile] GET error:', err.message);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

app.put('/api/profile', async (req, res) => {
    try {
        if (!req.currentUserId) return res.status(401).json({ error: 'Authentication required' });
        if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

        const {
            name, email, phone, address, profession,
            specialty, club, designation, location, year_of_joining, profile_photo_url
        } = req.body;

        if (!name) return res.status(400).json({ error: 'Name is required' });
        if (!club) return res.status(400).json({ error: 'Club name is required' });
        if (!designation) return res.status(400).json({ error: 'Designation is required' });
        if (!location) return res.status(400).json({ error: 'Location is required' });

        const { data: existing } = await supabase
            .from('members')
            .select('id')
            .eq('clerk_user_id', req.currentUserId)
            .maybeSingle();

        let data, error;

        if (existing) {
            ({ data, error } = await supabase
                .from('members')
                .update({
                    name, email, phone, address, profession,
                    specialty, club, designation, location,
                    year_of_joining: year_of_joining ? parseInt(year_of_joining) : null,
                    profile_photo_url: profile_photo_url || null
                })
                .eq('clerk_user_id', req.currentUserId)
                .select()
                .single());
        } else {
            ({ data, error } = await supabase
                .from('members')
                .insert([{
                    clerk_user_id: req.currentUserId,
                    name, email, phone, address, profession,
                    specialty, club, designation, location,
                    year_of_joining: year_of_joining ? parseInt(year_of_joining) : null,
                    profile_photo_url: profile_photo_url || null,
                    role: 'guest',
                    status: 'pending'
                }])
                .select()
                .single());
        }

        if (error) throw error;
        res.json({ profile: data });
    } catch (err) {
        console.error('[Profile] PUT error:', err.message);
        res.status(500).json({ error: 'Failed to save profile' });
    }
});

// ====================================================================
// FEED API — Community Feed (Posts, Reactions, Comments, Reports)
// ====================================================================

// --- Upload image to Supabase Storage ---
app.post('/api/upload', upload.single('image'), requireMember, async (req, res) => {
    try {
        const member = req.currentMember;

        if (!req.file) return res.status(400).json({ error: 'Image file required' });

        const ext = req.file.mimetype === 'image/png' ? 'png'
            : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
        const filename = `${member.id}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;

        const { data, error } = await supabase.storage
            .from('post-images')
            .upload(`posts/${filename}`, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });

        if (error) throw error;

        const { data: urlData } = supabase.storage
            .from('post-images')
            .getPublicUrl(`posts/${filename}`);

        res.json({ url: urlData.publicUrl });
    } catch (err) {
        console.error('[Upload] Error:', err.message);
        res.status(500).json({ error: 'Image upload failed: ' + err.message });
    }
});

// --- Upload profile photo ---
app.post('/api/upload-photo', upload.single('photo'), requireMember, async (req, res) => {
    try {
        const member = req.currentMember;
        if (!req.file) return res.status(400).json({ error: 'Photo file required' });

        const ext = req.file.mimetype === 'image/png' ? 'png'
            : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
        const filename = 'profile_' + member.id + '.' + ext;

        const { error } = await supabase.storage
            .from('profile-photos')
            .upload(filename, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: true
            });

        if (error) throw error;

        const { data: urlData } = supabase.storage
            .from('profile-photos')
            .getPublicUrl(filename);

        res.json({ url: urlData.publicUrl });
    } catch (err) {
        console.error('[Upload Photo] Error:', err.message);
        res.status(500).json({ error: 'Photo upload failed: ' + err.message });
    }
});

// --- Create a post ---
app.post('/api/posts', requireMember, async (req, res) => {
    try {
        const member = req.currentMember;
        const { content_type, body, image_urls } = req.body;

        const validTypes = ['text', 'image', 'text_image'];
        if (!validTypes.includes(content_type)) {
            return res.status(400).json({ error: 'Invalid content_type' });
        }

        if (content_type === 'text' && (!body || !body.trim())) {
            return res.status(400).json({ error: 'Post body is required' });
        }
        if (content_type === 'image' && (!image_urls || image_urls.length === 0)) {
            return res.status(400).json({ error: 'At least one image is required' });
        }
        if (content_type === 'text_image' && (!body || !body.trim()) && (!image_urls || image_urls.length === 0)) {
            return res.status(400).json({ error: 'Text or image required' });
        }

        if (body) {
            const maxLen = content_type === 'text' ? 2000 : 1000;
            if (body.length > maxLen) {
                return res.status(400).json({ error: `Body exceeds ${maxLen} characters` });
            }
        }

        if (image_urls && image_urls.length > 4) {
            return res.status(400).json({ error: 'Maximum 4 images per post' });
        }

        // Rate limiting: max 10 posts per 24 hours
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count, error: countErr } = await supabase
            .from('posts')
            .select('id', { count: 'exact', head: true })
            .eq('author_id', member.id)
            .gte('created_at', since);
        if (!countErr && count >= 10) {
            return res.status(429).json({ error: 'Post limit reached (10 per 24 hours). Please try again later.' });
        }

        // Check ban status
        if (member.can_post_until && new Date(member.can_post_until) > new Date()) {
            return res.status(403).json({ error: 'Posting temporarily restricted' });
        }

        const postData = {
            author_id: member.id,
            content_type,
            body: body || null,
            image_urls: image_urls || null,
            status: 'active',
            comment_count: 0
        };

        const { data, error } = await supabase
            .from('posts')
            .insert([postData])
            .select('id, author_id, content_type, body, image_urls, status, comment_count, edited_at, deleted_at, created_at')
            .single();

        if (error) throw error;

        const post = {
            ...data,
            author: {
                id: member.id,
                name: member.name,
                profile_photo_url: member.profile_photo_url,
                club: member.club,
                location: member.location
            }
        };

        res.status(201).json({ post });
    } catch (err) {
        console.error('[Posts] Create error:', err.message);
        res.status(500).json({ error: 'Failed to create post' });
    }
});

// --- Get feed (paginated) ---
app.get('/api/posts', requireMember, async (req, res) => {
    try {
        const cursor = req.query.cursor;
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);

        let query = supabase
            .from('posts')
            .select(`
                id, author_id, content_type, body, image_urls, status,
                comment_count, edited_at, deleted_at, created_at
            `)
            .in('status', ['active', 'under_review'])
            .order('created_at', { ascending: false })
            .limit(limit + 1);

        if (cursor) {
            query = query.lt('created_at', cursor);
        }

        const { data, error } = await query;

        if (error) throw error;

        // Fetch authors separately
        const authorIds = [...new Set((data || []).map(p => p.author_id).filter(Boolean))];
        const { data: authors } = await supabase
            .from('members')
            .select('id, name, profile_photo_url, club, location')
            .in('id', authorIds);

        const authorMap = {};
        (authors || []).forEach(a => { authorMap[a.id] = a; });

        const hasMore = data.length > limit;
        const posts = (hasMore ? data.slice(0, limit) : data).map(p => ({
            ...p,
            author: authorMap[p.author_id] || null
        }));

        res.json({ posts, hasMore, nextCursor: hasMore ? posts[posts.length - 1].created_at : null });
    } catch (err) {
        console.error('[Posts] List error:', err.message);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
});

// --- Edit a post ---
app.patch('/api/posts/:postId', requireMember, async (req, res) => {
    try {
        const member = req.currentMember;
        const { postId } = req.params;
        const { body } = req.body;

        if (!body || !body.trim()) {
            return res.status(400).json({ error: 'Post body is required' });
        }

        const { data: post } = await supabase
            .from('posts')
            .select('author_id, content_type, status')
            .eq('id', postId)
            .maybeSingle();

        if (!post) return res.status(404).json({ error: 'Post not found' });
        if (post.author_id !== member.id) return res.status(403).json({ error: 'Not authorized' });
        if (post.status === 'deleted') return res.status(400).json({ error: 'Post has been deleted' });

        const maxLen = post.content_type === 'text_image' ? 1000 : 2000;
        if (body.length > maxLen) {
            return res.status(400).json({ error: `Body exceeds ${maxLen} characters` });
        }

        const { data, error } = await supabase
            .from('posts')
            .update({ body, edited_at: new Date().toISOString() })
            .eq('id', postId)
            .select('*')
            .single();

        if (error) throw error;
        res.json({ post: data });
    } catch (err) {
        console.error('[Posts] Edit error:', err.message);
        res.status(500).json({ error: 'Failed to edit post' });
    }
});

// --- Delete a post (soft delete) ---
app.delete('/api/posts/:postId', requireMember, async (req, res) => {
    try {
        const member = req.currentMember;
        const { postId } = req.params;

        const { data: post } = await supabase
            .from('posts')
            .select('author_id')
            .eq('id', postId)
            .maybeSingle();

        if (!post) return res.status(404).json({ error: 'Post not found' });

        const isAuthor = post.author_id === member.id;
        const isAdmin = member.role === 'district_admin';
        const isClubAdmin = member.role === 'club_admin';

        if (!isAuthor && !isAdmin && !isClubAdmin) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        if (isClubAdmin && !isAdmin && !isAuthor) {
            const { data: author } = await supabase
                .from('members')
                .select('club')
                .eq('id', post.author_id)
                .maybeSingle();
            if (!author || author.club !== member.club) {
                return res.status(403).json({ error: 'Not authorized — different club' });
            }
        }

        const { error } = await supabase
            .from('posts')
            .update({ status: 'deleted', deleted_at: new Date().toISOString() })
            .eq('id', postId);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('[Posts] Delete error:', err.message);
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

// --- Add or replace reaction ---
app.post('/api/posts/:postId/reactions', requireMember, async (req, res) => {
    try {
        const member = req.currentMember;
        const { postId } = req.params;
        const { emoji } = req.body;

        const allowed = ['👍', '❤️', '👏', '🙏', '💡'];
        if (!allowed.includes(emoji)) {
            return res.status(400).json({ error: 'Invalid reaction emoji' });
        }

        const { data: post } = await supabase
            .from('posts')
            .select('id, status')
            .eq('id', postId)
            .maybeSingle();

        if (!post) return res.status(404).json({ error: 'Post not found' });
        if (post.status === 'deleted') return res.status(400).json({ error: 'Post has been deleted' });

        // Upsert: remove existing then insert new
        await supabase
            .from('post_reactions')
            .delete()
            .eq('post_id', postId)
            .eq('member_id', member.id);

        const { data, error } = await supabase
            .from('post_reactions')
            .insert([{ post_id: postId, member_id: member.id, emoji }])
            .select('*')
            .single();

        if (error) throw error;

        const { data: counts } = await supabase
            .from('post_reactions')
            .select('emoji')
            .eq('post_id', postId);

        const reactionCounts = {};
        (counts || []).forEach(r => {
            reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
        });

        res.json({ reaction: data, reactionCounts, myReaction: emoji });
    } catch (err) {
        console.error('[Reactions] Error:', err.message);
        res.status(500).json({ error: 'Failed to update reaction' });
    }
});

// --- Remove own reaction ---
app.delete('/api/posts/:postId/reactions', requireMember, async (req, res) => {
    try {
        const member = req.currentMember;
        const { postId } = req.params;

        const { error } = await supabase
            .from('post_reactions')
            .delete()
            .eq('post_id', postId)
            .eq('member_id', member.id);

        if (error) throw error;
        res.json({ success: true, myReaction: null });
    } catch (err) {
        console.error('[Reactions] Delete error:', err.message);
        res.status(500).json({ error: 'Failed to remove reaction' });
    }
});

// --- Get comments for a post ---
app.get('/api/posts/:postId/comments', requireMember, async (req, res) => {
    try {
        const { postId } = req.params;

        const { data: comments, error } = await supabase
            .from('post_comments')
            .select('id, post_id, author_id, body, created_at')
            .eq('post_id', postId)
            .is('deleted_at', null)
            .order('created_at', { ascending: true });

        if (error) throw error;

        const authorIds = [...new Set((comments || []).map(c => c.author_id).filter(Boolean))];
        const { data: authors } = await supabase
            .from('members')
            .select('id, name, profile_photo_url')
            .in('id', authorIds);

        const authorMap = {};
        (authors || []).forEach(a => { authorMap[a.id] = a; });

        const result = (comments || []).map(c => ({
            ...c,
            author: authorMap[c.author_id] || null
        }));

        res.json({ comments: result });
    } catch (err) {
        console.error('[Comments] List error:', err.message);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

// --- Add a comment ---
app.post('/api/posts/:postId/comments', requireMember, async (req, res) => {
    try {
        const member = req.currentMember;
        const { postId } = req.params;
        const { body } = req.body;

        if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required' });
        if (body.length > 500) return res.status(400).json({ error: 'Comment exceeds 500 characters' });

        const { data: post } = await supabase
            .from('posts')
            .select('id, status')
            .eq('id', postId)
            .maybeSingle();

        if (!post) return res.status(404).json({ error: 'Post not found' });
        if (post.status === 'deleted') return res.status(400).json({ error: 'Post has been deleted' });

        const { data: comment, error } = await supabase
            .from('post_comments')
            .insert([{ post_id: postId, author_id: member.id, body: body.trim() }])
            .select('*')
            .single();

        if (error) throw error;

        // Increment comment count
        const { data: currentPost } = await supabase
            .from('posts')
            .select('comment_count')
            .eq('id', postId)
            .single();

        await supabase
            .from('posts')
            .update({ comment_count: (currentPost?.comment_count || 0) + 1 })
            .eq('id', postId);

        res.status(201).json({
            comment: {
                ...comment,
                author: { id: member.id, name: member.name, profile_photo_url: member.profile_photo_url }
            }
        });
    } catch (err) {
        console.error('[Comments] Create error:', err.message);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

// --- Delete a comment ---
app.delete('/api/posts/:postId/comments/:commentId', requireMember, async (req, res) => {
    try {
        const member = req.currentMember;
        const { postId, commentId } = req.params;

        const { data: comment } = await supabase
            .from('post_comments')
            .select('author_id')
            .eq('id', commentId)
            .eq('post_id', postId)
            .maybeSingle();

        if (!comment) return res.status(404).json({ error: 'Comment not found' });

        const isAuthor = comment.author_id === member.id;
        const isAdmin = member.role === 'district_admin';
        const isClubAdmin = member.role === 'club_admin';

        if (!isAuthor && !isAdmin && !isClubAdmin) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        if (isClubAdmin && !isAdmin && !isAuthor) {
            const { data: author } = await supabase
                .from('members')
                .select('club')
                .eq('id', comment.author_id)
                .maybeSingle();
            if (!author || author.club !== member.club) {
                return res.status(403).json({ error: 'Not authorized — different club' });
            }
        }

        const { error } = await supabase
            .from('post_comments')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', commentId);

        if (error) throw error;

        const { data: currentPost } = await supabase
            .from('posts')
            .select('comment_count')
            .eq('id', postId)
            .single();

        await supabase
            .from('posts')
            .update({ comment_count: Math.max(0, (currentPost?.comment_count || 1) - 1) })
            .eq('id', postId);

        res.json({ success: true });
    } catch (err) {
        console.error('[Comments] Delete error:', err.message);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

// --- Report a post ---
app.post('/api/posts/:postId/report', requireMember, async (req, res) => {
    try {
        const member = req.currentMember;
        const { postId } = req.params;
        const { reason } = req.body;

        const validReasons = ['spam', 'offensive', 'misinformation', 'other'];
        if (!validReasons.includes(reason)) {
            return res.status(400).json({ error: 'Invalid reason' });
        }

        const { data: post } = await supabase
            .from('posts')
            .select('id, status')
            .eq('id', postId)
            .maybeSingle();

        if (!post) return res.status(404).json({ error: 'Post not found' });

        const { error } = await supabase
            .from('post_reports')
            .insert([{ post_id: postId, reporter_id: member.id, reason }]);

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({ error: 'You have already reported this post' });
            }
            throw error;
        }

        const { count } = await supabase
            .from('post_reports')
            .select('id', { count: 'exact', head: true })
            .eq('post_id', postId);

        if (count >= 3 && post.status === 'active') {
            await supabase
                .from('posts')
                .update({ status: 'under_review' })
                .eq('id', postId);
        }

        res.json({ success: true, autoFlagged: count >= 3 });
    } catch (err) {
        console.error('[Reports] Error:', err.message);
        res.status(500).json({ error: 'Failed to report post' });
    }
});

// --- Get reactions for posts (batch) ---
app.post('/api/posts/reactions', requireMember, async (req, res) => {
    try {
        const member = req.currentMember;
        const { postIds } = req.body;
        if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
            return res.status(400).json({ error: 'postIds array required' });
        }

        const { data: reactions, error } = await supabase
            .from('post_reactions')
            .select('post_id, emoji, member_id')
            .in('post_id', postIds);

        if (error) throw error;

        const result = {};
        (reactions || []).forEach(r => {
            if (!result[r.post_id]) result[r.post_id] = { counts: {}, myReaction: null };
            result[r.post_id].counts[r.emoji] = (result[r.post_id].counts[r.emoji] || 0) + 1;
            if (r.member_id === member.id) result[r.post_id].myReaction = r.emoji;
        });

        res.json({ reactions: result });
    } catch (err) {
        console.error('[Reactions] Batch error:', err.message);
        res.status(500).json({ error: 'Failed to fetch reactions' });
    }
});

// ====================================================================
// STATS API — Dashboard
// ====================================================================
app.get('/api/stats', async (req, res) => {
    try {
        const computedStats = await getComputedStats(req);
        const overrides = await getPublicStatOverrides();
        res.json(applyPublicStatOverrides(computedStats, overrides));
    } catch (err) {
        console.error('[Stats] Error:', err.message);
        res.status(500).json({ error: 'Failed to load statistics' });
    }
});

// Public upcoming events for right panels
app.get('/api/events', async (req, res) => {
    try {
        const events = await getUpcomingEvents({ fallbackToDefaults: true });
        res.json({ events });
    } catch (err) {
        console.error('[Events] Error:', err.message);
        res.status(500).json({ error: 'Failed to load events' });
    }
});

// ====================================================================
// ADMIN API
// ====================================================================

// --- Get editable public stats (admin only) ---
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const computed = await getComputedStats(req);
        const overrides = await getPublicStatOverrides();
        const stats = applyPublicStatOverrides(computed, overrides);

        res.json({
            stats: {
                members: stats.members,
                clubs: stats.clubs,
                years: stats.years
            },
            computed: {
                members: computed.members,
                clubs: computed.clubs,
                years: computed.years
            },
            overrides: overrides || null
        });
    } catch (err) {
        console.error('[Admin] Stats fetch error:', err.message);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// --- Update editable public stats (admin only) ---
app.put('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

        const members = parseNonNegativeInteger(req.body.members, 'members');
        const clubs = parseNonNegativeInteger(req.body.clubs, 'clubs');
        const years = parseNonNegativeInteger(req.body.years, 'years');

        const payload = {
            id: 1,
            members,
            clubs,
            years,
            updated_by: req.currentMember.id || null,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('site_stats')
            .upsert(payload, { onConflict: 'id' })
            .select('members, clubs, years, updated_at')
            .single();

        if (error) throw error;

        res.json({ stats: data });
    } catch (err) {
        const statusCode = err.statusCode || 500;
        const message = statusCode === 400
            ? err.message
            : 'Failed to update stats. Run the latest Supabase schema if site_stats does not exist.';
        console.error('[Admin] Stats update error:', err.message);
        res.status(statusCode).json({ error: message });
    }
});

// --- Get editable upcoming events (admin only) ---
app.get('/api/admin/events', requireAdmin, async (req, res) => {
    try {
        const events = await getUpcomingEvents({ fallbackToDefaults: false });
        res.json({ events });
    } catch (err) {
        console.error('[Admin] Events fetch error:', err.message);
        res.status(500).json({
            error: 'Failed to fetch events. Run the latest Supabase schema if site_events does not exist.'
        });
    }
});

// --- Update editable upcoming events (admin only) ---
app.put('/api/admin/events', requireAdmin, async (req, res) => {
    try {
        if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

        const events = parseUpcomingEvents(req.body.events);
        const now = new Date().toISOString();
        const updatedBy = req.currentMember.id || null;

        const { error: deleteError } = await supabase
            .from('site_events')
            .delete()
            .neq('id', 0);

        if (deleteError) throw deleteError;

        if (events.length === 0) {
            return res.json({ events: [] });
        }

        const rows = events.map((title, index) => ({
            title,
            display_order: index + 1,
            is_active: true,
            updated_by: updatedBy,
            updated_at: now
        }));

        const { data, error } = await supabase
            .from('site_events')
            .insert(rows)
            .select('id, title, display_order')
            .order('display_order', { ascending: true })
            .order('id', { ascending: true });

        if (error) throw error;

        res.json({ events: normalizeEventRows(data) });
    } catch (err) {
        const statusCode = err.statusCode || 500;
        const message = statusCode === 400
            ? err.message
            : 'Failed to update events. Run the latest Supabase schema if site_events does not exist.';
        console.error('[Admin] Events update error:', err.message);
        res.status(statusCode).json({ error: message });
    }
});

// --- List all members (admin only) ---
app.get('/api/admin/members', requireAdmin, async (req, res) => {
    try {
        if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

        const { data: members, error } = await supabase
            .from('members')
            .select('*')
            .order('id', { ascending: true });

        if (error) throw error;

        res.json({ members: members || [] });
    } catch (err) {
        console.error('[Admin] Members fetch error:', err.message);
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

// --- Update member role or status (admin only) ---
app.put('/api/admin/members/:id', requireAdmin, async (req, res) => {
    try {
        if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

        const { id } = req.params;
        const { role, status } = req.body;

        const updates = {};
        if (role) {
            validateMemberRole(role);
            updates.role = role;
        }
        if (status) {
            validateMemberStatus(status);
            updates.status = status;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'Nothing to update' });
        }

        const { data, error } = await supabase
            .from('members')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json({ member: data });
    } catch (err) {
        if (err.statusCode === 400) {
            return res.status(400).json({ error: err.message });
        }
        console.error('[Admin] Update member error:', err.message);
        res.status(500).json({ error: 'Failed to update member' });
    }
});

// --- List all reports (admin only) ---
app.get('/api/admin/reports', requireAdmin, async (req, res) => {
    try {
        if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

        const { data, error } = await supabase
            .from('post_reports')
            .select(`
                id,
                reason,
                reviewed,
                reviewed_at,
                created_at,
                reporter_id,
                post_id
            `)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        let reports = (data || []).filter(r => !r.reviewed);
        const reporterIds = [...new Set((reports || []).map(r => r.reporter_id).filter(Boolean))];
        const postIds = [...new Set((reports || []).map(r => r.post_id).filter(Boolean))];

        let reporters = [];
        if (reporterIds.length > 0) {
            const { data: reporterRows } = await supabase
                .from('members')
                .select('id, name')
                .in('id', reporterIds);
            reporters = reporterRows || [];
        }

        let posts = [];
        if (postIds.length > 0) {
            const { data: postRows } = await supabase
                .from('posts')
                .select('id, body, status, content_type, image_urls, author_id, created_at')
                .in('id', postIds);
            posts = postRows || [];
        }

        const authorIds = [...new Set((posts || []).map(p => p.author_id).filter(Boolean))];
        let authors = [];
        if (authorIds.length > 0) {
            const { data: authorRows } = await supabase
                .from('members')
                .select('id, name, club, location')
                .in('id', authorIds);
            authors = authorRows || [];
        }

        const reporterMap = {};
        (reporters || []).forEach(r => { reporterMap[r.id] = r; });

        const authorMap = {};
        (authors || []).forEach(a => { authorMap[a.id] = a; });

        const postMap = {};
        (posts || []).forEach(p => {
            postMap[p.id] = {
                id: p.id,
                body: p.body,
                status: p.status,
                content_type: p.content_type,
                image_urls: p.image_urls,
                created_at: p.created_at,
                author: authorMap[p.author_id] || null
            };
        });

        let result = (reports || []).map(r => ({
            id: r.id,
            reason: r.reason,
            reviewed: !!r.reviewed,
            reviewed_at: r.reviewed_at,
            created_at: r.created_at,
            reporter: reporterMap[r.reporter_id] || null,
            post: postMap[r.post_id] || null
        }));

        if (req.currentMember.role === 'club_admin') {
            result = result.filter(r => (
                r.post &&
                r.post.author &&
                r.post.author.club &&
                r.post.author.club === req.currentMember.club
            ));
        }

        res.json({ reports: result });
    } catch (err) {
        console.error('[Admin] Reports fetch error:', err.message);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// --- Dismiss a report (admin only) ---
app.delete('/api/admin/reports/:id', requireAdmin, async (req, res) => {
    try {
        if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

        const { id } = req.params;

        const { data: report, error: fetchError } = await supabase
            .from('post_reports')
            .select('id, post_id')
            .eq('id', id);

        if (fetchError) throw fetchError;
        const reportRow = Array.isArray(report) ? report[0] : report;
        if (!reportRow) return res.status(404).json({ error: 'Report not found' });

        const canModerate = await adminCanModeratePost(req.currentMember, reportRow.post_id);
        if (!canModerate) return res.status(403).json({ error: 'Not authorized' });

        const { error } = await supabase
            .from('post_reports')
            .update({
                reviewed: true,
                reviewed_by: req.currentMember.id || null,
                reviewed_at: new Date().toISOString()
            })
            .eq('id', id);

        if (error) {
            console.warn('[Admin] Report review update failed, falling back to delete:', error.message);
            const { error: deleteError } = await supabase
                .from('post_reports')
                .delete()
                .eq('id', id);
            if (deleteError) throw deleteError;
            return res.json({ success: true, reviewed: false, deleted: true });
        }

        res.json({ success: true, reviewed: true });
    } catch (err) {
        console.error('[Admin] Dismiss report error:', err.message);
        res.status(500).json({ error: 'Failed to dismiss report' });
    }
});

// ====================================================================
// GALLERY API
// ====================================================================

// --- Get gallery images (from posts with images) ---
app.get('/api/gallery', requireMember, async (req, res) => {
    try {
        const images = [];

        if (supabase) {
            const { data: posts, error } = await supabase
                .from('posts')
                .select('id, author_id, body, image_urls, created_at')
                .in('status', ['active', 'under_review'])
                .not('image_urls', 'is', null)
                .order('created_at', { ascending: false })
                .limit(60);

            if (error) throw error;

            const authorIds = [...new Set((posts || []).map(p => p.author_id).filter(Boolean))];

            let authorMap = {};
            if (authorIds.length) {
                const { data: authors } = await supabase
                    .from('members')
                    .select('id, name')
                    .in('id', authorIds);
                (authors || []).forEach(a => { authorMap[a.id] = a; });
            }

            for (const post of (posts || [])) {
                const urls = post.image_urls;
                if (!urls || !urls.length) continue;
                const authorName = authorMap[post.author_id]?.name || 'Lions Member';
                for (const url of urls) {
                    if (url) {
                        images.push({
                            url: url,
                            caption: post.body || null,
                            author: authorName,
                            postId: post.id,
                            createdAt: post.created_at
                        });
                    }
                }
            }
        }

        res.json({ images });
    } catch (err) {
        console.error('[Gallery] Error:', err.message);
        res.status(500).json({ error: 'Failed to load gallery' });
    }
});

// ====================================================================
// Public stats for landing page
// ====================================================================
// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        members: rag.members.length,
        embeddings: true,
        llmConfigured: DEEPSEEK_API_KEY && DEEPSEEK_API_KEY !== 'your_deepseek_api_key_here',
        supabaseConfigured,
        clerkConfigured
    });
});

// Initialize and start
async function start() {
    console.log('[Server] Loading members...');

    let members;
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('members')
                .select('*')
                .order('id', { ascending: true });
            if (!error && data && data.length > 0) {
                members = data;
                console.log(`[Server] Loaded ${members.length} members from Supabase`);
            }
        } catch (e) {
            console.warn('[Server] Supabase fetch failed, falling back to static data:', e.message);
        }
    }

    if (!members || members.length === 0) {
        members = rag.getStaticMembers();
        console.log(`[Server] Loaded ${members.length} members from static data`);
    }

    rag.setMembers(members);

    console.log('[Server] Building embeddings...');
    await rag.buildEmbeddings(
        DEEPSEEK_API_KEY && DEEPSEEK_API_KEY !== 'your_deepseek_api_key_here' ? DEEPSEEK_API_KEY : null
    );

    if (process.env.VERCEL) {
        console.log('[Server] Running on Vercel — serverless mode');
    } else {
        app.listen(PORT, () => {
            console.log(`[Server] Lions Club 321 C1 Directory running at http://localhost:${PORT}`);
            console.log(`[Server] Supabase: ${supabaseConfigured ? 'Yes' : 'No'}`);
            console.log(`[Server] Clerk: ${clerkConfigured ? 'Yes' : 'No'}`);
            console.log(`[Server] LLM: ${DEEPSEEK_API_KEY && DEEPSEEK_API_KEY !== 'your_deepseek_api_key_here' ? 'Yes' : 'No'}`);
        });
    }
}

// Vercel serverless: export the app (listen only for local dev)
if (!process.env.VERCEL) {
    start();
}

module.exports = { app, start };
