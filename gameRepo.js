import { q } from './db.js';

export async function createGame(name, nations) {
  const g = await q(
    'insert into games (name) values ($1) returning id, name, status, turn, created_at',
    [name || 'WW2 Sim']
  );
  const game = g.rows[0];

  // Insert nations
  for (const n of nations) {
    await q(
      `insert into nations (game_id, name, color) values ($1,$2,$3)`,
      [game.id, n.name, n.color]
    );
  }
  return game;
}

export async function getGame(gameId) {
  const g = await q('select * from games where id=$1', [gameId]);
  if (g.rowCount === 0) throw new Error('Game not found');
  const game = g.rows[0];

  const ns = await q('select * from nations where game_id=$1 order by name', [gameId]);
  const ps = await q('select * from players where game_id=$1', [gameId]);

  // Shape into the previous structure for frontend convenience
  const nations = {};
  for (const n of ns.rows) {
    nations[n.name] = {
      resources: { steel: n.steel, oil: n.oil, food: n.food, manpower: n.manpower },
      money: n.money,
      troops: n.troops,
      morale: n.morale,
      ownerPlayerId: n.owner_player_id,
      color: n.color
    };
  }
  const players = {};
  for (const p of ps.rows) {
    players[p.id] = { name: p.name, nation: p.nation_name };
  }
  // Pending actions not needed in GET
  return { ...game, nations, players };
}

export async function joinGame(gameId, playerName, nationName) {
  const game = await getGame(gameId);
  if (game.status !== 'open') throw new Error('Game not open for joining');
  if (!game.nations[nationName]) throw new Error('Nation not available');
  if (game.nations[nationName].ownerPlayerId) throw new Error('Nation already taken');

  const p = await q(
    'insert into players (game_id, name, nation_name) values ($1,$2,$3) returning id, name, nation_name',
    [gameId, playerName, nationName]
  );
  const player = p.rows[0];

  await q(
    'update nations set owner_player_id=$1 where game_id=$2 and name=$3',
    [player.id, gameId, nationName]
  );
  return player;
}

export async function startGame(gameId) {
  const ps = await q('select count(*) from players where game_id=$1', [gameId]);
  if (Number(ps.rows[0].count) < 2) throw new Error('Need at least 2 players to start');
  await q('update games set status=$2 where id=$1', [gameId, 'active']);
  return getGame(gameId);
}

export async function submitAction(gameId, playerId, action) {
  const allowed = ['build', 'research', 'trade', 'attack'];
  if (!allowed.includes(action.type)) throw new Error('Invalid action type');
  await q(
    'insert into actions (game_id, player_id, type, payload) values ($1,$2,$3,$4)',
    [gameId, playerId, action.type, action]
  );
  return { ok: true };
}
