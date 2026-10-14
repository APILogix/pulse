import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticate } from '../../src/shared/middleware/auth.js';
import * as sessionRepo from '../../src/modules/auth/infrastructure/repositories/session.repository.js';
import * as jwtCrypto from '../../src/modules/auth/infrastructure/crypto/jwt.js';

describe('Auth Middleware Joined Lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockReply() {
    const reply: any = {};
    reply.status = vi.fn().mockReturnValue(reply);
    reply.send = vi.fn().mockReturnValue(reply);
    return reply;
  }

  function createMockRequest(authHeader = 'Bearer valid-jwt') {
    return {
      headers: { authorization: authHeader },
      log: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
      },
      id: 'req-123',
    } as any;
  }

  it('authenticates user in a single database lookup', async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    vi.spyOn(jwtCrypto, 'verifyAccessToken').mockReturnValue({
      type: 'access',
      sub: 'user-uuid-1',
      jti: 'session-uuid-1',
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
      mfa_verified: true,
    } as any);

    const lookupSpy = vi.spyOn(sessionRepo, 'findSessionAndUserById').mockResolvedValue({
      session_id: 'session-uuid-1',
      session_user_id: 'user-uuid-1',
      session_status: 'active',
      session_expires_at: new Date(Date.now() + 3600000),
      user_id: 'user-uuid-1',
      user_email: 'test@example.com',
      user_is_admin: false,
      user_current_org_id: 'org-uuid-1',
      user_status: 'active',
      user_deleted_at: null,
    });

    await authenticate(request, reply);

    expect(lookupSpy).toHaveBeenCalledWith('session-uuid-1');
    expect(request.user).toEqual({
      id: 'user-uuid-1',
      email: 'test@example.com',
      isAdmin: false,
      currentOrgId: 'org-uuid-1',
      sessionId: 'session-uuid-1',
      mfaVerified: true,
      stepUpFresh: false,
    });
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('rejects if session is not found in database', async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    vi.spyOn(jwtCrypto, 'verifyAccessToken').mockReturnValue({
      type: 'access',
      sub: 'user-uuid-1',
      jti: 'session-uuid-999',
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
    } as any);

    vi.spyOn(sessionRepo, 'findSessionAndUserById').mockResolvedValue(null);

    await authenticate(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      error: { code: 'SESSION_INVALID', message: 'Session not found' },
    });
  });

  it('rejects if session is expired', async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    vi.spyOn(jwtCrypto, 'verifyAccessToken').mockReturnValue({
      type: 'access',
      sub: 'user-uuid-1',
      jti: 'session-uuid-1',
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
    } as any);

    vi.spyOn(sessionRepo, 'findSessionAndUserById').mockResolvedValue({
      session_id: 'session-uuid-1',
      session_user_id: 'user-uuid-1',
      session_status: 'active',
      session_expires_at: new Date(Date.now() - 1000), // Expired
      user_id: 'user-uuid-1',
      user_email: 'test@example.com',
      user_is_admin: false,
      user_current_org_id: null,
      user_status: 'active',
      user_deleted_at: null,
    });

    await authenticate(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      error: { code: 'SESSION_EXPIRED', message: 'Session expired' },
    });
  });

  it('rejects if user account is suspended', async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    vi.spyOn(jwtCrypto, 'verifyAccessToken').mockReturnValue({
      type: 'access',
      sub: 'user-uuid-1',
      jti: 'session-uuid-1',
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
    } as any);

    vi.spyOn(sessionRepo, 'findSessionAndUserById').mockResolvedValue({
      session_id: 'session-uuid-1',
      session_user_id: 'user-uuid-1',
      session_status: 'active',
      session_expires_at: new Date(Date.now() + 3600000),
      user_id: 'user-uuid-1',
      user_email: 'test@example.com',
      user_is_admin: false,
      user_current_org_id: null,
      user_status: 'suspended',
      user_deleted_at: null,
    });

    await authenticate(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({
      error: { code: 'USER_SUSPENDED', message: 'Account suspended' },
    });
  });
});
