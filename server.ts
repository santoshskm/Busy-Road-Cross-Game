import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // In-memory score storage
  let highScores: { player_name: string; score: number }[] = [];

  // API Routes
  app.get('/api/scores', (req, res) => {
    const sorted = [...highScores].sort((a, b) => b.score - a.score).slice(0, 5);
    res.json(sorted);
  });

  app.post('/api/scores', (req, res) => {
    const { player_name, score } = req.body;
    if (player_name && typeof score === 'number') {
      highScores.push({ player_name, score });
      res.json({ status: 'success' });
    } else {
      res.status(400).json({ error: 'Invalid payload' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve static files from dist
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
