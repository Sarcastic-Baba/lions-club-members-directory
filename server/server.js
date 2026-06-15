require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { clerkMiddleware, requireAuth, getAuth } = require('@clerk/express');
const rag = require('./rag');

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

// --- Supabase client ---
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

// --- Clerk middleware ---
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || '';
const clerkSecretKey = process.env.CLERK_SECRET_KEY || '';
const clerkConfigured = clerkPublishableKey && clerkSecretKey;

if (clerkConfigured) {
    app.use(clerkMiddleware({
        publishableKey: clerkPublishableKey,
        secretKey: clerkSecretKey
    }));
}

app.use(cors());
app.use(express.json());

// Serve static files from parent directory
app.use(express.static(path.join(__dirname, '..')));

// --- Auth status endpoint ---
app.get('/api/auth/config', (req, res) => {
    res.json({
        clerkConfigured,
        clerkPublishableKey: clerkPublishableKey || null,
        supabaseConfigured: !!supabase
    });
});

// --- Members API (Supabase) ---
app.get('/api/members', async (req, res) => {
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
            // Fallback to static data
            members = rag.getStaticMembers();
        }
        res.json({ members, total: members.length });
    } catch (err) {
        console.error('[API] Error fetching members:', err.message);
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

// --- AI Search endpoint (protected with Clerk auth) ---
app.post('/api/ai-search', async (req, res) => {
    try {
        // Require Clerk auth if configured
        if (clerkConfigured) {
            const { userId } = getAuth(req);
            if (!userId) {
                return res.status(401).json({ error: 'Authentication required' });
            }
        }

        const { query } = req.body;
        if (!query || !query.trim()) {
            return res.status(400).json({ error: 'Query is required' });
        }

        // Ensure RAG is initialized with latest members
        let members;
        if (supabase) {
            const { data, error } = await supabase
                .from('members')
                .select('*')
                .order('id', { ascending: true });
            if (!error && data) {
                members = data;
                rag.setMembers(members);
            }
        }
        if (!members) {
            members = rag.members.length > 0 ? rag.members : rag.getStaticMembers();
        }

        // Step 1: RAG retrieval — find top-k relevant members
        const relevantMembers = rag.searchMembers(query, 5);

        // Step 2: Build context from relevant members
        const contextParts = relevantMembers.map((m, i) => {
            return `[Member ${i + 1}]
Name: ${m.name}
Designation: ${m.designation}
Club: ${m.club}
Location: ${m.location}
Profession: ${m.profession}
Phone: ${m.phone}
Email: ${m.email}
Address: ${m.address}`;
        });

        const context = contextParts.join('\n\n');

        // Step 3: Send to DeepSeek LLM
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

        // Step 4: Return results
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

// --- Member CRUD (admin — requires auth) ---
app.post('/api/members', async (req, res) => {
    try {
        if (clerkConfigured) {
            const { userId } = getAuth(req);
            if (!userId) return res.status(401).json({ error: 'Authentication required' });
        }
        if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

        const { name, club, designation, location, profession, phone, email, address } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });

        const { data, error } = await supabase
            .from('members')
            .insert([{ name, club, designation, location, profession, phone, email, address }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ member: data });
    } catch (err) {
        console.error('[API] Error creating member:', err.message);
        res.status(500).json({ error: 'Failed to create member' });
    }
});

app.put('/api/members/:id', async (req, res) => {
    try {
        if (clerkConfigured) {
            const { userId } = getAuth(req);
            if (!userId) return res.status(401).json({ error: 'Authentication required' });
        }
        if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

        const { id } = req.params;
        const { name, club, designation, location, profession, phone, email, address } = req.body;

        const { data, error } = await supabase
            .from('members')
            .update({ name, club, designation, location, profession, phone, email, address })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json({ member: data });
    } catch (err) {
        console.error('[API] Error updating member:', err.message);
        res.status(500).json({ error: 'Failed to update member' });
    }
});

app.delete('/api/members/:id', async (req, res) => {
    try {
        if (clerkConfigured) {
            const { userId } = getAuth(req);
            if (!userId) return res.status(401).json({ error: 'Authentication required' });
        }
        if (!supabase) return res.status(501).json({ error: 'Supabase not configured' });

        const { id } = req.params;
        const { error } = await supabase
            .from('members')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('[API] Error deleting member:', err.message);
        res.status(500).json({ error: 'Failed to delete member' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        members: rag.members.length,
        embeddings: true,
        llmConfigured: DEEPSEEK_API_KEY && DEEPSEEK_API_KEY !== 'your_deepseek_api_key_here',
        clerkConfigured,
        supabaseConfigured: !!supabase
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

    app.listen(PORT, () => {
        console.log(`[Server] Lions Club 321 C1 Directory running at http://localhost:${PORT}`);
        console.log(`[Server] Clerk auth: ${clerkConfigured ? 'Yes' : 'No (set CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY in server/.env)'}`);
        console.log(`[Server] Supabase: ${supabase ? 'Yes' : 'No (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in server/.env)'}`);
        console.log(`[Server] LLM: ${DEEPSEEK_API_KEY && DEEPSEEK_API_KEY !== 'your_deepseek_api_key_here' ? 'Yes' : 'No'}`);
    });
}

start();
