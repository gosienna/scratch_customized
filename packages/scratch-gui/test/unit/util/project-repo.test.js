/**
 * @jest-environment node
 */
/* eslint-env jest */
import fs from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-gui-repos-'));
const mockSettings = new Map();

jest.mock('@scratch-customized/platform', () => {
    const actual = jest.requireActual('@scratch-customized/platform');
    const nodeFs = jest.requireActual('fs');
    return {
        ...actual,
        getBrowserGitFs: () => nodeFs,
        repoDirFor: id => `${mockRoot}/${id}`,
        listBrowserRepos: () => actual.listProjectRepos(nodeFs, mockRoot),
        deleteBrowserRepo: id => nodeFs.promises.rm(`${mockRoot}/${id}`, {recursive: true}),
        getSetting: key => Promise.resolve(mockSettings.get(key)),
        setSetting: (key, value) => Promise.resolve(mockSettings.set(key, value)),
        legacyBrowserProjects: () => ({list: () => Promise.resolve([])})
    };
});

/** A Drive-like store in memory: files by ID, each with its bytes and token. */
const mockFiles = new Map();
const mockStore = {
    kind: 'drive',
    save: jest.fn((name, data, {id, token} = {}) => {
        const fileId = id ?? `file${mockFiles.size + 1}`;
        mockFiles.set(fileId, {name, data: data.slice(), token});
        return Promise.resolve({id: fileId, name, format: 'bundle', modified: Date.now()});
    }),
    load: jest.fn(id => Promise.resolve(mockFiles.get(id).data.slice().buffer)),
    token: jest.fn(id => Promise.resolve(mockFiles.get(id)?.token)),
    thumbnail: () => Promise.resolve(null)
};
jest.mock('../../../src/lib/customized/project-stores', () => ({getProjectStores: () => ({drive: mockStore})}));
jest.mock('../../../src/lib/customized/project-thumbnail', () => ({
    captureThumbnail: () => Promise.resolve(new Blob(['png']))
}));
jest.mock('../../../src/lib/customized/reload-project', () => ({reloadProject: jest.fn()}));

import {
    listBrowserProjects,
    openStoredProject,
    saveProject
} from '../../../src/lib/customized/project-repo';
import {
    cloneBundle,
    commitProject,
    createBundle,
    listVersions,
    openProjectRepo
} from '@scratch-customized/platform';

const stage = say => {
    const block = (opcode, extra) => ({
        opcode,
        next: null,
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: false,
        ...extra
    });
    return {
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: say ? {
            a: block('event_whenflagclicked', {next: 'b', topLevel: true, x: 0, y: 0}),
            b: block('looks_say', {parent: 'a', inputs: {MESSAGE: [1, [10, say]]}})
        } : {},
        comments: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 0
    };
};

const sb3Of = async say => {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({
        targets: [stage(say)],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '0.0.0', agent: 'test'}
    }));
    return zip.generateAsync({type: 'arraybuffer'});
};

/** A VM whose project is whatever `say` was last set to. */
const fakeVm = () => {
    const vm = {
        say: null,
        loaded: null,
        saveProjectSb3: async () => new Blob([await sb3Of(vm.say)]),
        loadProject: jest.fn(data => {
            vm.loaded = data;
            return Promise.resolve();
        })
    };
    return vm;
};

afterAll(() => fs.rmSync(mockRoot, {recursive: true, force: true}));
beforeEach(() => {
    for (const entry of fs.readdirSync(mockRoot)) fs.rmSync(path.join(mockRoot, entry), {recursive: true});
    mockFiles.clear();
    jest.clearAllMocks();
});

