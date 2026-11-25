const tap = require('tap');
const path = require('path');
const VirtualMachine = require('../../src/virtual-machine');
const {readFileToBuffer} = require('../fixtures/readProjectFile');

const test = tap.test;
const fixture = path.resolve(__dirname, '../fixtures/comments.sb3');

test('serialize transform rewrites toJSON output', async t => {
    const vm = new VirtualMachine();
    await vm.loadProject(readFileToBuffer(fixture));
    const calls = [];
    vm.setProjectTransforms({
        serialize: (json, context) => {
            calls.push(context.isSprite);
            if (!context.isSprite) json.meta.transformed = true;
            return json;
        }
    });
    t.equal(JSON.parse(vm.toJSON()).meta.transformed, true);
    const spriteId = vm.runtime.targets.find(target => !target.isStage).id;
    vm.toJSON(spriteId);
    t.same(calls, [false, true]);
    vm.setProjectTransforms(null);
    t.notOk(JSON.parse(vm.toJSON()).meta.transformed);
});

test('deserialize transform runs before projects and sprites are installed', async t => {
    const vm = new VirtualMachine();
    const calls = [];
    vm.setProjectTransforms({
        deserialize: (json, context) => {
            calls.push(context.isSprite);
            if (!context.isSprite) json.targets[0].variables.injected = ['injected', 42];
            return json;
        }
    });
    await vm.loadProject(readFileToBuffer(fixture));
    t.same(vm.runtime.getTargetForStage().variables.injected.value, 42);
    await vm.addSprite(readFileToBuffer(path.resolve(__dirname, '../fixtures/cat.sprite3')));
    t.same(calls, [false, true]);
});

test('addPrimitives registers block implementations', t => {
    const vm = new VirtualMachine();
    const impl = () => 'ok';
    vm.addPrimitives({sensing_mouseup: impl});
    t.equal(vm.runtime.getOpcodeFunction('sensing_mouseup'), impl);
    t.end();
});
