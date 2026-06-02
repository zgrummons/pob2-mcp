/**
 * poe.ninja API Client
 *
 * Fetches real-time currency rates and item prices from poe.ninja
 */

export interface CurrencyRate {
  currencyTypeName: string;
  chaosEquivalent: number;
  pay?: {
    value: number;
    count: number;
    listing_count: number;
  };
  receive?: {
    value: number;
    count: number;
    listing_count: number;
  };
  detailsId: string;
}

// New API format (poe1/api/economy/exchange/current)
export interface NewCurrencyLine {
  id: string;
  primaryValue: number;
  volumePrimaryValue?: number;
  maxVolumeCurrency?: string;
  maxVolumeRate?: number;
  sparkline?: {
    totalChange: number;
    data: number[];
  };
}

export interface NewCurrencyItem {
  id: string;
  name: string;
  image: string;
  category: string;
  detailsId: string;
}

export interface NewCurrencyOverview {
  core: {
    items: NewCurrencyItem[];
    rates: any;
    primary: string;
    secondary: string;
  };
  lines: NewCurrencyLine[];
  items: NewCurrencyItem[];
}

export interface CurrencyOverview {
  lines: CurrencyRate[];
  currencyDetails: Array<{
    id: number;
    name: string;
    tradeId?: string;
  }>;
}

export interface ArbitrageOpportunity {
  chain: string[];
  profitPercent: number;
  startAmount: number;
  endAmount: number;
  steps: Array<{
    from: string;
    to: string;
    rate: number;
    amount: number;
  }>;
}

/** PoE2 poe.ninja currency-exchange response shapes. */
interface Poe2ExchangeLine {
  id: string;
  primaryValue: number;       // chaos-equivalent value
  volumePrimaryValue?: number;
}
interface Poe2ExchangeItem {
  id: string;
  name: string;
  icon?: string;
  tradeId?: string;
}
interface Poe2ExchangeOverview {
  core?: { version?: string; timestamp?: number };
  lines: Poe2ExchangeLine[];
  items: Poe2ExchangeItem[];
}

/**
 * Client for fetching data from the poe.ninja PoE2 economy API.
 *
 * PoE2 endpoint: /poe2/api/economy/currencyexchange/overview?leagueName=..&overviewName=Currency
 * Response shape differs from PoE1 ({lines:[{id,primaryValue}], items:[{id,name}]}), so we
 * transform it into the existing CurrencyOverview shape used by the handlers.
 *
 * Note: the currency-exchange feed exposes a single value per currency (no bid/ask spread),
 * so arbitrage round-trips evaluate to ~0% — find_arbitrage will typically return nothing.
 */
export class PoeNinjaClient {
  private baseUrl = 'https://poe.ninja/poe2/api/economy/currencyexchange';
  private cache = new Map<string, { data: any; timestamp: number }>();
  private cacheTTL = 300000; // 5 minutes

  /** Transform a raw PoE2 exchange overview into the legacy CurrencyOverview shape. */
  private transformPoe2Overview(data: Poe2ExchangeOverview): CurrencyOverview {
    const nameById = new Map<string, string>();
    for (const it of data.items || []) {
      if (it.id) nameById.set(it.id, it.name);
    }
    const lines: CurrencyRate[] = [];
    for (const ln of data.lines || []) {
      const value = Number(ln.primaryValue) || 0;
      if (value <= 0) continue;
      lines.push({
        currencyTypeName: nameById.get(ln.id) || ln.id,
        chaosEquivalent: value,
        detailsId: ln.id,
      });
    }
    const currencyDetails = (data.items || []).map((it, i) => ({
      id: i,
      name: it.name,
      tradeId: it.tradeId,
    }));
    return { lines, currencyDetails };
  }

