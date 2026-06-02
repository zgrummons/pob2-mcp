import { describe, it, expect } from '@jest/globals';
import zlib from 'node:zlib';
import { decodePobCode, rawUrlFor } from '../../src/utils/buildCode';

function encode(xml: string, urlSafe = true): string {
  const b64 = zlib.deflateSync(Buffer.from(xml, 'utf8')).toString('base64');
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_') : b64;
}

const SAMPLE_XML = '<?xml version="1.0"?><PathOfBuilding2><Build level="90" className="Monk"/></PathOfBuilding2>';

describe('decodePobCode', () => {
  it('round-trips a URL-safe PoB code back to XML', () => {
    expect(decodePobCode(encode(SAMPLE_XML, true))).toBe(SAMPLE_XML);
  });

  it('also accepts standard base64 and surrounding whitespace', () => {
    expect(decodePobCode('  ' + encode(SAMPLE_XML, false) + '\n')).toBe(SAMPLE_XML);
  });

  it('rejects non-PoB / garbage codes', () => {
    expect(() => decodePobCode('not-a-real-code!!!')).toThrow();
    expect(() => decodePobCode('')).toThrow();
  });
});

describe('rawUrlFor', () => {
  it('rewrites pobb.in links to /raw', () => {
    expect(rawUrlFor('https://pobb.in/Pasi1Qwn0wtj')).toBe('https://pobb.in/Pasi1Qwn0wtj/raw');
  });

  it('rewrites pastebin links to /raw/', () => {
    expect(rawUrlFor('https://pastebin.com/abcd1234')).toBe('https://pastebin.com/raw/abcd1234');
  });

  it('leaves already-raw or unknown URLs unchanged', () => {
    expect(rawUrlFor('https://pobb.in/Pasi1Qwn0wtj/raw')).toBe('https://pobb.in/Pasi1Qwn0wtj/raw');
    expect(rawUrlFor('https://example.com/code.txt')).toBe('https://example.com/code.txt');
  });
});
