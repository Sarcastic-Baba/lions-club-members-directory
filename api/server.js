// Vercel serverless entry point for the Express API
const { app, start } = require('../server/server');

let initialized = false;
let initPromise = null;

module.exports = async function handler(req, res) {
    if (!initialized) {
        if (!initPromise) {
            initPromise = start().then(function () { initialized = true; }).catch(console.error);
        }
        try { await initPromise; } catch (e) { console.error('[Vercel] Init failed:', e); }
    }
    app(req, res);
};
