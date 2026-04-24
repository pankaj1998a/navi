/// <reference types="@cloudflare/workers-types" />
/// <reference types="vite/client" />
export {}

import "@solidjs/start/server";
import "solid-js/web";

declare global {
  namespace App {
    interface RequestEventLocals {
      [key: string]: any;
    }
  }
}

declare module "solid-js/web" {
  export interface RequestEvent {
    locals: App.RequestEventLocals;
  }
  export function getRequestEvent(): RequestEvent | undefined;
}

declare module "@solidjs/start/server" {
  export interface FetchEvent {
    request: Request;
    response: any;
    locals: App.RequestEventLocals;
    nativeEvent: any;
  }
  export interface APIEvent extends FetchEvent {
    params: Record<string, any>;
  }
}

declare module "cloudflare:workers" {
  export const env: any;
  export const waitUntil: (promise: Promise<any>) => void;
}

declare module "@solidjs/start/http" {
  export function useSession<T>(config: any): any;
}

declare module "*.svg" {
  const content: any;
  export default content;
}

declare module "*.png" {
  const content: any;
  export default content;
}

declare module "*.jpg" {
  const content: any;
  export default content;
}

declare module "*.mp4" {
  const content: any;
  export default content;
}

declare module "*.woff2" {
  const content: any;
  export default content;
}

declare module "*.module.css" {
  const classes: { [key: string]: string };
  export default classes;
}
