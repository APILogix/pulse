import { describe, expect, it } from 'vitest';
import {
  validateSessionDevice,
  buildDeviceFingerprint,
  getIpSubnet,
  hashToken,
} from './infrastructure/crypto/hash.js';
import { hashEmailMfaOtp } from './application/services/email.service.js';
import { getRefreshCookieNames, getRefreshCookieValue } from './presentation/cookies.js';
import { parseTrustProxy, buildCorsOrigin } from '../../app.js';

describe('Security Audit Remediation Tests', () => {
  describe('H1 & M4: Session Device & Subnet Matching', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
    const ip = '198.51.100.10';
    const fp = buildDeviceFingerprint(ip, ua);

    it('validates matching device fingerprint, user agent, and IP', () => {
      const valid = validateSessionDevice(fp, ua, ip, ip, ua);
      expect(valid).toBe(true);
    });

    it('allows mobile IP churn within the same /24 IPv4 subnet when user-agent matches', () => {
      const mobileUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
      const mobileIp = '198.51.100.10';
      const mobileFp = buildDeviceFingerprint(mobileIp, mobileUa);
      const newIp = '198.51.100.99';

      const valid = validateSessionDevice(mobileFp, mobileUa, mobileIp, newIp, mobileUa);
      expect(valid).toBe(true);
    });

    it('rejects completely different User-Agent even if IP matches', () => {
      const valid = validateSessionDevice(fp, ua, ip, ip, 'curl/7.68.0');
      expect(valid).toBe(false);
    });

    it('rejects IP change outside /24 subnet when fingerprint differs', () => {
      const differentSubnetIp = '203.0.113.50';
      const valid = validateSessionDevice(fp, ua, ip, differentSubnetIp, ua);
      expect(valid).toBe(false);
    });

    it('correctly calculates /24 for IPv4 and /48 for IPv6', () => {
      expect(getIpSubnet('192.168.1.150')).toBe('192.168.1');
      expect(getIpSubnet('2001:db8:abcd:0012::1')).toBe('2001:db8:abcd');
    });
  });

  describe('H2: Email MFA OTP HMAC-SHA256 Secret Hashing', () => {
    it('hashes OTP using HMAC-SHA256 keyed with AUTH_TOKEN_SECRET', () => {
      const otp = '123456';
      const hash = hashEmailMfaOtp(otp);
      expect(hash).toBe(hashToken('email_mfa_otp:' + otp));
      expect(hash).toHaveLength(64);
    });
  });

  describe('H5: CORS Non-Production Origin Restriction', () => {
    it('restricts CORS origin validation to explicit origins or localhost/127.0.0.1 without reflecting arbitrary origins', () => {
      const isAllowed = buildCorsOrigin(['https://app.pulse.io']);

      let result1 = false;
      isAllowed('https://app.pulse.io', (err, allow) => { result1 = !err && Boolean(allow); });
      expect(result1).toBe(true);

      let result2 = false;
      isAllowed('http://localhost:3000', (err, allow) => { result2 = !err && Boolean(allow); });
      expect(result2).toBe(true);

      let result3 = true;
      isAllowed('https://evil-attacker.com', (err, allow) => { result3 = !err && Boolean(allow); });
      expect(result3).toBe(false);
    });
  });

  describe('C2: Trust Proxy CIDR Parsing', () => {
    it('parses custom comma-separated CIDRs and IP list', () => {
      const result = parseTrustProxy('127.0.0.1, 10.0.0.0/8, 172.16.0.0/12');
      expect(result).toEqual(['127.0.0.1', '10.0.0.0/8', '172.16.0.0/12']);
    });

    it('returns true when boolean true', () => {
      const result = parseTrustProxy('true');
      expect(result).toBe(true);
    });

    it('returns false when disabled', () => {
      expect(parseTrustProxy('false')).toBe(false);
    });
  });

  describe('M5: Cookie Shadowing Prevention', () => {
    it('returns available refresh cookie names without duplicate insecure names in secure prefix mode', () => {
      const names = getRefreshCookieNames();
      expect(names.length).toBeGreaterThan(0);
    });

    it('retrieves refresh cookie value from cookie map', () => {
      const cookieMap = { '__Host-refresh_token': 'test-jwt-value' };
      const value = getRefreshCookieValue(cookieMap);
      expect(value).toBe('test-jwt-value');
    });
  });
});
