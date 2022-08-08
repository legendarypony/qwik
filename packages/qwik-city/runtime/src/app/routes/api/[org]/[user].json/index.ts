import type { RequestHandler } from '~qwik-city-runtime';
import os from 'os';

export const onGet: RequestHandler = ({ request, params }) => {
  return {
    timestamp: Date.now(),
    method: request.method,
    url: request.url,
    params,
    os: os.platform(),
    arch: os.arch(),
    node: process.versions.node,
  };
};

export const onPost: RequestHandler = async ({ request, response }) => {
  response.headers.set('Content-Type', 'text/plain');
  return `Platform: ${os.platform()}, Node: ${process.versions.node}, HTTP Method: ${
    request.method
  }`;
};
