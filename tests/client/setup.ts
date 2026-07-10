import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Client render tests run in their own `bun test --preload` invocation so the
// DOM globals (and happy-dom's fetch replacement) never leak into the server
// suites under tests/unit.
GlobalRegistrator.register();
