import express from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';
import { createGame, getGame, joinGame, startGame, submitAction } from './gameRepo.js';
import { resolveTurn } from './resolve.js';

const DEFAULT_NATIONS = [
  { name: 'Germany', color: '#444' },
  { name: 'United Kingdom', color: '#1f77b4' },
  { name: 'USA', color: '#2ca02c' },
  { name: 'USSR', color: '#d62728' },
  { name: 'Japan', color: '#ff7f0e' },
  { name: 'Italy', color: '#9467bd' }
];

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/games', async (req, res) => {
  try {
    const game = await createGame(req.body.name, DEFAULT_NATIONS);
    res.json(game);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/games/:gameId', async (req, res) => {
  try {
    const g = await getGame(req.params.gameId);
    res.json(g);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post('/games/:gameId/join', async (req, res) => {
  try {
    const player = await joinGame(req.params.gameId, req.body.playerName, req.body.nationName);
    const game = await getGame(req.params.gameId);
    res.json({ game, playerId: player.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/games/:gameId/start', async (req, res) => {
  try {
    const g = await startGame(req.params.gameId);
    res.json(g);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/games/:gameId/actions', async (req, res) => {
  try {
    const result = await submitAction(req.params.gameId, req.body.playerId, req.body.action);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/games/:gameId/resolve', async (req, res) => {
  try {
    const result = await resolveTurn(req.params.gameId);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`WW2 sim backend on ${port}`));
