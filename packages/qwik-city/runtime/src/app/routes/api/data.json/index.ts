import type { RequestHandler } from '~qwik-city-runtime';
import os from 'os';

export const onGet: RequestHandler = ({ request }) => {
  return {
    timestamp: Date.now(),
    method: request.method,
    url: request.url,
    os: os.platform(),
    arch: os.arch(),
    node: process.versions.node,
  };
};
