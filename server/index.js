import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import setupRouter from './routes/setup.js';
import browseRouter from './routes/browse.js';
import transferRouter from './routes/transfer.js';
import templateRouter from './routes/template.js';
import { authGuard } from './services/auth.js';

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api', authGuard);
app.use('/api/setup', setupRouter);
app.use('/api/browse', browseRouter);
app.use('/api/transfer', transferRouter);
app.use('/api/template', templateRouter);

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Session Commander listening on port ${port}`);
});
