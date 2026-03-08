import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'path';
import fs from 'fs';

const INDEX_JS = path.resolve('index.js');

// Use a temp store dir with a pre-existing keypair so --setup-only
// doesn't prompt interactively (keypairs already exist → skip seed prompt).
const TEMP_STORE = './test-setup-only-store-' + Date.now();
const TEMP_MSB_STORE = './test-setup-only-msb-' + Date.now();

describe('--setup-only flag', () => {
    it('exits after keypair creation (exit code 0, no MSB start)', (_, done) => {
        // Create fake keypair files so the node won't prompt for seed
        const peerDbDir = path.join('stores', TEMP_STORE, 'db');
        const msbDbDir = path.join('stores', TEMP_MSB_STORE, 'db');
        fs.mkdirSync(peerDbDir, { recursive: true });
        fs.mkdirSync(msbDbDir, { recursive: true });
        fs.writeFileSync(path.join(peerDbDir, 'keypair.json'), '{"test":true}');
        fs.writeFileSync(path.join(msbDbDir, 'keypair.json'), '{"test":true}');

        execFile('node', [
            INDEX_JS,
            '--peer-store-name', TEMP_STORE,
            '--msb-store-name', TEMP_MSB_STORE,
            '--sc-bridge-token', 'test-token',
            '--setup-only', '1',
        ], { timeout: 10_000 }, (err, stdout, stderr) => {
            // Clean up temp stores
            fs.rmSync(path.join('stores', TEMP_STORE), { recursive: true, force: true });
            fs.rmSync(path.join('stores', TEMP_MSB_STORE), { recursive: true, force: true });

            assert.equal(err, null, 'should exit cleanly (code 0)');
            assert.ok(stdout.includes('Setup complete'), 'should print setup complete message');
            done();
        });
    });

    it('does not start SC-Bridge or Hyperswarm', (_, done) => {
        // Create fake keypair files
        const peerDbDir = path.join('stores', TEMP_STORE, 'db');
        const msbDbDir = path.join('stores', TEMP_MSB_STORE, 'db');
        fs.mkdirSync(peerDbDir, { recursive: true });
        fs.mkdirSync(msbDbDir, { recursive: true });
        fs.writeFileSync(path.join(peerDbDir, 'keypair.json'), '{"test":true}');
        fs.writeFileSync(path.join(msbDbDir, 'keypair.json'), '{"test":true}');

        execFile('node', [
            INDEX_JS,
            '--peer-store-name', TEMP_STORE,
            '--msb-store-name', TEMP_MSB_STORE,
            '--sc-bridge-token', 'test-token',
            '--setup-only', '1',
        ], { timeout: 10_000 }, (err, stdout, stderr) => {
            // Clean up temp stores
            fs.rmSync(path.join('stores', TEMP_STORE), { recursive: true, force: true });
            fs.rmSync(path.join('stores', TEMP_MSB_STORE), { recursive: true, force: true });

            assert.ok(!stdout.includes('STARTING MSB'), 'should not start MSB');
            assert.ok(!stdout.includes('STARTING PEER'), 'should not start Peer');
            assert.ok(!stdout.includes('SC-Bridge'), 'should not start SC-Bridge');
            done();
        });
    });
});
