import { describe, expect, it } from 'vitest';
import { AzureCredentialStore, PACKAGE_NAME, authStatus, profileUrl } from '../src/index.js';

describe('@azdo-emu/fetch entry point', () => {
  it('exports the package name', () => {
    expect(PACKAGE_NAME).toBe('@azdo-emu/fetch');
  });

  it('exports the E09 auth storage and status surface', () => {
    expect(AzureCredentialStore).toBeTypeOf('function');
    expect(authStatus).toBeTypeOf('function');
    expect(profileUrl).toBeTypeOf('function');
  });
});
