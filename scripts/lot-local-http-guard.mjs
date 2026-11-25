/**
 * LOT Build 22: local single-user request boundary.
 * This is NOT user authentication, process isolation, or hosted-service security.
 * It prevents an unintended LAN-exposed Vite proxy and browser cross-site / DNS
 * rebinding calls to this local proof service.
 */

// The API is intentionally HTTP because it is accessible exclusively on this
// computer's loopback interface. Never accept arbitrary Host names or proxies.
const LOCAL_AUTHORITY = /^(localhost|127\.0\.0\.1):([1-9][0-9]{0,4})$/;

export function localAuthority(host) {
  if (typeof host !== 'string' || host.length > 32) return null;
  const match = LOCAL_AUTHORITY.exec(host);
  if (!match) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port > 65535) return null;
  return host;
}

/** This check should run before routing every API request, including GETs. */
export function allowedLocalRequestHost(headers = {}) {
  if (!localAuthority(headers.host)) return false;
  // A modern browser marks a request initiated by a foreign website as
  // cross-site. This is defense in depth; legacy clients may omit it.
  const fetchSite = headers['sec-fetch-site'];
  return fetchSite === undefined || fetchSite === 'same-origin' || fetchSite === 'none';
}

/** State-changing requests must originate on the EXACT same dev-UI authority. */
export function allowedLocalWrite({host, origin, suppliedCsrf, expectedCsrf, fetchSite}) {
  const authority = localAuthority(host);
  if (!authority || typeof origin !== 'string' || origin !== `http://${authority}`) return false;
  if (typeof expectedCsrf !== 'string' || expectedCsrf.length < 32 || suppliedCsrf !== expectedCsrf) return false;
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  return true;
}
