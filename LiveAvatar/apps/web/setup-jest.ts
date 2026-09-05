import 'jest-preset-angular/setup-jest';

// jsdom does not implement window.matchMedia. Angular CDK's BreakpointObserver
// (used by the admin shell for the responsive sidenav, D-2) calls it directly,
// so every component test that touches the shell needs this polyfill.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined, // deprecated, kept for older libs
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
