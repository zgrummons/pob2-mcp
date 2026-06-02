import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { PoeNinjaClient } from '../../src/services/poeNinjaClient';

// PoE2 poe.ninja currency-exchange overview shape (lines + items joined by id).
const POE2_RESPONSE = {
  core: { version: '1', timestamp: 1700000000 },
  lines: [
    { id: 'exalted', primaryValue: 0.5, volumePrimaryValue: 1920 },
    { id: 'divine', primaryValue: 120, volumePrimaryValue: 300 },
    { id: 'zero', primaryValue: 0 }, // dropped (no value)
  ],
  items: [
    { id: 'exalted', name: 'Exalted Orb', tradeId: 'exalted' },
    { id: 'divine', name: 'Divine Orb', tradeId: 'divine' },
    { id: 'zero', name: 'Zero Orb' },
  ],
};

describe('PoeNinjaClient (PoE2)', () => {
  let client: PoeNinjaClient;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    client = new PoeNinjaClient();
    fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => POE2_RESPONSE,
    })) as any;
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls the PoE2 currencyexchange endpoint with leagueName/overviewName', async () => {
    await client.getCurrencyRates('Standard');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('poe.ninja/poe2/api/economy/currencyexchange/overview');
    expect(url).toContain('leagueName=Standard');
    expect(url).toContain('overviewName=Currency');
  });

  it('transforms PoE2 lines+items into CurrencyOverview', async () => {
    const overview = await client.getCurrencyRates('Standard');
    const exalted = overview.lines.find((l) => l.currencyTypeName === 'Exalted Orb');
    expect(exalted?.chaosEquivalent).toBe(0.5);
    // zero-value entries are dropped
    expect(overview.lines.find((l) => l.currencyTypeName === 'Zero Orb')).toBeUndefined();
  });

  it('builds an exchange map with Chaos Orb base = 1', async () => {
    const map = await client.getCurrencyExchangeMap('Standard');
    expect(map.get('Chaos Orb')).toBe(1.0);
    expect(map.get('Divine Orb')).toBe(120);
    expect(map.get('Exalted Orb')).toBe(0.5);
  });

  it('converts a trading chain using the rate map', async () => {
    const map = await client.getCurrencyExchangeMap('Standard');
    // 2 Divine -> chaos -> Exalted: 2*120 / 0.5 = 480 Exalted
    const exaltedFromDivine = (2 * map.get('Divine Orb')!) / map.get('Exalted Orb')!;
    expect(exaltedFromDivine).toBe(480);
  });
});
