import { describe, expect, test } from 'bun:test';
import { createSteeringDeliveryPump } from '../../.github/extensions/pmx-canvas/steering-delivery.mjs';

const steering = {
  id: 'steer-1',
  message: 'Review the board',
};

describe('Copilot steering delivery pump', () => {
  test('claims and marks deliveries with the Copilot consumer', async () => {
    const calls = [];
    const pump = createSteeringDeliveryPump({
      consumer: 'copilot',
      claim: async (consumer) => {
        calls.push(['claim', consumer]);
        return [steering];
      },
      send: async (message) => calls.push(['send', message]),
      mark: async (id, consumer) => calls.push(['mark', id, consumer]),
      pause: async () => {},
      onError: () => {},
    });

    await pump.runOnce();

    expect(calls).toEqual([
      ['claim', 'copilot'],
      ['send', 'Review the board'],
      ['mark', 'steer-1', 'copilot'],
    ]);
  });

  test('does not mark a steer when the Copilot send fails', async () => {
    let sendAttempts = 0;
    let marks = 0;
    const pump = createSteeringDeliveryPump({
      consumer: 'copilot',
      claim: async () => [steering],
      send: async () => {
        sendAttempts += 1;
        if (sendAttempts === 1) throw new Error('send failed');
      },
      mark: async () => {
        marks += 1;
      },
      pause: async () => {},
      onError: () => {},
    });

    await expect(pump.runOnce()).rejects.toThrow('send failed');
    expect(marks).toBe(0);

    await pump.runOnce();
    expect(sendAttempts).toBe(2);
    expect(marks).toBe(1);
  });

  test('retries a failed mark without sending the steer twice', async () => {
    let claims = 0;
    let sends = 0;
    let markAttempts = 0;
    const pump = createSteeringDeliveryPump({
      consumer: 'copilot',
      claim: async () => {
        claims += 1;
        return claims === 1 ? [steering] : [];
      },
      send: async () => {
        sends += 1;
      },
      mark: async () => {
        markAttempts += 1;
        if (markAttempts === 1) throw new Error('mark failed');
      },
      pause: async () => {},
      onError: () => {},
    });

    await expect(pump.runOnce()).rejects.toThrow('mark failed');
    await pump.runOnce();

    expect(sends).toBe(1);
    expect(markAttempts).toBe(2);
    expect(claims).toBe(2);
  });

  test('marks startup backlog without waking Copilot', async () => {
    let sends = 0;
    const marks = [];
    const pump = createSteeringDeliveryPump({
      consumer: 'copilot',
      claim: async () => [{ ...steering, createdAt: '2026-08-26T10:00:00.000Z' }],
      send: async () => {
        sends += 1;
      },
      mark: async (id, consumer) => marks.push([id, consumer]),
      shouldSend: (entry) => Date.parse(entry.createdAt) >= Date.parse('2026-08-27T10:00:00.000Z'),
      pause: async () => {},
      onError: () => {},
    });

    await pump.runOnce();

    expect(sends).toBe(0);
    expect(marks).toEqual([['steer-1', 'copilot']]);
  });

  test('backs off when a server returns an empty claim immediately', async () => {
    let claims = 0;
    let pauses = 0;
    let pump;
    pump = createSteeringDeliveryPump({
      consumer: 'copilot',
      claim: async () => {
        claims += 1;
        return [];
      },
      send: async () => {},
      mark: async () => {},
      pause: async () => {
        pauses += 1;
        pump.stop();
      },
      onError: () => {},
    });

    await pump.start();

    expect(claims).toBe(1);
    expect(pauses).toBe(1);
  });

  test('only resets delivery phases owned by the pump', async () => {
    let presence = { phase: 'thinking', detail: 'reviewing architecture' };
    let explicitPhaseDuringSend = false;
    const presenceWrites = [];
    const pump = createSteeringDeliveryPump({
      consumer: 'copilot',
      claim: async () => [steering],
      send: async () => {
        if (explicitPhaseDuringSend) presence = { phase: 'thinking', detail: 'answering steer' };
      },
      mark: async () => {},
      getPresence: async () => presence,
      setPresence: async (patch) => {
        presenceWrites.push(patch);
        presence = { ...presence, ...patch };
        return true;
      },
      pause: async () => {},
      onError: () => {},
    });

    await pump.runOnce();
    expect(presenceWrites).toEqual([]);
    expect(presence).toEqual({ phase: 'thinking', detail: 'reviewing architecture' });

    presence = { phase: 'idle', detail: null };
    explicitPhaseDuringSend = true;
    await pump.runOnce();
    expect(presenceWrites).toEqual([{ phase: 'tooling', detail: 'steer: Review the board' }]);
    expect(presence).toEqual({ phase: 'thinking', detail: 'answering steer' });

    presence = { phase: 'idle', detail: null };
    explicitPhaseDuringSend = false;
    await pump.runOnce();
    expect(presenceWrites.slice(-2)).toEqual([
      { phase: 'tooling', detail: 'steer: Review the board' },
      { phase: 'idle', detail: null },
    ]);
  });
});
