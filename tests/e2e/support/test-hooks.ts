import { startDriverAndSession, stopDriverAndSession } from './driver';

export const mochaHooks = {
  beforeAll: [
    async function (this: Mocha.Context) {
      this.timeout(60_000);
      await startDriverAndSession();
    },
  ],
  afterAll: [
    async function (this: Mocha.Context) {
      this.timeout(30_000);
      await stopDriverAndSession();
    },
  ],
};
