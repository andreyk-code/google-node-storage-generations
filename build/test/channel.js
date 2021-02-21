"use strict";
// Copyright 2019 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
Object.defineProperty(exports, "__esModule", { value: true });
/*!
 * @module storage/channel
 */
const common_1 = require("@google-cloud/common");
const assert = require("assert");
const mocha_1 = require("mocha");
const proxyquire = require("proxyquire");
let promisified = false;
const fakePromisify = {
    promisifyAll(Class) {
        if (Class.name === 'Channel') {
            promisified = true;
        }
    },
};
class FakeServiceObject extends common_1.ServiceObject {
    constructor(config) {
        super(config);
        // eslint-disable-next-line prefer-rest-params
        this.calledWith_ = arguments;
    }
}
mocha_1.describe('Channel', () => {
    const STORAGE = {};
    const ID = 'channel-id';
    const RESOURCE_ID = 'resource-id';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Channel;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel;
    mocha_1.before(() => {
        Channel = proxyquire('../src/channel.js', {
            '@google-cloud/promisify': fakePromisify,
            '@google-cloud/common': {
                ServiceObject: FakeServiceObject,
            },
        }).Channel;
    });
    mocha_1.beforeEach(() => {
        channel = new Channel(STORAGE, ID, RESOURCE_ID);
    });
    mocha_1.describe('initialization', () => {
        mocha_1.it('should inherit from ServiceObject', () => {
            // Using assert.strictEqual instead of assert to prevent
            // coercing of types.
            assert.strictEqual(channel instanceof common_1.ServiceObject, true);
            const calledWith = channel.calledWith_[0];
            assert.strictEqual(calledWith.parent, STORAGE);
            assert.strictEqual(calledWith.baseUrl, '/channels');
            assert.strictEqual(calledWith.id, '');
            assert.deepStrictEqual(calledWith.methods, {});
        });
        mocha_1.it('should promisify all the things', () => {
            assert(promisified);
        });
        mocha_1.it('should set the default metadata', () => {
            assert.deepStrictEqual(channel.metadata, {
                id: ID,
                resourceId: RESOURCE_ID,
            });
        });
    });
    mocha_1.describe('stop', () => {
        mocha_1.it('should make the correct request', done => {
            channel.request = (reqOpts) => {
                assert.strictEqual(reqOpts.method, 'POST');
                assert.strictEqual(reqOpts.uri, '/stop');
                assert.strictEqual(reqOpts.json, channel.metadata);
                done();
            };
            channel.stop(assert.ifError);
        });
        mocha_1.it('should execute callback with error & API response', done => {
            const error = {};
            const apiResponse = {};
            channel.request = (reqOpts, callback) => {
                callback(error, apiResponse);
            };
            channel.stop((err, apiResponse_) => {
                assert.strictEqual(err, error);
                assert.strictEqual(apiResponse_, apiResponse);
                done();
            });
        });
        mocha_1.it('should not require a callback', done => {
            channel.request = (reqOpts, callback) => {
                assert.doesNotThrow(() => callback());
                done();
            };
            channel.stop();
        });
    });
});
//# sourceMappingURL=channel.js.map