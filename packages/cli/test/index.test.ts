import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('@azdo-emu/cli entry point', () => {
  it('exports the package name', () => {
    expect(PACKAGE_NAME).toBe('@azdo-emu/cli');
  });
});
