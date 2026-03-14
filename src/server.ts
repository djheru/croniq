// Disable LangChain/LangSmith telemetry (noisy 403s when no API key configured)
process.env.LANGCHAIN_TRACING_V2 = 'false';
process.env.LANGSMITH_TRACING = 'false';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { migrate } from './db/index.js';
import { router } from './api/routes.js';
import { initScheduler } from './jobs/scheduler.js';

const PORT = parseInt(process.env.PORT ?? '3001');
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// API routes
app.use('/api', router);

// Serve React build in production
const uiDist = path.join(__dirname, '..', 'ui', 'dist');
app.use(express.static(uiDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(uiDist, 'index.html'));
});

// Boot
migrate();
initScheduler();

app.listen(PORT, () => {
  console.log(`[server] Croniq running on http://localhost:${PORT}`);
});
