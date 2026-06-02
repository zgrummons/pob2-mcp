import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { PoeNinjaClient } from '../../src/services/poeNinjaClient';

// PoE2 poe.ninja exchange/current/overview shape (lines + items joined by id).
// Base unit is the Exalted Orb (primaryValue=1); values are Exalted-equivalents.
const POE2_RESPONSE = {
  core: { rates: { chaos: 0.781 } },
  lines: [
    { id: 'exalted', primaryValue: 1, volumePrimaryValue: 3445250 },
    { id: 'divine', primaryValue: 77, volumePrimaryValue: 9000 },
    { id: 'alch', primaryValue: 1.21, volumePrimaryValue: 37059 },
    { id: 'zero', primaryValue: 0 }, // dropped (no value)
  ],
  items: [
    { id: 'exalted', name: 'Exalted Orb', detailsId: 'exalted-orb' },
    { id: 'divine', name: 'Divine Orb', detailsId: 'divine-orb' },
    { id: 'alch', name: 'Orb of Alchemy', detailsId: 'orb-of-alchemy' },
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

  it('calls the PoE2 exchange/current endpoint with league/type', async () => {
    await client.getCurrencyRates('Runes of Aldur');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('poe.ninja/poe2/api/economy/exchange/current/overview');
    expect(url).toContain('league=Runes%20of%20Aldur');
    expect(url).toContain('type=Currency');
  });

  it('transforms PoE2 lines+items into CurrencyOverview', async () => {
    const overview = await client.getCurrencyRates('Standard');
    const divine = overview.lines.find((l) => l.currencyTypeName === 'Divine Orb');
    expect(divine?.chaosEquivalent).toBe(77);
    // zero-value entries are dropped
    expect(overview.lines.find((l) => l.currencyTypeName === 'Zero Orb')).toBeUndefined();
  });

  it('builds an exchange map with Exalted Orb base = 1 (PoE2)', async () => {
    const map = await client.getCurrencyExchangeMap('Standard');
    expect(map.get('Exalted Orb')).toBe(1.0);
    expect(map.get('Divine Orb')).toBe(77);
    expect(map.get('Orb of Alchemy')).toBe(1.21);
  });

  it('converts a trading chain using the rate map', async () => {
    const map = await client.getCurrencyExchangeMap('Standard');
    // 1 Divine -> exalted -> Alchemy: 1*77 / 1.21 ≈ 63.6 Alchemy
    const alchFromDivine = (1 * map.get('Divine Orb')!) / map.get('Orb of Alchemy')!;
    expect(alchFromDivine).toBeCloseTo(63.64, 1);
  });
});
