// Importları güncelle
import { threadsRouter } from './threads.mjs';
import { agentsRouter } from './agents.mjs';
// ... diğerleri

// Mount işlemlerini güncelle
app.use('/api/threads', threadsRouter);
app.use('/api/agents', agentsRouter);
