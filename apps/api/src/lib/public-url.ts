import { isIP } from 'node:net';

function isPrivateIPv4(host: string): boolean {
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 192 && (b === 0 || (b === 88 && octets[2] === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && octets[2] === 100)))
    || (a === 203 && b === 0 && octets[2] === 113);
}

function expandIPv6(host: string): number[] {
  let address = host.toLowerCase();
  if (address.includes('.')) {
    const separator = address.lastIndexOf(':');
    if (separator < 0) return [];
    const octets = address.slice(separator + 1).split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return [];
    const high = ((octets[0]! << 8) | octets[1]!).toString(16);
    const low = ((octets[2]! << 8) | octets[3]!).toString(16);
    address = `${address.slice(0, separator)}:${high}:${low}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return [];
  const parse = (half: string) => half ? half.split(':').map((part) => Number.parseInt(part, 16)) : [];
  const left = parse(halves[0] ?? '');
  const right = parse(halves[1] ?? '');
  const zeroCount = 8 - left.length - right.length;
  if (zeroCount < 0 || (halves.length === 1 && zeroCount !== 0)) return [];
  const words = [...left, ...Array(zeroCount).fill(0), ...right];
  return words.length === 8 && words.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff) ? words : [];
}

function isPrivateIPv6(host: string): boolean {
  const words = expandIPv6(host);
  if (words.length !== 8) return true;
  const first = words[0]!;
  const second = words[1]!;

  // The globally routable unicast allocation is 2000::/3. This also rejects
  // unspecified, loopback, IPv4-compatible and IPv4-mapped addresses (all begin
  // below this range), including mapped public IPv4 values.
  if (first < 0x2000 || first > 0x3fff) return true;

  // IANA special-purpose, transition and documentation ranges are not public
  // callback origins. 2001::/23 includes protocol assignments such as Teredo,
  // benchmarking and ORCHID; 3fff::/20 is the IPv6 documentation prefix.
  if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return true;
  if (first === 0x2002 || first === 0x3ffe) return true; // 6to4 and deprecated 6bone
  if (first === 0x3fff && second <= 0x0fff) return true;
  return false;
}

/** True only for an HTTPS URL that can be a public gateway callback origin. */
export function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')
    || /\.(?:local|lan|internal|test|invalid|example|onion|arpa)$/.test(hostname)
    || ['example.com', 'example.net', 'example.org'].some((reserved) => hostname === reserved || hostname.endsWith(`.${reserved}`))) return false;
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return !isPrivateIPv4(hostname);
  if (ipVersion === 6) return !isPrivateIPv6(hostname);
  return hostname.includes('.') && !hostname.startsWith('.') && !hostname.endsWith('.');
}
