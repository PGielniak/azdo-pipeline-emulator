import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('@azdo-emu/engine entry point', () => {
  it('exports the package name', () => {
    expect(PACKAGE_NAME).toBe('@azdo-emu/engine');
  });
});
