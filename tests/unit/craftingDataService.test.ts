import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { formatBaseSlug, parsePoedbText, fetchBaseModData } from '../../src/services/craftingDataService';

describe('formatBaseSlug', () => {
  it('replaces spaces with underscores', () => {
    expect(formatBaseSlug('Hubris Circlet')).toBe('Hubris_Circlet');
  });

  it('handles single word bases', () => {
    expect(formatBaseSlug('Helmet')).toBe('Helmet');
  });

  it('handles apostrophes', () => {
    expect(formatBaseSlug("Soldier's Helmet")).toBe("Soldier's_Helmet");
  });
});

describe('parsePoedbText', () => {
  it('includes text content from HTML body', () => {
    const html = '<h2>Fossil</h2><p>Aberrant Fossil - removes lightning mods</p>';
    const result = parsePoedbText(html, 'Hubris Circlet');
    expect(result).toContain('Aberrant');
  });

  it('returns base name in output', () => {
    const result = parsePoedbText('<html>some content</html>', 'Hubris Circlet');
    expect(result).toContain('Hubris Circlet');
  });
});

describe('fetchBaseModData', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns CraftingBaseData on success', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      text: async () => '<html><body>some mod data</body></html>',
    } as any);

    const result = await fetchBaseModData('Hubris Circlet');
    expect(result.base).toBe('Hubris Circlet');
    expect(result.poedbUrl).toContain('Hubris_Circlet');
    expect(result.modText).toContain('Hubris Circlet');
  });

  it('throws on non-OK response', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
    } as any);

    await expect(fetchBaseModData('Fake Base')).rejects.toThrow('404');
  });

  it('throws with context on network error', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetchBaseModData('Hubris Circlet')).rejects.toThrow('poedb network error for "Hubris Circlet"');
  });
});
