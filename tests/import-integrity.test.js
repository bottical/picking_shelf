const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const stateManagerSource = fs.readFileSync('js/state-manager.js', 'utf8');

function loadStateManager() {
    const context = {
        console,
        window: {},
        document: { documentElement: null, visibilityState: 'visible' },
        location: { pathname: '/' },
        navigator: { userAgent: 'test' },
        localStorage: { getItem: () => null },
        performance: { now: () => 0 }
    };
    vm.runInNewContext(stateManagerSource, context);
    return context.StateManager;
}

test('verifyPickListCount performs a server read and reports a matching count', async () => {
    const StateManager = loadStateManager();
    let getOptions;
    const manager = Object.create(StateManager.prototype);
    manager.user = { uid: 'test-user' };
    manager._getPickListCollectionRef = () => ({
        get: async (options) => {
            getOptions = options;
            return { size: 100 };
        }
    });

    const result = await manager.verifyPickListCount(100);

    assert.equal(getOptions.source, 'server');
    assert.equal(result.expected, 100);
    assert.equal(result.actual, 100);
    assert.equal(result.ok, true);
});

test('verifyPickListCount reports partial writes as a mismatch', async () => {
    const StateManager = loadStateManager();
    const manager = Object.create(StateManager.prototype);
    manager.user = { uid: 'test-user' };
    manager._getPickListCollectionRef = () => ({ get: async () => ({ size: 73 }) });

    const result = await manager.verifyPickListCount(100);

    assert.equal(result.actual, 73);
    assert.equal(result.ok, false);
});

test('verifyPickListCount propagates server-read failures', async () => {
    const StateManager = loadStateManager();
    const manager = Object.create(StateManager.prototype);
    manager.user = { uid: 'test-user' };
    manager._getPickListCollectionRef = () => ({
        get: async () => { throw new Error('offline'); }
    });

    await assert.rejects(manager.verifyPickListCount(100), /offline/);
});
