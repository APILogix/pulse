/**
 * Minimal SAML XML helpers for logout request/response parsing (no extra deps).
 */
import { inflateRawSync } from 'zlib';

import { AuthError, AuthErrorCodes } from '../../domain/types.js';

const MAX_SAML_BASE64_BYTES = 256 * 1024;
const MAX_SAML_XML_BYTES = 1024 * 1024;

function decodeSamlPayload(base64Payload: string): string {
  if (base64Payload.length > MAX_SAML_BASE64_BYTES) {
    throw new AuthError(
      'SAML payload too large',
      AuthErrorCodes.SAML_RESPONSE_INVALID,
      413,
    );
  }

  const raw = Buffer.from(base64Payload, 'base64');
  if (raw.length > MAX_SAML_BASE64_BYTES) {
    throw new AuthError(
      'SAML payload too large',
      AuthErrorCodes.SAML_RESPONSE_INVALID,
      413,
    );
  }

  try {
    return inflateRawSync(raw, {
      maxOutputLength: MAX_SAML_XML_BYTES,
    }).toString('utf8');
  } catch (error) {
    if (
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'ERR_BUFFER_TOO_LARGE'
    ) {
      throw new AuthError(
        'SAML payload too large',
        AuthErrorCodes.SAML_RESPONSE_INVALID,
        413,
      );
    }
    if (raw.length > MAX_SAML_XML_BYTES) {
      throw new AuthError(
        'SAML payload too large',
        AuthErrorCodes.SAML_RESPONSE_INVALID,
        413,
      );
    }
    return raw.toString('utf8');
  }
}

export function decodeSamlPostPayload(base64Payload: string): string {
  if (base64Payload.length > MAX_SAML_BASE64_BYTES) {
    throw new AuthError(
      'SAML payload too large',
      AuthErrorCodes.SAML_RESPONSE_INVALID,
      413,
    );
  }

  const raw = Buffer.from(base64Payload, 'base64');
  if (raw.length > MAX_SAML_XML_BYTES) {
    throw new AuthError(
      'SAML payload too large',
      AuthErrorCodes.SAML_RESPONSE_INVALID,
      413,
    );
  }
  return raw.toString('utf8');
}

export function parseSamlIssuer(base64Payload: string): string | null {
  const xml = decodeSamlPostPayload(base64Payload);
  return firstMatch(xml, [
    /<(?:saml:|saml2:)?Issuer[^>]*>([^<]+)<\/(?:saml:|saml2:)?Issuer>/i,
    /<Issuer[^>]*>([^<]+)<\/Issuer>/i,
  ]);
}

function firstMatch(xml: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = xml.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

export interface ParsedSamlLogoutPayload {
  nameId: string | null;
  issuer: string | null;
  sessionIndex: string | null;
}

export function parseSamlLogoutPayload(
  base64Payload: string,
): ParsedSamlLogoutPayload {
  const xml = decodeSamlPayload(base64Payload);
  const nameId = firstMatch(xml, [
    /<(?:samlp:|saml2p:)?LogoutRequest[^>]*>[\s\S]*?<(?:saml:|saml2:)?NameID[^>]*>([^<]+)<\/(?:saml:|saml2:)?NameID>/i,
    /<(?:saml:|saml2:)?NameID[^>]*>([^<]+)<\/(?:saml:|saml2:)?NameID>/i,
    /<NameID[^>]*>([^<]+)<\/NameID>/i,
  ]);
  const issuer = firstMatch(xml, [
    /<(?:samlp:|saml2p:)?LogoutRequest[^>]*>[\s\S]*?<(?:saml:|saml2:)?Issuer[^>]*>([^<]+)<\/(?:saml:|saml2:)?Issuer>/i,
    /<(?:saml:|saml2:)?Issuer[^>]*>([^<]+)<\/(?:saml:|saml2:)?Issuer>/i,
    /<Issuer[^>]*>([^<]+)<\/Issuer>/i,
  ]);
  const sessionIndex = firstMatch(xml, [
    /SessionIndex="([^"]+)"/i,
    /<(?:samlp:|saml2p:)?SessionIndex[^>]*>([^<]+)<\/(?:samlp:|saml2p:)?SessionIndex>/i,
  ]);
  return { nameId, issuer, sessionIndex };
}