  /**
   * Get currency rates for a PoE2 league (e.g. "Standard", "Rise of the Abyssal").
   */
  async getCurrencyRates(league: string): Promise<CurrencyOverview> {
    const cacheKey = `currency:${league}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    const url = `${this.baseUrl}/overview?leagueName=${encodeURIComponent(league)}&overviewName=Currency`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'pob2-mcp-server/0.1',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`poe.ninja PoE2 API request failed (${response.status}): ${await response.text()}`);
    }

    const raw = (await response.json()) as Poe2ExchangeOverview;
    const data = this.transformPoe2Overview(raw);
    this.putInCache(cacheKey, data);
    return data;
  }

  /**
   * Fragments are not a distinct PoE2 currency-exchange category; fold into currency rates.
   */
  async getFragmentRates(league: string): Promise<CurrencyOverview> {
    return this.getCurrencyRates(league);
  }

  /**
   * Build a currency exchange rate map (all rates in chaos equivalent)
   */
  async getCurrencyExchangeMap(league: string): Promise<Map<string, number>> {
    const data = await this.getCurrencyRates(league);
    const rateMap = new Map<string, number>();
    rateMap.set('Chaos Orb', 1.0);
    for (const line of data.lines) {
      if (line.currencyTypeName && line.chaosEquivalent > 0) {
        rateMap.set(line.currencyTypeName, line.chaosEquivalent);
      }
    }
    return rateMap;
  }

  /**
   * Find arbitrage opportunities using bid/ask spread from currency exchange rates.
   *
   * Real arbitrage requires separate buy and sell rates. poe.ninja provides:
   *   receive.value = chaos received per unit sold (sell/ask rate)
   *   pay.value     = chaos paid per unit bought (buy/bid rate)
   *
   * For a round-trip A→chaos→B→chaos→A to be profitable:
   *   (sellRate[A] / buyRate[B]) * (sellRate[B] / buyRate[A]) > 1
   *
   * When buy==sell (no spread data), round-trips always return exactly 1 (0% profit).
   */
  async findArbitrageOpportunities(league: string, minProfitPercent: number = 1.0): Promise<ArbitrageOpportunity[]> {
    const overview = await this.getCurrencyRates(league);
    const opportunities: ArbitrageOpportunity[] = [];

    // Build separate buy-rate and sell-rate maps (all in chaos per unit).
    // sell = chaos you receive per unit when selling
    // buy  = chaos you pay per unit when buying
    // Fall back to chaosEquivalent for both when pay/receive unavailable.
    const sellRate = new Map<string, number>(); // chaos received when selling 1 unit
    const buyRate  = new Map<string, number>(); // chaos spent when buying  1 unit

    sellRate.set('Chaos Orb', 1.0);
    buyRate.set('Chaos Orb', 1.0);

    for (const line of overview.lines) {
      const name = line.currencyTypeName;
      if (!name || line.chaosEquivalent <= 0) continue;

      // receive.value: chaos per unit of this currency (sell side)
      const sell = line.receive?.value ?? line.chaosEquivalent;
      // pay.value: chaos per unit of this currency when buying (buy side)
      // poe.ninja pay.value is expressed as [units-of-currency per chaos], so invert it.
      const buy = line.pay?.value
        ? 1 / line.pay.value          // convert [currency/chaos] → [chaos/currency]
        : line.chaosEquivalent;       // fallback: assume no spread

      if (sell > 0 && buy > 0) {
        sellRate.set(name, sell);
        buyRate.set(name, buy);
      }
    }

    const currencies = Array.from(sellRate.keys());

    // 2-step: A → chaos → B → chaos → A
    for (let i = 0; i < currencies.length; i++) {
      const A = currencies[i];
      const sA = sellRate.get(A)!;
      const bA = buyRate.get(A)!;

      for (let j = 0; j < currencies.length; j++) {
        if (i === j) continue;
        const B = currencies[j];
        const sB = sellRate.get(B)!;
        const bB = buyRate.get(B)!;

        // Sell A → chaos, buy B, sell B → chaos, buy A back
        const chaosAfterSellA = sA;               // sell 1 A
        const unitsB         = chaosAfterSellA / bB; // buy B
        const chaosAfterSellB = unitsB * sB;      // sell B
        const finalA         = chaosAfterSellB / bA; // buy A back

        const profitPercent = (finalA - 1) * 100;
        if (profitPercent >= minProfitPercent) {
          opportunities.push({
            chain: [A, B, A],
            profitPercent,
            startAmount: 1,
            endAmount: finalA,
            steps: [
              { from: A,           to: 'Chaos Orb', rate: sA,       amount: chaosAfterSellA },
              { from: 'Chaos Orb', to: B,           rate: 1 / bB,   amount: unitsB },
              { from: B,           to: 'Chaos Orb', rate: sB,       amount: chaosAfterSellB },
              { from: 'Chaos Orb', to: A,           rate: 1 / bA,   amount: finalA },
            ],
          });
        }
      }
    }

    // 3-step: A → chaos → B → chaos → C → chaos → A (limit iterations for performance)
    const limit = Math.min(currencies.length, 20);
    for (let i = 0; i < limit; i++) {
      const A = currencies[i];
      const sA = sellRate.get(A)!;
      const bA = buyRate.get(A)!;

      for (let j = 0; j < limit; j++) {
        if (j === i) continue;
        const B = currencies[j];
        const sB = sellRate.get(B)!;
        const bB = buyRate.get(B)!;

        for (let k = 0; k < limit; k++) {
          if (k === i || k === j) continue;
          const C = currencies[k];
          const sC = sellRate.get(C)!;
          const bC = buyRate.get(C)!;

          const chaosA  = sA;
          const unitsB  = chaosA  / bB;
          const chaosB  = unitsB  * sB;
          const unitsC  = chaosB  / bC;
          const chaosC  = unitsC  * sC;
          const finalA  = chaosC  / bA;

          const profitPercent = (finalA - 1) * 100;
          if (profitPercent >= minProfitPercent) {
            opportunities.push({
              chain: [A, B, C, A],
              profitPercent,
              startAmount: 1,
              endAmount: finalA,
              steps: [
                { from: A,           to: 'Chaos Orb', rate: sA,     amount: chaosA },
                { from: 'Chaos Orb', to: B,           rate: 1 / bB, amount: unitsB },
                { from: B,           to: 'Chaos Orb', rate: sB,     amount: chaosB },
                { from: 'Chaos Orb', to: C,           rate: 1 / bC, amount: unitsC },
                { from: C,           to: 'Chaos Orb', rate: sC,     amount: chaosC },
                { from: 'Chaos Orb', to: A,           rate: 1 / bA, amount: finalA },
              ],
            });
          }
        }
      }
    }

    opportunities.sort((a, b) => b.profitPercent - a.profitPercent);

    // De-duplicate chains with the same set of currencies
    const seen = new Set<string>();
    const unique = opportunities.filter(opp => {
      const key = [...opp.chain].sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique.slice(0, 20);
  }

  /**
   * Get from cache if not expired
   */
  private getFromCache(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }
    return null;
  }

  /**
   * Put data in cache
   */
  private putInCache(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
