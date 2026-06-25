const fs = require('fs');
const path = require('path');

const MEMBERS_FILE = path.join(__dirname, '..', 'data', 'members.js');
const EMBEDDING_CACHE = path.join(__dirname, '..', 'data', 'embeddings.json');

let members = [];
let memberEmbeddings = []; // { id, embedding: number[] }
let embeddingDim = 0;
let memberSignature = '';
let embeddingSignature = '';

/**
 * Load members from the static members.js file.
 * Returns parsed members array without mutating the module-level variable.
 */
function getStaticMembers() {
    try {
        const raw = fs.readFileSync(MEMBERS_FILE, 'utf-8');
        const start = raw.indexOf('[');
        const end = raw.lastIndexOf(']');
        if (start === -1 || end === -1 || end <= start) {
            throw new Error('Failed to parse members.js: could not find JSON array');
        }
        const jsonStr = raw.substring(start, end + 1);
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('[RAG] Failed to load static members:', e.message);
        return [];
    }
}

/**
 * Set members from external source (e.g., Supabase).
 * Replaces the internal members array.
 */
function setMembers(newMembers) {
    members = newMembers;
    memberSignature = computeMembersSignature(members);
    module.exports.members = members;
    return members;
}

function computeMembersSignature(list) {
    return (list || []).map(m => [
        m.id,
        m.updated_at,
        m.name,
        m.designation,
        m.club,
        m.profession,
        m.specialty,
        m.location,
        m.year_of_joining,
        m.show_phone,
        m.show_email
    ].join(':')).join('|');
}

function writeEmbeddingCache(payload) {
    try {
        fs.writeFileSync(EMBEDDING_CACHE, JSON.stringify(payload, null, 2));
    } catch (e) {
        console.warn('[RAG] Could not write embedding cache:', e.message);
    }
}

/**
 * Build a searchable text passage for a member.
 */
function buildMemberPassage(m) {
    return [
        m.name,
        m.designation,
        m.club,
        m.profession,
        m.specialty,
        m.location,
        m.address
    ].filter(Boolean).join(' | ');
}

/**
 * Simple TF-IDF-like keyword vectorizer.
 * Tokenizes, builds a vocabulary from all passages, and returns
 * a sparse vector (as a dense array of the vocab size).
 */
function buildVocab(passages) {
    const vocab = new Map();
    for (const p of passages) {
        const tokens = tokenize(p);
        for (const t of tokens) {
            if (!vocab.has(t)) vocab.set(t, vocab.size);
        }
    }
    return vocab;
}

function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(t => t.length > 1);
}

function tfidfVector(tokens, vocab, idf) {
    const vec = new Array(vocab.size).fill(0);
    const tf = {};
    for (const t of tokens) {
        tf[t] = (tf[t] || 0) + 1;
    }
    for (const [word, freq] of Object.entries(tf)) {
        const idx = vocab.get(word);
        if (idx !== undefined) {
            vec[idx] = freq * (idf.get(word) || 0);
        }
    }
    // L2 normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
}

function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/**
 * Compute embeddings for all members using local TF-IDF vectors
 * (no external API needed — fast, zero-cost retrieval).
 * Optionally tries DeepSeek embeddings if API key is available.
 */
async function buildEmbeddings(apiKey) {
    const targetSignature = memberSignature || computeMembersSignature(members);
    const passages = members.map(buildMemberPassage);
    const vocab = buildVocab(passages);

    // Compute IDF
    const df = new Map();
    for (const p of passages) {
        const seen = new Set();
        for (const t of tokenize(p)) {
            if (!seen.has(t)) {
                seen.add(t);
                df.set(t, (df.get(t) || 0) + 1);
            }
        }
    }
    const N = passages.length;
    const idf = new Map();
    for (const [word, count] of df) {
        idf.set(word, Math.log((N + 1) / (count + 1)) + 1);
    }

    // Try loading cached DeepSeek embeddings
    if (apiKey && fs.existsSync(EMBEDDING_CACHE)) {
        try {
            const cached = JSON.parse(fs.readFileSync(EMBEDDING_CACHE, 'utf-8'));
            if (
                cached.signature &&
                cached.signature === targetSignature &&
                Array.isArray(cached.embeddings) &&
                Array.isArray(cached.embeddings[0]?.embedding)
            ) {
                console.log('[RAG] Using cached DeepSeek embeddings');
                memberEmbeddings = cached.embeddings;
                embeddingDim = memberEmbeddings[0]?.embedding?.length || 0;
                embeddingSignature = targetSignature;
                return;
            }
        } catch (_) { /* fall through */ }
    }

    // Try DeepSeek embeddings API
    if (apiKey) {
        try {
            console.log('[RAG] Generating DeepSeek embeddings for', members.length, 'members...');
            const embeddings = [];
            for (let i = 0; i < members.length; i++) {
                const resp = await fetch('https://api.deepseek.com/v1/embeddings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        input: passages[i]
                    })
                });
                if (!resp.ok) throw new Error(`Embedding API error: ${resp.status}`);
                const data = await resp.json();
                const vec = data.data?.[0]?.embedding;
                if (!vec) throw new Error('No embedding returned');
                embeddings.push({ id: members[i].id, embedding: vec });
            }
            memberEmbeddings = embeddings;
            embeddingDim = embeddings[0].embedding.length;
            embeddingSignature = targetSignature;
            // Cache to disk
            writeEmbeddingCache({ count: members.length, signature: targetSignature, embeddings });
            console.log('[RAG] DeepSeek embeddings generated & cached');
            return;
        } catch (e) {
            console.warn('[RAG] DeepSeek embeddings failed, falling back to TF-IDF:', e.message);
        }
    }

    // Fallback: local TF-IDF vectors
    console.log('[RAG] Using local TF-IDF vectors');
    embeddingDim = vocab.size;
    memberEmbeddings = members.map((m, i) => ({
        id: m.id,
        embedding: tfidfVector(tokenize(passages[i]), vocab, idf)
    }));
    embeddingSignature = targetSignature;

    // Also persist vocab/idf for query vectorization later
    const meta = {
        count: members.length,
        signature: targetSignature,
        vocab: Array.from(vocab.entries()),
        idf: Array.from(idf.entries()),
        embeddings: memberEmbeddings.map(e => ({ id: e.id }))
    };
    writeEmbeddingCache(meta);
}

