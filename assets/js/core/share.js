// Share links. The message body (ANSI) is compressed and stored in the URL
// hash, so nothing is uploaded anywhere: the link itself is the message.
//   #m=z<base64url>  deflate-raw compressed
//   #m=p<base64url>  plain UTF-8, for browsers without CompressionStream

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeShare(body) {
  const bytes = new TextEncoder().encode(body);
  if (typeof CompressionStream !== 'undefined') {
    try {
      return `z${toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
    } catch {
      /* fall through to plain */
    }
  }
  return `p${toBase64Url(bytes)}`;
}

export async function decodeShare(token) {
  if (!token || token.length < 2) throw new Error('Empty share link');
  const kind = token[0];
  const bytes = fromBase64Url(token.slice(1));
  if (kind === 'p') return new TextDecoder().decode(bytes);
  if (kind === 'z') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser can not open compressed links');
    return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')));
  }
  throw new Error('Unknown share link format');
}
