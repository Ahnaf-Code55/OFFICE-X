import { isIP } from 'node:net';

/** Prefer a user's managed relay override, then the release-provided endpoint. */
export function resolveManagedRelayAddress(configured: unknown, releaseDefault: unknown): string {
  return normalizeRelayMultiaddr(configured) || normalizeRelayMultiaddr(releaseDefault);
}

function normalizeRelayMultiaddr(value: unknown): string {
  if (typeof value !== 'string') return '';
  const address = value.trim();
  if (!address || address.length > 2048 || !address.startsWith('/') || /[\u0000-\u0020\u007f]/.test(address)) return '';
  return address;
}

/** Public literal-IP TCP endpoint advertised in a peer-to-peer invite. */
export function normalizePublicTeamEndpoint(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw) return '';
  if (raw.length > 512 || /[\u0000-\u0020\u007f]/.test(raw)) return '';
  const parts = raw.slice(1).split('/');
  if (!raw.startsWith('/') || parts.length !== 4) return '';
  const [ipProtocol, address, transport, port] = parts;
  if ((ipProtocol !== 'ip4' && ipProtocol !== 'ip6') || transport !== 'tcp'
    || !isPublicTeamRouteAddress(address) || !/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65_535) return '';
  if ((ipProtocol === 'ip4' && isIP(address) !== 4) || (ipProtocol === 'ip6' && isIP(address) !== 6)) return '';
  return raw;
}

/** Bind the same public TCP port on all local interfaces for router forwarding. */
export function teamListenAddressForEndpoint(endpoint: string): string | undefined {
  const normalized = normalizePublicTeamEndpoint(endpoint);
  if (!normalized) return undefined;
  const [, protocol, , , port] = normalized.split('/');
  return protocol === 'ip6' ? `/ip6/::/tcp/${port}` : `/ip4/0.0.0.0/tcp/${port}`;
}

export function teamEndpointForPeer(endpoint: string, peerId: string): string | undefined {
  const normalized = normalizePublicTeamEndpoint(endpoint);
  if (!normalized || !/^[A-Za-z0-9]{20,128}$/.test(peerId)) return undefined;
  return `${normalized}/p2p/${peerId}`;
}

export function isPublicTeamRouteAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100))
      || (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6 || address.includes('%')) return false;
  const normalized = address.toLowerCase();
  return /^[23]/.test(normalized) && !normalized.startsWith('2001:db8:') && !normalized.startsWith('2001:10:');
}
