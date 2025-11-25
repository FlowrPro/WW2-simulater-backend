import { q } from './db.js';

async function nationRow(gameId, nationName) {
  const res = await q('select * from nations where game_id=$1 and name=$2', [gameId, nationName]);
  return res.rows[0];
}

async function updateNation(gameId, nationName, updates) {
  const cols = [];
  const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries(updates)) {
    cols.push(`${k}=$${i++}`);
    vals.push(v);
  }
  vals.push(gameId, nationName);
  await q(`update nations set ${cols.join(', ')} where game_id=$${i++} and name=$${i}`, vals);
}

export async function resolveTurn(gameId) {
  const gRes = await q('select * from games where id=$1', [gameId]);
  if (gRes.rowCount === 0) throw new Error('Game not found');
  const game = gRes.rows[0];
  if (game.status !== 'active') throw new Error('Game not active');

  const actions = await q('select * from actions where game_id=$1 order by created_at', [gameId]);
  const players = await q('select * from players where game_id=$1', [gameId]);
  const playerMap = new Map(players.rows.map(p => [p.id, p]));

  const logs = [];

  const costPer = { steel: 2, oil: 1, food: 1, money: 3, manpower: 1 };

  for (const act of actions.rows) {
    const payload = act.payload;
    const player = playerMap.get(act.player_id);
    if (!player) {
      logs.push({ playerId: act.player_id, type: act.type, error: 'Unknown player' });
      continue;
    }
    const nationName = player.nation_name;
    const n = await nationRow(gameId, nationName);

    try {
      if (act.type === 'build') {
        const amount = Number(payload.amount ?? 1);
        const totalCost = {
          steel: costPer.steel * amount,
          oil: costPer.oil * amount,
          food: costPer.food * amount,
          money: costPer.money * amount,
          manpower: costPer.manpower * amount
        };
        if (n.steel < totalCost.steel || n.oil < totalCost.oil || n.food < totalCost.food || n.money < totalCost.money || n.manpower < totalCost.manpower) {
          throw new Error('Insufficient resources');
        }
        await updateNation(gameId, nationName, {
          steel: n.steel - totalCost.steel,
          oil: n.oil - totalCost.oil,
          food: n.food - totalCost.food,
          money: n.money - totalCost.money,
          manpower: n.manpower - totalCost.manpower,
          troops: n.troops + amount,
          morale: Math.min(100, n.morale + Math.floor(amount / 5))
        });
      } else if (act.type === 'research') {
        const investment = Number(payload.investment ?? 10);
        if (n.money < investment) throw new Error('Insufficient money');
        await updateNation(gameId, nationName, {
          money: n.money - investment,
          morale: Math.min(100, n.morale + Math.floor(investment / 2))
        });
      } else if (act.type === 'trade') {
        const sellMoney = Number(payload.sellMoney ?? 10);
        if (n.money < sellMoney) throw new Error('Insufficient money');
        const buy = payload.buy ?? { oil: 5 };
        const rate = 0.5;
        const updates = {
          money: n.money - sellMoney,
          steel: n.steel,
          oil: n.oil,
          food: n.food,
          manpower: n.manpower,
          morale: Math.min(100, n.morale + 1)
        };
        for (const [res, qty] of Object.entries(buy)) {
          const add = Math.floor(Number(qty) * rate);
          updates[res] = (updates[res] ?? n[res]) + add;
        }
        await updateNation(gameId, nationName, updates);
      } else if (act.type === 'attack') {
        const targetNation = payload.targetNation;
        const sendTroops = Math.max(1, Number(payload.sendTroops ?? 1));
        if (nationName === targetNation) throw new Error('Cannot attack self');

        const defender = await nationRow(gameId, targetNation);
        if (!defender) throw new Error('Target nation not found');
        if (n.troops < sendTroops) throw new Error('Insufficient troops');

        const defenderCommit = Math.max(0, Math.floor(defender.troops / 2));

        // Deduct committed
        const attackerAfterCommit = n.troops - sendTroops;
        const defenderAfterCommit = defender.troops - defenderCommit;

        const attackerPower = sendTroops;
        const defenderPower = defenderCommit;

        let winner = null;
        let attackerMorale = n.morale;
        let defenderMorale = defender.morale;
        let attackerMoney = n.money;
        let defenderMoney = defender.money;

        if (attackerPower > defenderPower) {
          winner = nationName;
          attackerMorale = Math.min(100, attackerMorale + 5);
          defenderMorale = Math.max(0, defenderMorale - 5);
          attackerMoney += 5;
          defenderMoney = Math.max(0, defenderMoney - 5);
        } else if (defenderPower > attackerPower) {
          winner = targetNation;
          defenderMorale = Math.min(100, defenderMorale + 5);
          attackerMorale = Math.max(0, attackerMorale - 5);
          defenderMoney += 5;
          attackerMoney = Math.max(0, attackerMoney - 5);
        } else {
          attackerMorale = Math.max(0, attackerMorale - 2);
          defenderMorale = Math.max(0, defenderMorale - 2);
        }

        const attackerLosses = Math.floor(sendTroops * 0.5);
        const defenderLosses = Math.floor(defenderCommit * 0.5);

        const attackerTroopsFinal = attackerAfterCommit + (sendTroops - attackerLosses);
        const defenderTroopsFinal = defenderAfterCommit + (defenderCommit - defenderLosses);

        await updateNation(gameId, nationName, {
          troops: attackerTroopsFinal,
          morale: attackerMorale,
          money: attackerMoney
        });
        await updateNation(gameId, targetNation, {
          troops: defenderTroopsFinal,
          morale: defenderMorale,
          money: defenderMoney
        });

        await q('insert into turn_logs (game_id, turn, player_id, entry) values ($1,$2,$3,$4)', [
          gameId,
          game.turn,
          act.player_id,
          {
            type: 'attack',
            attacker: nationName,
            defender: targetNation,
            sendTroops,
            defenderCommit,
            attackerLosses,
            defenderLosses,
            winner
          }
        ]);
      }
    } catch (e) {
      await q('insert into turn_logs (game_id, turn, player_id, entry) values ($1,$2,$3,$4)', [
        gameId,
        game.turn,
        act.player_id,
        { type: act.type, error: e.message }
      ]);
      logs.push({ playerId: act.player_id, type: act.type, error: e.message });
    }
  }

  // Passive income at end of turn
  const ns = await q('select * from nations where game_id=$1', [gameId]);
  for (const n of ns.rows) {
    await updateNation(gameId, n.name, {
      steel: n.steel + 2,
      oil: n.oil + 2,
      food: n.food + 3,
      money: n.money + 5,
      morale: Math.min(100, n.morale + 1)
    });
  }

  // Clear actions
  await q('delete from actions where game_id=$1', [gameId]);

  // Advance turn
  const newTurn = game.turn + 1;
  await q('update games set turn=$2 where id=$1', [gameId, newTurn]);

  // Victory checks
  const topTroops = await q('select name, troops from nations where game_id=$1 and troops>=100', [gameId]);
  let victory = null;
  if (topTroops.rowCount > 0) {
    victory = { type: 'troops', winnerNation: topTroops.rows[0].name };
  } else if (newTurn > 20) {
    const richest = await q('select name, money from nations where game_id=$1 order by money desc limit 1', [gameId]);
    victory = { type: 'economy', winnerNation: richest.rows[0].name };
  }

  if (victory) {
    await q('update games set status=$2, victory_type=$3, victory_nation=$4 where id=$1', [
      gameId,
      'finished',
      victory.type,
      victory.winnerNation
    ]);
  }

  return { ok: true, turn: newTurn, logs, victory };
}
