import type { IncomingMessage, ServerResponse } from 'node:http';
import { Http2ServerRequest } from 'node:http2';
import type {
  ServerRequestMode,
  ServerRequestEvent,
} from '@builder.io/qwik-city/middleware/request-handler';

function getOrigin(req: IncomingMessage) {
  const { PROTOCOL_HEADER, HOST_HEADER } = process.env;
  const headers = req.headers;
  const protocol =
    (PROTOCOL_HEADER && headers[PROTOCOL_HEADER]) ||
    ((req.socket as any).encrypted || (req.connection as any).encrypted ? 'https' : 'http');
  const hostHeader = HOST_HEADER ?? (req instanceof Http2ServerRequest ? ':authority' : 'host');
  const host = headers[hostHeader];

  return `${protocol}://${host}`;
}

export function getUrl(
  req: IncomingMessage,
  origin: string = process.env.ORIGIN ?? getOrigin(req)
) {
  return normalizeUrl((req as any).originalUrl || req.url || '/', origin);
}

const DOUBLE_SLASH_REG = /\/\/|\\\\/g;

export function normalizeUrl(url: string, base: string) {
  // do not allow the url to have a relative protocol url
  // which could bypass of CSRF protections
  // for example: new URL("//attacker.com", "https://qwik.build.io")
  // would return "https://attacker.com" when it should be "https://qwik.build.io/attacker.com"
  return new URL(url.replace(DOUBLE_SLASH_REG, '/'), base);
}

export async function fromNodeHttp(
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  mode: ServerRequestMode
) {
  const requestHeaders = new Headers();
  const nodeRequestHeaders = req.headers;
  for (const key in nodeRequestHeaders) {
    const value = nodeRequestHeaders[key];
    if (typeof value === 'string') {
      requestHeaders.set(key, value);
    } else if (Array.isArray(value)) {
      for (const v of value) {
        requestHeaders.append(key, v);
      }
    }
  }

  const getRequestBody = async function* () {
    for await (const chunk of req as any) {
      yield chunk;
    }
  };

  const body = req.method === 'HEAD' || req.method === 'GET' ? undefined : getRequestBody();
  const options = {
    method: req.method,
    headers: requestHeaders,
    body: body as any,
    duplex: 'half' as any,
  };
  const serverRequestEv: ServerRequestEvent<boolean> = {
    mode,
    url,
    request: new Request(url.href, options as any),
    env: {
      get(key) {
        return process.env[key];
      },
    },
    getWritableStream: (status, headers, cookies) => {
      res.statusCode = status;
      headers.forEach((value, key) => res.setHeader(key, value));
      const cookieHeaders = cookies.headers();
      if (cookieHeaders.length > 0) {
        res.setHeader('Set-Cookie', cookieHeaders);
      }
      return new WritableStream<Uint8Array>({
        start(controller) {
          res.on('close', () => controller.error());
        },
        write(chunk) {
          return new Promise((resolve, reject) =>
            res.write(chunk, (cb) => {
              if (cb) {
                reject(cb);
              } else {
                resolve();
              }
            })
          );
        },
        close() {
          res.end();
        },
      });
    },
    platform: {
      ssr: true,
      incomingMessage: req,
      node: process.versions.node,
    },
    locale: undefined,
  };

  return serverRequestEv;
}
