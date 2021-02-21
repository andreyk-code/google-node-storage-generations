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
const common_1 = require("@google-cloud/common");
const assert = require("assert");
const mocha_1 = require("mocha");
const proxyquire = require("proxyquire");
mocha_1.describe('storage/iam', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Iam;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let iam;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let BUCKET_INSTANCE;
    let promisified = false;
    const fakePromisify = {
        // tslint:disable-next-line:variable-name
        promisifyAll(Class) {
            if (Class.name === 'Iam') {
                promisified = true;
            }
        },
    };
    mocha_1.before(() => {
        Iam = proxyquire('../src/iam.js', {
            '@google-cloud/promisify': fakePromisify,
        }).Iam;
    });
    mocha_1.beforeEach(() => {
        const id = 'bucket-id';
        BUCKET_INSTANCE = {
            id,
            request: common_1.util.noop,
            getId: () => id,
        };
        iam = new Iam(BUCKET_INSTANCE);
    });
    mocha_1.describe('initialization', () => {
        mocha_1.it('should promisify all the things', () => {
            assert(promisified);
        });
        mocha_1.it('should localize the request function', done => {
            Object.assign(BUCKET_INSTANCE, {
                request(callback) {
                    assert.strictEqual(this, BUCKET_INSTANCE);
                    callback(); // done()
                },
            });
            const iam = new Iam(BUCKET_INSTANCE);
            iam.request_(done);
        });
        mocha_1.it('should localize the resource ID', () => {
            assert.strictEqual(iam.resourceId_, 'buckets/' + BUCKET_INSTANCE.id);
        });
    });
    mocha_1.describe('getPolicy', () => {
        mocha_1.it('should make the correct api request', done => {
            iam.request_ = (reqOpts, callback) => {
                assert.deepStrictEqual(reqOpts, {
                    uri: '/iam',
                    qs: {},
                });
                callback(); // done()
            };
            iam.getPolicy(done);
        });
        mocha_1.it('should accept an options object', done => {
            const options = {
                userProject: 'grape-spaceship-123',
            };
            iam.request_ = (reqOpts) => {
                assert.deepStrictEqual(reqOpts.qs, options);
                done();
            };
            iam.getPolicy(options, assert.ifError);
        });
        mocha_1.it('should map requestedPolicyVersion option to optionsRequestedPolicyVersion', done => {
            const VERSION = 3;
            const options = {
                requestedPolicyVersion: VERSION,
            };
            iam.request_ = (reqOpts) => {
                assert.deepStrictEqual(reqOpts.qs, {
                    optionsRequestedPolicyVersion: VERSION,
                });
                done();
            };
            iam.getPolicy(options, assert.ifError);
        });
    });
    mocha_1.describe('setPolicy', () => {
        mocha_1.it('should throw an error if a policy is not supplied', () => {
            assert.throws(() => {
                iam.setPolicy(common_1.util.noop);
            }, /A policy object is required\./);
        });
        mocha_1.it('should make the correct API request', done => {
            const policy = {
                a: 'b',
            };
            iam.request_ = (reqOpts, callback) => {
                assert.deepStrictEqual(reqOpts, {
                    method: 'PUT',
                    uri: '/iam',
                    json: Object.assign({
                        resourceId: iam.resourceId_,
                    }, policy),
                    qs: {},
                });
                callback(); // done()
            };
            iam.setPolicy(policy, done);
        });
        mocha_1.it('should accept an options object', done => {
            const policy = {
                a: 'b',
            };
            const options = {
                userProject: 'grape-spaceship-123',
            };
            iam.request_ = (reqOpts) => {
                assert.strictEqual(reqOpts.qs, options);
                done();
            };
            iam.setPolicy(policy, options, assert.ifError);
        });
    });
    mocha_1.describe('testPermissions', () => {
        mocha_1.it('should throw an error if permissions are missing', () => {
            assert.throws(() => {
                iam.testPermissions(common_1.util.noop);
            }, /Permissions are required\./);
        });
        mocha_1.it('should make the correct API request', done => {
            const permissions = 'storage.bucket.list';
            iam.request_ = (reqOpts) => {
                assert.deepStrictEqual(reqOpts, {
                    uri: '/iam/testPermissions',
                    qs: {
                        permissions: [permissions],
                    },
                    useQuerystring: true,
                });
                done();
            };
            iam.testPermissions(permissions, assert.ifError);
        });
        mocha_1.it('should send an error back if the request fails', done => {
            const permissions = ['storage.bucket.list'];
            const error = new Error('Error.');
            const apiResponse = {};
            iam.request_ = (reqOpts, callback) => {
                callback(error, apiResponse);
            };
            iam.testPermissions(permissions, (err, permissions, apiResp) => {
                assert.strictEqual(err, error);
                assert.strictEqual(permissions, null);
                assert.strictEqual(apiResp, apiResponse);
                done();
            });
        });
        mocha_1.it('should pass back a hash of permissions the user has', done => {
            const permissions = ['storage.bucket.list', 'storage.bucket.consume'];
            const apiResponse = {
                permissions: ['storage.bucket.consume'],
            };
            iam.request_ = (reqOpts, callback) => {
                callback(null, apiResponse);
            };
            iam.testPermissions(permissions, (err, permissions, apiResp) => {
                assert.ifError(err);
                assert.deepStrictEqual(permissions, {
                    'storage.bucket.list': false,
                    'storage.bucket.consume': true,
                });
                assert.strictEqual(apiResp, apiResponse);
                done();
            });
        });
        mocha_1.it('should accept an options object', done => {
            const permissions = ['storage.bucket.list'];
            const options = {
                userProject: 'grape-spaceship-123',
            };
            const expectedQuery = Object.assign({
                permissions,
            }, options);
            iam.request_ = (reqOpts) => {
                assert.deepStrictEqual(reqOpts.qs, expectedQuery);
                done();
            };
            iam.testPermissions(permissions, options, assert.ifError);
        });
    });
});
//# sourceMappingURL=iam.js.map