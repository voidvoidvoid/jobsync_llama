// Firefox exposes the promise-based `browser` namespace. Typed loosely so
// the app's TypeScript setup needs no WebExtension type package.
 
export const ext: any = (globalThis as any).browser ?? (globalThis as any).chrome;
