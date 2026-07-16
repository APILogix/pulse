import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encrypt, decryptAsync, _testEncryptionCache } from '../../../src/shared/utils/encryption.js';
import crypto from 'crypto';
import dns from 'dns';

describe('Encryption LRU Cache (BUG-04)', () => {
  const secret = '01234567890123456789012345678912';
  const plaintext = '{"foo":"bar"}';
  
  let scryptSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _testEncryptionCache.clear();
    scryptSpy = vi.spyOn(crypto, 'scrypt');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly decrypts and caches the derived key for the same salt', async () => {
    const ciphertext = encrypt(plaintext, secret);
    
    // First decrypt - cache miss
    const result1 = await decryptAsync(ciphertext, secret);
    expect(result1).toBe(plaintext);
    expect(scryptSpy).toHaveBeenCalledTimes(1);
    
    // Second decrypt - cache hit
    const result2 = await decryptAsync(ciphertext, secret);
    expect(result2).toBe(plaintext);
    expect(scryptSpy).toHaveBeenCalledTimes(1); // Call count remains 1
  });

  it('isolates cache entries by salt', async () => {
    const ciphertext1 = encrypt(plaintext, secret);
    const ciphertext2 = encrypt(plaintext, secret); // New random salt generated
    
    const result1 = await decryptAsync(ciphertext1, secret);
    const result2 = await decryptAsync(ciphertext2, secret);
    
    expect(result1).toBe(plaintext);
    expect(result2).toBe(plaintext);
    expect(scryptSpy).toHaveBeenCalledTimes(2); // Both were cache misses
    expect(_testEncryptionCache.size).toBe(2);
  });

  it('evicts oldest entries when cache exceeds max size', async () => {
    _testEncryptionCache.setMax(3);
    const ciphertexts = Array.from({ length: 4 }, () => encrypt(plaintext, secret));
    
    for (const c of ciphertexts) {
      await decryptAsync(c, secret);
    }
    
    expect(_testEncryptionCache.size).toBe(3); // Maxed out at 3, no unbounded growth
    expect(scryptSpy).toHaveBeenCalledTimes(4);
    _testEncryptionCache.setMax(500); // restore
  });

  it('completes 200 sequential decryptions in < 300ms', async () => {
    const ciphertext = encrypt(plaintext, secret);
    
    const start = Date.now();
    for (let i = 0; i < 200; i++) {
      await decryptAsync(ciphertext, secret);
    }
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(300);
    expect(scryptSpy).toHaveBeenCalledTimes(1);
  });

  it('does not saturate the libuv threadpool during a storm', async () => {
    const ciphertext = encrypt(plaintext, secret);
    
    const start = Date.now();
    
    // Fire off 100 concurrent async decryptions
    const decryptions = Promise.all(
      Array.from({ length: 100 }, () => decryptAsync(ciphertext, secret))
    );
    
    // Concurrently run a DNS lookup that uses the threadpool
    const lookup = new Promise<void>((resolve, reject) => {
      dns.lookup('localhost', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    await Promise.all([decryptions, lookup]);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(500);
  });
});
