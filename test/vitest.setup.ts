/**
 * Vitest setup — mirrors the previous `test/mocha.setup.js` so tests keep
 * using chai's `expect` / `should` interface and the `sinon-chai` /
 * `chai-as-promised` plugins.
 *
 * Vitest provides `describe` / `it` / `before` / `after` etc. globally;
 * tests already import `expect` explicitly from `chai`, so there is no
 * shadow conflict with vitest's own `expect`.
 */

import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import sinonChai from "sinon-chai";

// Don't silently swallow unhandled rejections — surface them as test failures.
process.on("unhandledRejection", e => {
    throw e;
});

chai.should();
chai.use(sinonChai);
chai.use(chaiAsPromised);
