import { slugify } from './slugify';

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
  });

  it('strips accented characters', () => {
    expect(slugify('Çağrı Örneği')).toBe('cagri-ornegi');
  });

  it('trims leading/trailing separators', () => {
    expect(slugify('  --Hello World--  ')).toBe('hello-world');
  });
});
