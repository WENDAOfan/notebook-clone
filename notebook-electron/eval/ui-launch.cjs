const { app } = require('electron');
if (!process.env.NOTEBOOK_SMOKE_DATA) throw new Error('Missing isolated test data path');
app.setPath('userData', process.env.NOTEBOOK_SMOKE_DATA);
require('../main');
globalThis.__notebookSmoke = { db: require('../database'), rag: require('../rag-service'), retrieval: require('../retrieval-service'), vectors: require('../vector-store'), crypto: require('node:crypto') };