test('commits to a new repository, then only when something changed', async () => {
    const vm = fakeVm();
    vm.say = 'hello';
    const first = await saveProject({vm, current: null, name: 'Local', message: 'First'});
    expect(first).toMatchObject({branch: 'main', committed: true, backupError: null});
    expect(first.current).toMatchObject({name: 'Local', backupKind: null, backupId: null});

    const again = await saveProject({vm, current: first.current, name: 'Local'});
    expect(again.committed).toBe(false);
    expect(again.current.repoId).toBe(first.current.repoId);
    expect(mockStore.save).not.toHaveBeenCalled();

    const listed = await listBrowserProjects();
    expect(listed.find(r => r.id === first.current.repoId)).toMatchObject({name: 'Local'});
});

test('backs the whole history up as one bundle, and refuses to overwrite changes made elsewhere', async () => {
    const vm = fakeVm();
    vm.say = 'one';
    const saved = await saveProject({vm, current: null, name: 'Game', backupKind: 'drive'});
    expect(saved.current).toMatchObject({backupKind: 'drive', backupId: 'file1'});
    const uploaded = mockFiles.get('file1');
    expect(new TextDecoder().decode(uploaded.data.subarray(0, 16))).toBe('# v2 git bundle\n');

    // A second commit replaces the same file; the backup's token matches, so it is not downloaded first.
    vm.say = 'two';
    const second = await saveProject({vm, current: saved.current, name: 'Game'});
    expect(second).toMatchObject({committed: true, backupError: null, current: {backupId: 'file1'}});
    expect(mockStore.load).not.toHaveBeenCalled();

    // Another computer opens the backup, commits, and uploads.
    const other = await cloneBundle(fs, path.join(mockRoot, 'elsewhere'), mockFiles.get('file1').data);
    await commitProject(other, await sb3Of('elsewhere'), 'Elsewhere', {name: 'Other'});
    const otherBundle = await createBundle(other);
    mockFiles.set('file1', {name: 'Game', data: otherBundle.bytes, token: otherBundle.token});

    // Saving here now finds the backup changed; both sides changed main, so it is not overwritten.
    vm.say = 'three';
    const third = await saveProject({vm, current: second.current, name: 'Game'});
    expect(third.committed).toBe(true);
    expect(third.backupError?.message).toContain('also changed on another computer');
    expect(mockFiles.get('file1').token).toBe(otherBundle.token);
    const repo = await openProjectRepo(fs, path.join(mockRoot, saved.current.repoId));
    expect((await listVersions(repo)).length).toBe(3);
});

test('opens a bundle as a repository, and imports an old .sb3 as a new one', async () => {
    const vm = fakeVm();
    vm.say = 'shared';
    const saved = await saveProject({vm, current: null, name: 'Shared', backupKind: 'drive'});

    const reader = fakeVm();
    // A new browser has no repository for this file yet: the bundle is cloned.
    fs.rmSync(path.join(mockRoot, saved.current.repoId), {recursive: true});
    const opened = await openStoredProject(reader, 'drive', {id: 'file1', name: 'Shared', format: 'bundle'});
    expect(opened).toMatchObject({branch: 'main', current: {name: 'Shared', backupKind: 'drive', backupId: 'file1'}});
    const zip = await JSZip.loadAsync(reader.loaded);
    expect(await zip.file('project.json').async('string')).toContain('shared');

    // Opening it again reuses that repository.
    const reopened = await openStoredProject(reader, 'drive', {id: 'file1', name: 'Shared', format: 'bundle'});
    expect(reopened.current.repoId).toBe(opened.current.repoId);

    mockFiles.set('old', {name: 'Old', data: new Uint8Array(await sb3Of('old'))});
    reader.saveProjectSb3 = async () => new Blob([await sb3Of('old')]);
    const imported = await openStoredProject(reader, 'drive', {id: 'old', name: 'Old', format: 'sb3'});
    // The next save writes a bundle beside the .sb3 file, which is left as it was.
    expect(imported.current).toMatchObject({name: 'Old', backupKind: 'drive', backupId: null});
    const repo = await openProjectRepo(fs, path.join(mockRoot, imported.current.repoId));
    expect((await listVersions(repo)).map(v => v.message)).toEqual(['Imported Old.sb3']);
});
