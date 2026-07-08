import { describe, expect, it } from 'vitest';
import { BackupCodeLoginSchema, LoginMFAVerifySchema, } from '../domain/types.js';
import { BACKUP_CODE_HEX_LENGTH } from '../domain/constants.js';
describe('auth backup code schemas', () => {
    it('accepts a 20-character hex backup code', () => {
        const code = 'a'.repeat(BACKUP_CODE_HEX_LENGTH);
        expect(BackupCodeLoginSchema.safeParse({
            challenge_id: 'ch_abc123',
            code,
        }).success).toBe(true);
    });
    it('rejects legacy 10-character backup codes', () => {
        expect(BackupCodeLoginSchema.safeParse({
            challenge_id: 'ch_abc123',
            code: 'a'.repeat(10),
        }).success).toBe(false);
    });
    it('login MFA verify accepts only 6-digit OTP', () => {
        expect(LoginMFAVerifySchema.safeParse({
            challenge_id: 'ch_abc123',
            code: '123456',
        }).success).toBe(true);
        expect(LoginMFAVerifySchema.safeParse({
            challenge_id: 'ch_abc123',
            code: 'a'.repeat(20),
        }).success).toBe(false);
    });
});
//# sourceMappingURL=auth.schemas.test.js.map