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
class FakeServiceObject extends common_1.ServiceObject {
    constructor(config) {
        super(config);
        // eslint-disable-next-line prefer-rest-params
        this.calledWith_ = arguments;
    }
}
mocha_1.describe('Notification', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Notification;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let notification;
    let promisified = false;
    const fakeUtil = Object.assign({}, common_1.util);
    const fakePromisify = {
        // tslint:disable-next-line:variable-name
        promisifyAll(Class) {
            if (Class.name === 'Notification') {
                promisified = true;
            }
        },
    };
    const BUCKET = {
        createNotification: fakeUtil.noop,
    };
    const ID = '123';
    mocha_1.before(() => {
        Notification = proxyquire('../src/notification.js', {
            '@google-cloud/promisify': fakePromisify,
            '@google-cloud/common': {
                ServiceObject: FakeServiceObject,
                util: fakeUtil,
            },
        }).Notification;
    });
    mocha_1.beforeEach(() => {
        BUCKET.createNotification = fakeUtil.noop = () => { };
        notification = new Notification(BUCKET, ID);
    });
    mocha_1.describe('instantiation', () => {
        mocha_1.it('should promisify all the things', () => {
            assert(promisified);
        });
        mocha_1.it('should inherit from ServiceObject', () => {
            assert(notification instanceof FakeServiceObject);
            const calledWith = notification.calledWith_[0];
            assert.strictEqual(calledWith.parent, BUCKET);
            assert.strictEqual(calledWith.baseUrl, '/notificationConfigs');
            assert.strictEqual(calledWith.id, ID);
            assert.deepStrictEqual(calledWith.methods, {
                create: true,
                exists: true,
            });
        });
        mocha_1.it('should use Bucket#createNotification for the createMethod', () => {
            const bound = () => { };
            Object.assign(BUCKET.createNotification, {
                bind(context) {
                    assert.strictEqual(context, BUCKET);
                    return bound;
                },
            });
            const notification = new Notification(BUCKET, ID);
            const calledWith = notification.calledWith_[0];
            assert.strictEqual(calledWith.createMethod, bound);
        });
        mocha_1.it('should convert number IDs to strings', () => {
            const notification = new Notification(BUCKET, 1);
            const calledWith = notification.calledWith_[0];
            assert.strictEqual(calledWith.id, '1');
        });
    });
    mocha_1.describe('delete', () => {
        mocha_1.it('should make the correct request', done => {
            const options = {};
            notification.request = (reqOpts, callback) => {
                assert.strictEqual(reqOpts.method, 'DELETE');
                assert.strictEqual(reqOpts.uri, '');
                assert.strictEqual(reqOpts.qs, options);
                callback(); // the done fn
            };
            notification.delete(options, done);
        });
        mocha_1.it('should optionally accept options', done => {
            notification.request = (reqOpts, callback) => {
                assert.deepStrictEqual(reqOpts.qs, {});
                callback(); // the done fn
            };
            notification.delete(done);
        });
        mocha_1.it('should optionally accept a callback', done => {
            fakeUtil.noop = done;
            notification.request = (reqOpts, callback) => {
                callback(); // the done fn
            };
            notification.delete();
        });
    });
    mocha_1.describe('get', () => {
        mocha_1.it('should get the metadata', done => {
            notification.getMetadata = () => {
                done();
            };
            notification.get(assert.ifError);
        });
        mocha_1.it('should accept an options object', done => {
            const options = {};
            notification.getMetadata = (options_) => {
                assert.strictEqual(options_, options);
                done();
            };
            notification.get(options, assert.ifError);
        });
        mocha_1.it('should execute callback with error & metadata', done => {
            const error = new Error('Error.');
            const metadata = {};
            notification.getMetadata = (options, callback) => {
                callback(error, metadata);
            };
            notification.get((err, instance, metadata_) => {
                assert.strictEqual(err, error);
                assert.strictEqual(instance, null);
                assert.strictEqual(metadata_, metadata);
                done();
            });
        });
        mocha_1.it('should execute callback with instance & metadata', done => {
            const metadata = {};
            notification.getMetadata = (options, callback) => {
                callback(null, metadata);
            };
            notification.get((err, instance, metadata_) => {
                assert.ifError(err);
                assert.strictEqual(instance, notification);
                assert.strictEqual(metadata_, metadata);
                done();
            });
        });
        mocha_1.describe('autoCreate', () => {
            let AUTO_CREATE_CONFIG;
            const ERROR = { code: 404 };
            const METADATA = {};
            mocha_1.beforeEach(() => {
                AUTO_CREATE_CONFIG = {
                    autoCreate: true,
                };
                notification.getMetadata = (options, callback) => {
                    callback(ERROR, METADATA);
                };
            });
            mocha_1.it('should pass config to create if it was provided', done => {
                const config = Object.assign({}, AUTO_CREATE_CONFIG, {
                    maxResults: 5,
                });
                notification.create = (config_) => {
                    assert.strictEqual(config_, config);
                    done();
                };
                notification.get(config, assert.ifError);
            });
            mocha_1.it('should pass only a callback to create if no config', done => {
                notification.create = (callback) => {
                    callback(); // done()
                };
                notification.get(AUTO_CREATE_CONFIG, done);
            });
            mocha_1.describe('error', () => {
                mocha_1.it('should execute callback with error & API response', done => {
                    const error = new Error('Error.');
                    const apiResponse = {};
                    notification.create = (callback) => {
                        notification.get = (config, callback) => {
                            assert.deepStrictEqual(config, {});
                            callback(); // done()
                        };
                        callback(error, null, apiResponse);
                    };
                    notification.get(AUTO_CREATE_CONFIG, (err, instance, resp) => {
                        assert.strictEqual(err, error);
                        assert.strictEqual(instance, null);
                        assert.strictEqual(resp, apiResponse);
                        done();
                    });
                });
                mocha_1.it('should refresh the metadata after a 409', done => {
                    const error = {
                        code: 409,
                    };
                    notification.create = (callback) => {
                        notification.get = (config, callback) => {
                            assert.deepStrictEqual(config, {});
                            callback(); // done()
                        };
                        callback(error);
                    };
                    notification.get(AUTO_CREATE_CONFIG, done);
                });
            });
        });
    });
    mocha_1.describe('getMetadata', () => {
        mocha_1.it('should make the correct request', done => {
            const options = {};
            notification.request = (reqOpts) => {
                assert.strictEqual(reqOpts.uri, '');
                assert.strictEqual(reqOpts.qs, options);
                done();
            };
            notification.getMetadata(options, assert.ifError);
        });
        mocha_1.it('should optionally accept options', done => {
            notification.request = (reqOpts) => {
                assert.deepStrictEqual(reqOpts.qs, {});
                done();
            };
            notification.getMetadata(assert.ifError);
        });
        mocha_1.it('should return any errors to the callback', done => {
            const error = new Error('err');
            const response = {};
            notification.request = (reqOpts, callback) => {
                callback(error, response);
            };
            notification.getMetadata((err, metadata, resp) => {
                assert.strictEqual(err, error);
                assert.strictEqual(metadata, null);
                assert.strictEqual(resp, response);
                done();
            });
        });
        mocha_1.it('should set and return the metadata', done => {
            const response = {};
            notification.request = (reqOpts, callback) => {
                callback(null, response);
            };
            notification.getMetadata((err, metadata, resp) => {
                assert.ifError(err);
                assert.strictEqual(metadata, response);
                assert.strictEqual(notification.metadata, response);
                assert.strictEqual(resp, response);
                done();
            });
        });
    });
});
//# sourceMappingURL=notification.js.map