async function ensureEmbeddings(apiKey) {
    const targetSignature = memberSignature || computeMembersSignature(members);
    if (memberEmbeddings.length > 0 && embeddingSignature === targetSignature) {
        return;
    }
    await buildEmbeddings(apiKey);
}

/**
 * Vectorize a query using TF-IDF
 */
function vectorizeQuery(query) {
    if (embeddingDim === 0) return [];

    if (memberEmbeddings[0]?.embedding?.length > 200) {
        return null;
    }

    let vocab, idf;
    if (fs.existsSync(EMBEDDING_CACHE)) {
        try {
            const cached = JSON.parse(fs.readFileSync(EMBEDDING_CACHE, 'utf-8'));
            if (cached.signature === (memberSignature || computeMembersSignature(members))) {
                vocab = new Map(cached.vocab || []);
                idf = new Map(cached.idf || []);
            }
        } catch (_) { }
    }

    if (!vocab || vocab.size === 0) return [];
    const tokens = tokenize(query);
    return tfidfVector(tokens, vocab, idf);
}

/**
 * Search members by query.
 * Returns top-k members sorted by relevance.
 */
function searchMembers(query, topK = 5) {
    if (memberEmbeddings.length === 0) return [];

    const queryVec = vectorizeQuery(query);

    const scored = memberEmbeddings.map(({ id, embedding }) => {
        let score;
        if (queryVec && queryVec.length > 0 && embedding.length === queryVec.length) {
            score = cosineSimilarity(queryVec, embedding);
        } else {
            score = keywordOverlapScore(query, members.find(m => m.id === id));
        }
        return { id, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => {
        const member = members.find(m => m.id === s.id);
        if (!member) return null;
        return { ...member, relevance: Math.round(s.score * 100) / 100 };
    }).filter(Boolean);
}

/**
 * Keyword overlap fallback scorer
 */
function keywordOverlapScore(query, member) {
    if (!member) return 0;
    const qTokens = new Set(tokenize(query));
    const text = buildMemberPassage(member);
    const mTokens = tokenize(text);
    let overlap = 0;
    for (const t of mTokens) {
        if (qTokens.has(t)) overlap++;
    }
    const seen = new Set();
    for (const t of qTokens) {
        if (mTokens.includes(t) && !seen.has(t)) {
            seen.add(t);
        }
    }
    const jaccard = seen.size / (qTokens.size + mTokens.length - seen.size || 1);
    const exactBonus = (
        member.name.toLowerCase().includes(query.toLowerCase()) ? 0.3 : 0
    ) + (
        member.location.toLowerCase().includes(query.toLowerCase()) ? 0.2 : 0
    ) + (
        member.profession.toLowerCase().includes(query.toLowerCase()) ? 0.2 : 0
    ) + (
        member.club.toLowerCase().includes(query.toLowerCase()) ? 0.1 : 0
    );
    return jaccard + exactBonus;
}

// Load static members initially so the module has data at import time
members = getStaticMembers();
memberSignature = computeMembersSignature(members);
console.log('[RAG] Initialized with', members.length, 'static members');

module.exports = {
    getStaticMembers,
    setMembers,
    buildEmbeddings,
    ensureEmbeddings,
    searchMembers,
    buildMemberPassage,
    members
};
