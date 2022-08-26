import { createHeaders } from './headers';
import type {
  RequestHandler,
  PageModule,
  RequestEvent,
  ResponseContext,
  RouteModule,
  RouteParams,
} from '../../runtime/src/library/types';
import type { QwikCityRequestContext, UserResponseContext } from './types';
import { HttpStatus } from './http-status-codes';
import { isRedirectStatus, RedirectResponse } from './redirect-handler';
import { ErrorResponse } from './error-handler';

export async function loadUserResponse(
  requestCtx: QwikCityRequestContext,
  params: RouteParams,
  routeModules: RouteModule[],
  platform: Record<string, any>,
  trailingSlash?: boolean,
  base: string = '/'
) {
  const { request, url } = requestCtx;
  const { pathname } = url;
  const userResponse: UserResponseContext = {
    type: 'endpoint',
    url,
    params,
    status: HttpStatus.Ok,
    headers: createHeaders(),
    resolvedBody: undefined,
    pendingBody: undefined,
  };

  let hasRequestMethodHandler = false;
  const hasPageRenderer = isLastModulePageRoute(routeModules);

  if (hasPageRenderer && pathname !== base) {
    // only check for slash redirect on pages
    if (trailingSlash) {
      // must have a trailing slash
      if (!pathname.endsWith('/')) {
        // add slash to existing pathname
        throw new RedirectResponse(pathname + '/' + url.search, HttpStatus.TemporaryRedirect);
      }
    } else {
      // should not have a trailing slash
      if (pathname.endsWith('/')) {
        // remove slash from existing pathname
        throw new RedirectResponse(
          pathname.slice(0, pathname.length - 1) + url.search,
          HttpStatus.TemporaryRedirect
        );
      }
    }
  }

  let middlewareIndex = -1;

  const abort = () => {
    middlewareIndex = ABORT_INDEX;
  };

  const redirect = (url: string, status?: number) => {
    return new RedirectResponse(url, status, userResponse.headers);
  };

  const error = (status: number, message?: string) => {
    return new ErrorResponse(status, message);
  };

  const next = async () => {
    middlewareIndex++;

    while (middlewareIndex < routeModules.length) {
      const endpointModule = routeModules[middlewareIndex];

      let reqHandler: RequestHandler | undefined = undefined;

      switch (request.method) {
        case 'GET': {
          reqHandler = endpointModule.onGet;
          break;
        }
        case 'POST': {
          reqHandler = endpointModule.onPost;
          break;
        }
        case 'PUT': {
          reqHandler = endpointModule.onPut;
          break;
        }
        case 'PATCH': {
          reqHandler = endpointModule.onPatch;
          break;
        }
        case 'OPTIONS': {
          reqHandler = endpointModule.onOptions;
          break;
        }
        case 'HEAD': {
          reqHandler = endpointModule.onHead;
          break;
        }
        case 'DELETE': {
          reqHandler = endpointModule.onDelete;
          break;
        }
      }

      reqHandler = reqHandler || endpointModule.onRequest;

      if (typeof reqHandler === 'function') {
        hasRequestMethodHandler = true;

        const response: ResponseContext = {
          get status() {
            return userResponse.status;
          },
          set status(code) {
            userResponse.status = code;
          },
          get headers() {
            return userResponse.headers;
          },
          redirect,
          error,
        };

        // create user request event, which is a narrowed down request context
        const requestEv: RequestEvent = {
          request,
          url: new URL(url),
          params: { ...params },
          response,
          platform,
          next,
          abort,
        };

        // get the user's endpoint returned data
        const syncData = reqHandler(requestEv) as any;

        if (typeof syncData === 'function') {
          // sync returned function
          userResponse.pendingBody = createPendingBody(syncData);
        } else if (
          syncData !== null &&
          typeof syncData === 'object' &&
          typeof syncData.then === 'function'
        ) {
          // async returned promise
          const asyncResolved = await syncData;
          if (typeof asyncResolved === 'function') {
            // async resolved function
            userResponse.pendingBody = createPendingBody(asyncResolved);
          } else {
            // async resolved data
            userResponse.resolvedBody = asyncResolved;
          }
        } else {
          // sync returned data
          userResponse.resolvedBody = syncData;
        }
      }

      middlewareIndex++;
    }
  };

  await next();

  if (isRedirectStatus(userResponse.status) && userResponse.headers.has('Location')) {
    // user must have manually set redirect instead of throw response.redirect()
    // never render the page if the user manually set the status to be a redirect
    throw new RedirectResponse(
      userResponse.headers.get('Location')!,
      userResponse.status,
      userResponse.headers
    );
  }

  if (request.headers.get('Accept')?.includes('text/html')) {
    // this is a page module
    // user can force the respond to be an endpoint with Accept request header
    // response should be a page
    userResponse.type = 'page';

    // TODO: need to figure out work with HMR
    // if (!hasPageRenderer) {
    //   throw new ErrorResponse(HttpStatus.NotFound, 'Not Found')
    // }
  } else {
    // this is only an endpoint, and not a page module
    if (!hasRequestMethodHandler) {
      // didn't find any handlers
      throw new ErrorResponse(HttpStatus.MethodNotAllowed, `Method Not Allowed`);
    }
  }

  return userResponse;
}

function createPendingBody(cb: () => any) {
  return new Promise<any>((resolve, reject) => {
    try {
      const rtn = cb();
      if (rtn !== null && typeof rtn === 'object' && typeof rtn.then === 'function') {
        // callback return promise
        rtn.then(resolve, reject);
      } else {
        // callback returned data
        resolve(rtn);
      }
    } catch (e) {
      // sync callback errored
      reject(e);
    }
  });
}

function isLastModulePageRoute(routeModules: RouteModule[]) {
  const lastRouteModule = routeModules[routeModules.length - 1];
  return lastRouteModule && typeof (lastRouteModule as PageModule).default === 'function';
}

const ABORT_INDEX = 999999999;
