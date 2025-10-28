// Simple helper to enable DB_SYNC in-process and start the app
process.env.DB_SYNC = 'true';
require('./index');
