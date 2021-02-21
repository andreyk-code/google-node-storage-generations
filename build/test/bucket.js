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
const arrify = require("arrify");
const assert = require("assert");
const extend = require("extend");
const fs = require("fs");
const mocha_1 = require("mocha");
const mime = require("mime-types");
const pLimit = require("p-limit");
const path = require("path");
const proxyquire = require("proxyquire");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const snakeize = require('snakeize');
const stream = require("stream");
const sinon = require("sinon");
class FakeFile {
    constructor(bucket, name, options) {
        this.isSameFile = () => false;
        // eslint-disable-next-line prefer-rest-params
        this.calledWith_ = arguments;
        this.bucket = bucket;
        this.name = name;
        this.options = options || {};
        this.metadata = {};
        this.createWriteStream = (options) => {
            this.metadata = options.metadata;
            const ws = new stream.Writable();
            ws.write = () => {
                ws.emit('complete');
                ws.end();
                return true;
            };
            return ws;
        };
    }
}
class FakeNotification {
    constructor(bucket, id) {
        this.bucket = bucket;
        this.id = id;
    }
}
let fsStatOverride;
const fakeFs = extend(true, {}, fs, {
    stat: (filePath, callback) => {
        return (fsStatOverride || fs.stat)(filePath, callback);
    },
});
let pLimitOverride;
const fakePLimit = (limit) => (pLimitOverride || pLimit)(limit);
let promisified = false;
const fakePromisify = {
    // tslint:disable-next-line:variable-name
    promisifyAll(Class, options) {
        if (Class.name !== 'Bucket') {
            return;
        }
        promisified = true;
        assert.deepStrictEqual(options.exclude, [
            'request',
            'file',
            'notification',
        ]);
    },
};
const fakeUtil = Object.assign({}, common_1.util);
fakeUtil.noop = common_1.util.noop;
let extended = false;
const fakePaginator = {
    paginator: {
        // tslint:disable-next-line:variable-name
        extend(Class, methods) {
            if (Class.name !== 'Bucket') {
                return;
            }
            methods = arrify(methods);
            assert.strictEqual(Class.name, 'Bucket');
            assert.deepStrictEqual(methods, ['getFiles']);
            extended = true;
        },
        streamify(methodName) {
            return methodName;
        },
    },
};
class FakeAcl {
    constructor(...args) {
        this.calledWith_ = args;
    }
}
class FakeIam {
    constructor(...args) {
        this.calledWith_ = args;
    }
}
class FakeServiceObject extends common_1.ServiceObject {
    constructor(config) {
        super(config);
        // eslint-disable-next-line prefer-rest-params
        this.calledWith_ = arguments;
    }
}
const fakeSigner = {
    URLSigner: () => { },
};
mocha_1.describe('Bucket', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Bucket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bucket;
    const STORAGE = {
        createBucket: common_1.util.noop,
    };
    const BUCKET_NAME = 'test-bucket';
    mocha_1.before(() => {
        Bucket = proxyquire('../src/bucket.js', {
            fs: fakeFs,
            'p-limit': fakePLimit,
            '@google-cloud/promisify': fakePromisify,
            '@google-cloud/paginator': fakePaginator,
            '@google-cloud/common': {
                ServiceObject: FakeServiceObject,
                util: fakeUtil,
            },
            './acl.js': { Acl: FakeAcl },
            './file.js': { File: FakeFile },
            './iam.js': { Iam: FakeIam },
            './notification.js': { Notification: FakeNotification },
            './signer.js': fakeSigner,
        }).Bucket;
    });
    mocha_1.beforeEach(() => {
        fsStatOverride = null;
        pLimitOverride = null;
        bucket = new Bucket(STORAGE, BUCKET_NAME);
    });
    mocha_1.describe('instantiation', () => {
        mocha_1.it('should extend the correct methods', () => {
            assert(extended); // See `fakePaginator.extend`
        });
        mocha_1.it('should streamify the correct methods', () => {
            assert.strictEqual(bucket.getFilesStream, 'getFiles');
        });
        mocha_1.it('should promisify all the things', () => {
            assert(promisified);
        });
        mocha_1.it('should remove a leading gs://', () => {
            const bucket = new Bucket(STORAGE, 'gs://bucket-name');
            assert.strictEqual(bucket.name, 'bucket-name');
        });
        mocha_1.it('should remove a trailing /', () => {
            const bucket = new Bucket(STORAGE, 'bucket-name/');
            assert.strictEqual(bucket.name, 'bucket-name');
        });
        mocha_1.it('should localize the name', () => {
            assert.strictEqual(bucket.name, BUCKET_NAME);
        });
        mocha_1.it('should localize the storage instance', () => {
            assert.strictEqual(bucket.storage, STORAGE);
        });
        mocha_1.describe('ACL objects', () => {
            let _request;
            mocha_1.before(() => {
                _request = Bucket.prototype.request;
            });
            mocha_1.beforeEach(() => {
                Bucket.prototype.request = {
                    bind(ctx) {
                        return ctx;
                    },
                };
                bucket = new Bucket(STORAGE, BUCKET_NAME);
            });
            mocha_1.after(() => {
                Bucket.prototype.request = _request;
            });
            mocha_1.it('should create an ACL object', () => {
                assert.deepStrictEqual(bucket.acl.calledWith_[0], {
                    request: bucket,
                    pathPrefix: '/acl',
                });
            });
            mocha_1.it('should create a default ACL object', () => {
                assert.deepStrictEqual(bucket.acl.default.calledWith_[0], {
                    request: bucket,
                    pathPrefix: '/defaultObjectAcl',
                });
            });
        });
        mocha_1.it('should inherit from ServiceObject', done => {
            const storageInstance = Object.assign({}, STORAGE, {
                createBucket: {
                    bind(context) {
                        assert.strictEqual(context, storageInstance);
                        done();
                    },
                },
            });
            const bucket = new Bucket(storageInstance, BUCKET_NAME);
            // Using assert.strictEqual instead of assert to prevent
            // coercing of types.
            assert.strictEqual(bucket instanceof common_1.ServiceObject, true);
            const calledWith = bucket.calledWith_[0];
            assert.strictEqual(calledWith.parent, storageInstance);
            assert.strictEqual(calledWith.baseUrl, '/b');
            assert.strictEqual(calledWith.id, BUCKET_NAME);
            assert.deepStrictEqual(calledWith.methods, {
                create: { reqOpts: { qs: {} } },
                delete: { reqOpts: { qs: {} } },
                exists: { reqOpts: { qs: {} } },
                get: { reqOpts: { qs: {} } },
                getMetadata: { reqOpts: { qs: {} } },
                setMetadata: { reqOpts: { qs: {} } },
            });
        });
        mocha_1.it('should set the correct query string with a userProject', () => {
            const options = { userProject: 'user-project' };
            const bucket = new Bucket(STORAGE, BUCKET_NAME, options);
            const calledWith = bucket.calledWith_[0];
            assert.deepStrictEqual(calledWith.methods, {
                create: { reqOpts: { qs: options } },
                delete: { reqOpts: { qs: options } },
                exists: { reqOpts: { qs: options } },
                get: { reqOpts: { qs: options } },
                getMetadata: { reqOpts: { qs: options } },
                setMetadata: { reqOpts: { qs: options } },
            });
        });
        mocha_1.it('should localize an Iam instance', () => {
            assert(bucket.iam instanceof FakeIam);
            assert.deepStrictEqual(bucket.iam.calledWith_[0], bucket);
        });
        mocha_1.it('should localize userProject if provided', () => {
            const fakeUserProject = 'grape-spaceship-123';
            const bucket = new Bucket(STORAGE, BUCKET_NAME, {
                userProject: fakeUserProject,
            });
            assert.strictEqual(bucket.userProject, fakeUserProject);
        });
    });
    mocha_1.describe('addLifecycleRule', () => {
        mocha_1.beforeEach(() => {
            bucket.getMetadata = (callback) => {
                callback(null, {}, {});
            };
        });
        mocha_1.it('should accept raw input', done => {
            const rule = {
                action: {
                    type: 'type',
                },
                condition: {},
            };
            bucket.setMetadata = (metadata) => {
                assert.deepStrictEqual(metadata.lifecycle.rule, [rule]);
                done();
            };
            bucket.addLifecycleRule(rule, assert.ifError);
        });
        mocha_1.it('should properly capitalize rule action', done => {
            const rule = {
                action: 'delete',
                condition: {},
            };
            bucket.setMetadata = (metadata) => {
                assert.deepStrictEqual(metadata.lifecycle.rule, [
                    {
                        action: {
                            type: rule.action.charAt(0).toUpperCase() + rule.action.slice(1),
                        },
                        condition: rule.condition,
                    },
                ]);
                done();
            };
            bucket.addLifecycleRule(rule, assert.ifError);
        });
        mocha_1.it('should properly set the storage class', done => {
            const rule = {
                action: 'setStorageClass',
                storageClass: 'storage class',
                condition: {},
            };
            bucket.setMetadata = (metadata) => {
                assert.deepStrictEqual(metadata.lifecycle.rule, [
                    {
                        action: {
                            type: rule.action.charAt(0).toUpperCase() + rule.action.slice(1),
                            storageClass: rule.storageClass,
                        },
                        condition: rule.condition,
                    },
                ]);
                done();
            };
            bucket.addLifecycleRule(rule, assert.ifError);
        });
        mocha_1.it('should properly set condition', done => {
            const rule = {
                action: 'delete',
                condition: {
                    age: 30,
                },
            };
            bucket.setMetadata = (metadata) => {
                assert.deepStrictEqual(metadata.lifecycle.rule, [
                    {
                        action: {
                            type: rule.action.charAt(0).toUpperCase() + rule.action.slice(1),
                        },
                        condition: rule.condition,
                    },
                ]);
                done();
            };
            bucket.addLifecycleRule(rule, assert.ifError);
        });
        mocha_1.it('should convert Date object to date string for condition', done => {
            const date = new Date();
            const rule = {
                action: 'delete',
                condition: {
                    createdBefore: date,
                },
            };
            bucket.setMetadata = (metadata) => {
                const expectedDateString = date.toISOString().replace(/T.+$/, '');
                const rule = metadata.lifecycle.rule[0];
                assert.strictEqual(rule.condition.createdBefore, expectedDateString);
                done();
            };
            bucket.addLifecycleRule(rule, assert.ifError);
        });
        mocha_1.it('should optionally overwrite existing rules', done => {
            const rule = {
                action: {
                    type: 'type',
                },
                condition: {},
            };
            const options = {
                append: false,
            };
            bucket.getMetadata = () => {
                done(new Error('Metadata should not be refreshed.'));
            };
            bucket.setMetadata = (metadata) => {
                assert.strictEqual(metadata.lifecycle.rule.length, 1);
                assert.deepStrictEqual(metadata.lifecycle.rule, [rule]);
                done();
            };
            bucket.addLifecycleRule(rule, options, assert.ifError);
        });
        mocha_1.it('should combine rule with existing rules by default', done => {
            const existingRule = {
                action: {
                    type: 'type',
                },
                condition: {},
            };
            const newRule = {
                action: {
                    type: 'type',
                },
                condition: {},
            };
            bucket.getMetadata = (callback) => {
                callback(null, { lifecycle: { rule: [existingRule] } }, {});
            };
            bucket.setMetadata = (metadata) => {
                assert.strictEqual(metadata.lifecycle.rule.length, 2);
                assert.deepStrictEqual(metadata.lifecycle.rule, [
                    existingRule,
                    newRule,
                ]);
                done();
            };
            bucket.addLifecycleRule(newRule, assert.ifError);
        });
        mocha_1.it('should pass callback to setMetadata', done => {
            const rule = {
                action: {
                    type: 'type',
                },
                condition: {},
            };
            bucket.setMetadata = (metadata, callback) => {
                callback(); // done()
            };
            bucket.addLifecycleRule(rule, done);
        });
        mocha_1.it('should pass error from getMetadata to callback', done => {
            const error = new Error('from getMetadata');
            const rule = {
                action: 'delete',
                condition: {},
            };
            bucket.getMetadata = (callback) => {
                callback(error);
            };
            bucket.setMetadata = () => {
                done(new Error('Metadata should not be set.'));
            };
            bucket.addLifecycleRule(rule, (err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
    });
    mocha_1.describe('combine', () => {
        mocha_1.it('should throw if invalid sources are provided', () => {
            assert.throws(() => {
                bucket.combine();
            }, /You must provide at least one source file\./);
            assert.throws(() => {
                bucket.combine([]);
            }, /You must provide at least one source file\./);
        });
        mocha_1.it('should throw if a destination is not provided', () => {
            assert.throws(() => {
                bucket.combine(['1', '2']);
            }, /A destination file must be specified\./);
        });
        mocha_1.it('should accept string or file input for sources', done => {
            const file1 = bucket.file('1.txt');
            const file2 = '2.txt';
            const destinationFileName = 'destination.txt';
            const originalFileMethod = bucket.file;
            bucket.file = (name) => {
                const file = originalFileMethod(name);
                if (name === '2.txt') {
                    return file;
                }
                assert.strictEqual(name, destinationFileName);
                file.request = (reqOpts) => {
                    assert.strictEqual(reqOpts.method, 'POST');
                    assert.strictEqual(reqOpts.uri, '/compose');
                    assert.strictEqual(reqOpts.json.sourceObjects[0].name, file1.name);
                    assert.strictEqual(reqOpts.json.sourceObjects[1].name, file2);
                    done();
                };
                return file;
            };
            bucket.combine([file1, file2], destinationFileName);
        });
        mocha_1.it('should use content type from the destination metadata', done => {
            const destination = bucket.file('destination.txt');
            destination.request = (reqOpts) => {
                assert.strictEqual(reqOpts.json.destination.contentType, mime.contentType(destination.name));
                done();
            };
            bucket.combine(['1', '2'], destination);
        });
        mocha_1.it('should use content type from the destination metadata', done => {
            const destination = bucket.file('destination.txt');
            destination.metadata = { contentType: 'content-type' };
            destination.request = (reqOpts) => {
                assert.strictEqual(reqOpts.json.destination.contentType, destination.metadata.contentType);
                done();
            };
            bucket.combine(['1', '2'], destination);
        });
        mocha_1.it('should detect dest content type if not in metadata', done => {
            const destination = bucket.file('destination.txt');
            destination.request = (reqOpts) => {
                assert.strictEqual(reqOpts.json.destination.contentType, mime.contentType(destination.name));
                done();
            };
            bucket.combine(['1', '2'], destination);
        });
        mocha_1.it('should make correct API request', done => {
            const sources = [bucket.file('1.txt'), bucket.file('2.txt')];
            const destination = bucket.file('destination.txt');
            destination.request = (reqOpts) => {
                assert.strictEqual(reqOpts.uri, '/compose');
                assert.deepStrictEqual(reqOpts.json, {
                    destination: { contentType: mime.contentType(destination.name) },
                    sourceObjects: [{ name: sources[0].name }, { name: sources[1].name }],
                });
                done();
            };
            bucket.combine(sources, destination);
        });
        mocha_1.it('should encode the destination file name', done => {
            const sources = [bucket.file('1.txt'), bucket.file('2.txt')];
            const destination = bucket.file('needs encoding.jpg');
            destination.request = (reqOpts) => {
                assert.strictEqual(reqOpts.uri.indexOf(destination), -1);
                done();
            };
            bucket.combine(sources, destination);
        });
        mocha_1.it('should send a source generation value if available', done => {
            const sources = [bucket.file('1.txt'), bucket.file('2.txt')];
            sources[0].metadata = { generation: 1 };
            sources[1].metadata = { generation: 2 };
            const destination = bucket.file('destination.txt');
            destination.request = (reqOpts) => {
                assert.deepStrictEqual(reqOpts.json.sourceObjects, [
                    { name: sources[0].name, generation: sources[0].metadata.generation },
                    { name: sources[1].name, generation: sources[1].metadata.generation },
                ]);
                done();
            };
            bucket.combine(sources, destination);
        });
        mocha_1.it('should accept userProject option', done => {
            const options = {
                userProject: 'user-project-id',
            };
            const sources = [bucket.file('1.txt'), bucket.file('2.txt')];
            const destination = bucket.file('destination.txt');
            destination.request = (reqOpts) => {
                assert.strictEqual(reqOpts.qs, options);
                done();
            };
            bucket.combine(sources, destination, options, assert.ifError);
        });
        mocha_1.it('should execute the callback', done => {
            const sources = [bucket.file('1.txt'), bucket.file('2.txt')];
            const destination = bucket.file('destination.txt');
            destination.request = (reqOpts, callback) => {
                callback();
            };
            bucket.combine(sources, destination, done);
        });
        mocha_1.it('should execute the callback with an error', done => {
            const sources = [bucket.file('1.txt'), bucket.file('2.txt')];
            const destination = bucket.file('destination.txt');
            const error = new Error('Error.');
            destination.request = (reqOpts, callback) => {
                callback(error);
            };
            bucket.combine(sources, destination, (err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
        mocha_1.it('should execute the callback with apiResponse', done => {
            const sources = [bucket.file('1.txt'), bucket.file('2.txt')];
            const destination = bucket.file('destination.txt');
            const resp = { success: true };
            destination.request = (reqOpts, callback) => {
                callback(null, resp);
            };
            bucket.combine(sources, destination, (err, obj, apiResponse) => {
                assert.strictEqual(resp, apiResponse);
                done();
            });
        });
    });
    mocha_1.describe('createChannel', () => {
        const ID = 'id';
        const CONFIG = {
            address: 'https://...',
        };
        mocha_1.it('should throw if an ID is not provided', () => {
            assert.throws(() => {
                bucket.createChannel();
            }, /An ID is required to create a channel\./);
        });
        mocha_1.it('should throw if an address is not provided', () => {
            assert.throws(() => {
                bucket.createChannel(ID, {});
            }, /An address is required to create a channel\./);
        });
        mocha_1.it('should make the correct request', done => {
            const config = Object.assign({}, CONFIG, {
                a: 'b',
                c: 'd',
            });
            const originalConfig = Object.assign({}, config);
            bucket.request = (reqOpts) => {
                assert.strictEqual(reqOpts.method, 'POST');
                assert.strictEqual(reqOpts.uri, '/o/watch');
                const expectedJson = Object.assign({}, config, {
                    id: ID,
                    type: 'web_hook',
                });
                assert.deepStrictEqual(reqOpts.json, expectedJson);
                assert.deepStrictEqual(config, originalConfig);
                done();
            };
            bucket.createChannel(ID, config, assert.ifError);
        });
        mocha_1.it('should accept userProject option', done => {
            const options = {
                userProject: 'user-project-id',
            };
            bucket.request = (reqOpts) => {
                assert.strictEqual(reqOpts.qs, options);
                done();
            };
            bucket.createChannel(ID, CONFIG, options, assert.ifError);
        });
        mocha_1.describe('error', () => {
            const error = new Error('Error.');
            const apiResponse = {};
            mocha_1.beforeEach(() => {
                bucket.request = (reqOpts, callback) => {
                    callback(error, apiResponse);
                };
            });
            mocha_1.it('should execute callback with error & API response', done => {
                bucket.createChannel(ID, CONFIG, (err, channel, apiResponse_) => {
                    assert.strictEqual(err, error);
                    assert.strictEqual(channel, null);
                    assert.strictEqual(apiResponse_, apiResponse);
                    done();
                });
            });
        });
        mocha_1.describe('success', () => {
            const apiResponse = {
                resourceId: 'resource-id',
            };
            mocha_1.beforeEach(() => {
                bucket.request = (reqOpts, callback) => {
                    callback(null, apiResponse);
                };
            });
            mocha_1.it('should exec a callback with Channel & API response', done => {
                const channel = {};
                bucket.storage.channel = (id, resourceId) => {
                    assert.strictEqual(id, ID);
                    assert.strictEqual(resourceId, apiResponse.resourceId);
                    return channel;
                };
                bucket.createChannel(ID, CONFIG, (err, channel_, apiResponse_) => {
                    assert.ifError(err);
                    assert.strictEqual(channel_, channel);
                    assert.strictEqual(channel_.metadata, apiResponse);
                    assert.strictEqual(apiResponse_, apiResponse);
                    done();
                });
            });
        });
    });
    mocha_1.describe('createNotification', () => {
        const PUBSUB_SERVICE_PATH = '//pubsub.googleapis.com/';
        const TOPIC = 'my-topic';
        const FULL_TOPIC_NAME = PUBSUB_SERVICE_PATH + 'projects/{{projectId}}/topics/' + TOPIC;
        class FakeTopic {
            constructor(name) {
                this.name = 'projects/grape-spaceship-123/topics/' + name;
            }
        }
        mocha_1.beforeEach(() => {
            fakeUtil.isCustomType = common_1.util.isCustomType;
        });
        mocha_1.it('should throw an error if a valid topic is not provided', () => {
            assert.throws(() => {
                bucket.createNotification();
            }, /A valid topic name is required\./);
        });
        mocha_1.it('should make the correct request', done => {
            const topic = 'projects/my-project/topics/my-topic';
            const options = { payloadFormat: 'NONE' };
            const expectedTopic = PUBSUB_SERVICE_PATH + topic;
            const expectedJson = Object.assign({ topic: expectedTopic }, snakeize(options));
            bucket.request = (reqOpts) => {
                assert.strictEqual(reqOpts.method, 'POST');
                assert.strictEqual(reqOpts.uri, '/notificationConfigs');
                assert.deepStrictEqual(reqOpts.json, expectedJson);
                assert.notStrictEqual(reqOpts.json, options);
                done();
            };
            bucket.createNotification(topic, options, assert.ifError);
        });
        mocha_1.it('should accept incomplete topic names', done => {
            bucket.request = (reqOpts) => {
                assert.strictEqual(reqOpts.json.topic, FULL_TOPIC_NAME);
                done();
            };
            bucket.createNotification(TOPIC, {}, assert.ifError);
        });
        mocha_1.it('should accept a topic object', done => {
            const fakeTopic = new FakeTopic('my-topic');
            const expectedTopicName = PUBSUB_SERVICE_PATH + fakeTopic.name;
            fakeUtil.isCustomType = (topic, type) => {
                assert.strictEqual(topic, fakeTopic);
                assert.strictEqual(type, 'pubsub/topic');
                return true;
            };
            bucket.request = (reqOpts) => {
                assert.strictEqual(reqOpts.json.topic, expectedTopicName);
                done();
            };
            bucket.createNotification(fakeTopic, {}, assert.ifError);
        });
        mocha_1.it('should set a default payload format', done => {
            bucket.request = (reqOpts) => {
                assert.strictEqual(reqOpts.json.payload_format, 'JSON_API_V1');
                done();
            };
            bucket.createNotification(TOPIC, {}, assert.ifError);
        });
        mocha_1.it('should optionally accept options', done => {
            const expectedJson = {
                topic: FULL_TOPIC_NAME,
                payload_format: 'JSON_API_V1',
            };
            bucket.request = (reqOpts) => {
                assert.deepStrictEqual(reqOpts.json, expectedJson);
                done();
            };
            bucket.createNotification(TOPIC, assert.ifError);
        });
        mocha_1.it('should accept a userProject', done => {
            const options = {
                userProject: 'grape-spaceship-123',
            };
            bucket.request = (reqOpts) => {
                assert.strictEqual(reqOpts.qs.userProject, options.userProject);
                done();
            };
            bucket.createNotification(TOPIC, options, assert.ifError);
        });
        mocha_1.it('should return errors to the callback', done => {
            const error = new Error('err');
            const response = {};
            bucket.request = (reqOpts, callback) => {
                callback(error, response);
            };
            bucket.createNotification(TOPIC, (err, notification, resp) => {
                assert.strictEqual(err, error);
                assert.strictEqual(notification, null);
                assert.strictEqual(resp, response);
                done();
            });
        });
        mocha_1.it('should return a notification object', done => {
            const fakeId = '123';
            const response = { id: fakeId };
            const fakeNotification = {};
            bucket.request = (reqOpts, callback) => {
                callback(null, response);
            };
            bucket.notification = (id) => {
                assert.strictEqual(id, fakeId);
                return fakeNotification;
            };
            bucket.createNotification(TOPIC, (err, notification, resp) => {
                assert.ifError(err);
                assert.strictEqual(notification, fakeNotification);
                assert.strictEqual(notification.metadata, response);
                assert.strictEqual(resp, response);
                done();
            });
        });
    });
    mocha_1.describe('deleteFiles', () => {
        mocha_1.it('should accept only a callback', done => {
            bucket.getFiles = (query) => {
                assert.deepStrictEqual(query, {});
                return Promise.all([[]]);
            };
            bucket.deleteFiles(done);
        });
        mocha_1.it('should get files from the bucket', done => {
            const query = { a: 'b', c: 'd' };
            bucket.getFiles = (query_) => {
                assert.deepStrictEqual(query_, query);
                return Promise.resolve([[]]);
            };
            bucket.deleteFiles(query, done);
        });
        mocha_1.it('should process 10 files at a time', done => {
            pLimitOverride = (limit) => {
                assert.strictEqual(limit, 10);
                setImmediate(done);
                return () => { };
            };
            bucket.getFiles = () => Promise.resolve([[]]);
            bucket.deleteFiles({}, assert.ifError);
        });
        mocha_1.it('should delete the files', done => {
            const query = {};
            let timesCalled = 0;
            const files = [bucket.file('1'), bucket.file('2')].map(file => {
                file.delete = (query_) => {
                    timesCalled++;
                    assert.strictEqual(query_, query);
                    return Promise.resolve();
                };
                return file;
            });
            bucket.getFiles = (query_) => {
                assert.strictEqual(query_, query);
                return Promise.resolve([files]);
            };
            bucket.deleteFiles(query, (err) => {
                assert.ifError(err);
                assert.strictEqual(timesCalled, files.length);
                done();
            });
        });
        mocha_1.it('should execute callback with error from getting files', done => {
            const error = new Error('Error.');
            bucket.getFiles = () => {
                return Promise.reject(error);
            };
            bucket.deleteFiles({}, (err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
        mocha_1.it('should execute callback with error from deleting file', done => {
            const error = new Error('Error.');
            const files = [bucket.file('1'), bucket.file('2')].map(file => {
                file.delete = () => Promise.reject(error);
                return file;
            });
            bucket.getFiles = () => {
                return Promise.resolve([files]);
            };
            bucket.deleteFiles({}, (err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
        mocha_1.it('should execute callback with queued errors', done => {
            const error = new Error('Error.');
            const files = [bucket.file('1'), bucket.file('2')].map(file => {
                file.delete = () => Promise.reject(error);
                return file;
            });
            bucket.getFiles = () => {
                return Promise.resolve([files]);
            };
            bucket.deleteFiles({ force: true }, (errs) => {
                assert.strictEqual(errs[0], error);
                assert.strictEqual(errs[1], error);
                done();
            });
        });
    });
    mocha_1.describe('deleteLabels', () => {
        mocha_1.describe('all labels', () => {
            mocha_1.it('should get all of the label names', done => {
                bucket.getLabels = () => {
                    done();
                };
                bucket.deleteLabels(assert.ifError);
            });
            mocha_1.it('should return an error from getLabels()', done => {
                const error = new Error('Error.');
                bucket.getLabels = (callback) => {
                    callback(error);
                };
                bucket.deleteLabels((err) => {
                    assert.strictEqual(err, error);
                    done();
                });
            });
            mocha_1.it('should call setLabels with all label names', done => {
                const labels = {
                    labelone: 'labelonevalue',
                    labeltwo: 'labeltwovalue',
                };
                bucket.getLabels = (callback) => {
                    callback(null, labels);
                };
                bucket.setLabels = (labels, callback) => {
                    assert.deepStrictEqual(labels, {
                        labelone: null,
                        labeltwo: null,
                    });
                    callback(); // done()
                };
                bucket.deleteLabels(done);
            });
        });
        mocha_1.describe('single label', () => {
            const LABEL = 'labelname';
            mocha_1.it('should call setLabels with a single label', done => {
                bucket.setLabels = (labels, callback) => {
                    assert.deepStrictEqual(labels, {
                        [LABEL]: null,
                    });
                    callback(); // done()
                };
                bucket.deleteLabels(LABEL, done);
            });
        });
        mocha_1.describe('multiple labels', () => {
            const LABELS = ['labelonename', 'labeltwoname'];
            mocha_1.it('should call setLabels with multiple labels', done => {
                bucket.setLabels = (labels, callback) => {
                    assert.deepStrictEqual(labels, {
                        labelonename: null,
                        labeltwoname: null,
                    });
                    callback(); // done()
                };
                bucket.deleteLabels(LABELS, done);
            });
        });
    });
    mocha_1.describe('disableRequesterPays', () => {
        mocha_1.it('should call setMetadata correctly', done => {
            bucket.setMetadata = (metadata, callback) => {
                assert.deepStrictEqual(metadata, {
                    billing: {
                        requesterPays: false,
                    },
                });
                callback(); // done()
            };
            bucket.disableRequesterPays(done);
        });
        mocha_1.it('should not require a callback', done => {
            bucket.setMetadata = (metadata, callback) => {
                assert.doesNotThrow(() => callback());
                done();
            };
            bucket.disableRequesterPays();
        });
    });
    mocha_1.describe('enableLogging', () => {
        const PREFIX = 'prefix';
        mocha_1.beforeEach(() => {
            bucket.iam = {
                getPolicy: () => Promise.resolve([{ bindings: [] }]),
                setPolicy: () => Promise.resolve(),
            };
            bucket.setMetadata = () => Promise.resolve([]);
        });
        mocha_1.it('should throw if a config object is not provided', () => {
            assert.throws(() => {
                bucket.enableLogging();
            }, /A configuration object with a prefix is required\./);
        });
        mocha_1.it('should throw if config is a function', () => {
            assert.throws(() => {
                bucket.enableLogging(assert.ifError);
            }, /A configuration object with a prefix is required\./);
        });
        mocha_1.it('should throw if a prefix is not provided', () => {
            assert.throws(() => {
                bucket.enableLogging({
                    bucket: 'bucket-name',
                }, assert.ifError);
            }, /A configuration object with a prefix is required\./);
        });
        mocha_1.it('should add IAM permissions', done => {
            const policy = {
                bindings: [{}],
            };
            bucket.iam = {
                getPolicy: () => Promise.resolve([policy]),
                setPolicy: (policy_) => {
                    assert.deepStrictEqual(policy, policy_);
                    assert.deepStrictEqual(policy_.bindings, [
                        policy.bindings[0],
                        {
                            members: ['group:cloud-storage-analytics@google.com'],
                            role: 'roles/storage.objectCreator',
                        },
                    ]);
                    setImmediate(done);
                    return Promise.resolve();
                },
            };
            bucket.enableLogging({ prefix: PREFIX }, assert.ifError);
        });
        mocha_1.it('should return an error from getting the IAM policy', done => {
            const error = new Error('Error.');
            bucket.iam.getPolicy = () => {
                throw error;
            };
            bucket.enableLogging({ prefix: PREFIX }, (err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
        mocha_1.it('should return an error from setting the IAM policy', done => {
            const error = new Error('Error.');
            bucket.iam.setPolicy = () => {
                throw error;
            };
            bucket.enableLogging({ prefix: PREFIX }, (err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
        mocha_1.it('should update the logging metadata configuration', done => {
            bucket.setMetadata = (metadata) => {
                assert.deepStrictEqual(metadata.logging, {
                    logBucket: bucket.id,
                    logObjectPrefix: PREFIX,
                });
                setImmediate(done);
                return Promise.resolve([]);
            };
            bucket.enableLogging({ prefix: PREFIX }, assert.ifError);
        });
        mocha_1.it('should allow a custom bucket to be provided', done => {
            const bucketName = 'bucket-name';
            bucket.setMetadata = (metadata) => {
                assert.deepStrictEqual(metadata.logging.logBucket, bucketName);
                setImmediate(done);
                return Promise.resolve([]);
            };
            bucket.enableLogging({
                prefix: PREFIX,
                bucket: bucketName,
            }, assert.ifError);
        });
        mocha_1.it('should accept a Bucket object', done => {
            const bucketForLogging = new Bucket(STORAGE, 'bucket-name');
            bucket.setMetadata = (metadata) => {
                assert.deepStrictEqual(metadata.logging.logBucket, bucketForLogging.id);
                setImmediate(done);
                return Promise.resolve([]);
            };
            bucket.enableLogging({
                prefix: PREFIX,
                bucket: bucketForLogging,
            }, assert.ifError);
        });
        mocha_1.it('should execute the callback with the setMetadata response', done => {
            const setMetadataResponse = {};
            bucket.setMetadata = () => Promise.resolve([setMetadataResponse]);
            bucket.enableLogging({ prefix: PREFIX }, (err, response) => {
                assert.ifError(err);
                assert.strictEqual(response, setMetadataResponse);
                done();
            });
        });
        mocha_1.it('should return an error from the setMetadata call failing', done => {
            const error = new Error('Error.');
            bucket.setMetadata = () => {
                throw error;
            };
            bucket.enableLogging({ prefix: PREFIX }, (err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
    });
    mocha_1.describe('enableRequesterPays', () => {
        mocha_1.it('should call setMetadata correctly', done => {
            bucket.setMetadata = (metadata, callback) => {
                assert.deepStrictEqual(metadata, {
                    billing: {
                        requesterPays: true,
                    },
                });
                callback(); // done()
            };
            bucket.enableRequesterPays(done);
        });
        mocha_1.it('should not require a callback', done => {
            bucket.setMetadata = (metadata, callback) => {
                assert.doesNotThrow(() => callback());
                done();
            };
            bucket.enableRequesterPays();
        });
    });
    mocha_1.describe('file', () => {
        const FILE_NAME = 'remote-file-name.jpg';
        let file;
        const options = { a: 'b', c: 'd' };
        mocha_1.beforeEach(() => {
            file = bucket.file(FILE_NAME, options);
        });
        mocha_1.it('should throw if no name is provided', () => {
            assert.throws(() => {
                bucket.file();
            }, /A file name must be specified\./);
        });
        mocha_1.it('should return a File object', () => {
            assert(file instanceof FakeFile);
        });
        mocha_1.it('should pass bucket to File object', () => {
            assert.deepStrictEqual(file.calledWith_[0], bucket);
        });
        mocha_1.it('should pass filename to File object', () => {
            assert.strictEqual(file.calledWith_[1], FILE_NAME);
        });
        mocha_1.it('should pass configuration object to File', () => {
            assert.deepStrictEqual(file.calledWith_[2], options);
        });
    });
    mocha_1.describe('getFiles', () => {
        mocha_1.it('should get files without a query', done => {
            bucket.request = (reqOpts) => {
                assert.strictEqual(reqOpts.uri, '/o');
                assert.deepStrictEqual(reqOpts.qs, {});
                done();
            };
            bucket.getFiles(common_1.util.noop);
        });
        mocha_1.it('should get files with a query', done => {
            const token = 'next-page-token';
            bucket.request = (reqOpts) => {
                assert.deepStrictEqual(reqOpts.qs, { maxResults: 5, pageToken: token });
                done();
            };
            bucket.getFiles({ maxResults: 5, pageToken: token }, common_1.util.noop);
        });
        mocha_1.it('should allow setting a directory', done => {
            //Note: Directory is deprecated.
            const directory = 'directory-name';
            bucket.request = (reqOpts) => {
                assert.strictEqual(reqOpts.qs.prefix, `${directory}/`);
                assert.strictEqual(reqOpts.qs.directory, undefined);
                done();
            };
            bucket.getFiles({ directory }, assert.ifError);
        });
        mocha_1.it('should strip excess slashes from a directory', done => {
            //Note: Directory is deprecated.
            const directory = 'directory-name///';
            bucket.request = (reqOpts) => {
                assert.strictEqual(reqOpts.qs.prefix, 'directory-name/');
                done();
            };
            bucket.getFiles({ directory }, assert.ifError);
        });
        mocha_1.it('should return nextQuery if more results exist', () => {
            const token = 'next-page-token';
            bucket.request = (reqOpts, callback) => {
                callback(null, { nextPageToken: token, items: [] });
            };
            bucket.getFiles({ maxResults: 5 }, (err, results, nextQuery) => {
                assert.strictEqual(nextQuery.pageToken, token);
                assert.strictEqual(nextQuery.maxResults, 5);
            });
        });
        mocha_1.it('should return null nextQuery if there are no more results', () => {
            bucket.request = (reqOpts, callback) => {
                callback(null, { items: [] });
            };
            bucket.getFiles({ maxResults: 5 }, (err, results, nextQuery) => {
                assert.strictEqual(nextQuery, null);
            });
        });
        mocha_1.it('should return File objects', done => {
            bucket.request = (reqOpts, callback) => {
                callback(null, {
                    items: [{ name: 'fake-file-name', generation: 1 }],
                });
            };
            bucket.getFiles((err, files) => {
                assert.ifError(err);
                assert(files[0] instanceof FakeFile);
                assert.strictEqual(typeof files[0].calledWith_[2].generation, 'undefined');
                done();
            });
        });
        mocha_1.it('should return versioned Files if queried for versions', done => {
            bucket.request = (reqOpts, callback) => {
                callback(null, {
                    items: [{ name: 'fake-file-name', generation: 1 }],
                });
            };
            bucket.getFiles({ versions: true }, (err, files) => {
                assert.ifError(err);
                assert(files[0] instanceof FakeFile);
                assert.strictEqual(files[0].calledWith_[2].generation, 1);
                done();
            });
        });
        mocha_1.it('should set kmsKeyName on file', done => {
            const kmsKeyName = 'kms-key-name';
            bucket.request = (reqOpts, callback) => {
                callback(null, {
                    items: [{ name: 'fake-file-name', kmsKeyName }],
                });
            };
            bucket.getFiles({ versions: true }, (err, files) => {
                assert.ifError(err);
                assert.strictEqual(files[0].calledWith_[2].kmsKeyName, kmsKeyName);
                done();
            });
        });
        mocha_1.it('should return apiResponse in callback', done => {
            const resp = { items: [{ name: 'fake-file-name' }] };
            bucket.request = (reqOpts, callback) => {
                callback(null, resp);
            };
            bucket.getFiles((err, files, nextQuery, apiResponse) => {
                assert.deepStrictEqual(resp, apiResponse);
                done();
            });
        });
        mocha_1.it('should execute callback with error & API response', done => {
            const error = new Error('Error.');
            const apiResponse = {};
            bucket.request = (reqOpts, callback) => {
                callback(error, apiResponse);
            };
            bucket.getFiles((err, files, nextQuery, apiResponse_) => {
                assert.strictEqual(err, error);
                assert.strictEqual(files, null);
                assert.strictEqual(nextQuery, null);
                assert.strictEqual(apiResponse_, apiResponse);
                done();
            });
        });
        mocha_1.it('should populate returned File object with metadata', done => {
            const fileMetadata = {
                name: 'filename',
                contentType: 'x-zebra',
                metadata: {
                    my: 'custom metadata',
                },
            };
            bucket.request = (reqOpts, callback) => {
                callback(null, { items: [fileMetadata] });
            };
            bucket.getFiles((err, files) => {
                assert.ifError(err);
                assert.deepStrictEqual(files[0].metadata, fileMetadata);
                done();
            });
        });
    });
    mocha_1.describe('getLabels', () => {
        mocha_1.it('should refresh metadata', done => {
            bucket.getMetadata = () => {
                done();
            };
            bucket.getLabels(assert.ifError);
        });
        mocha_1.it('should accept an options object', done => {
            const options = {};
            bucket.getMetadata = (options_) => {
                assert.strictEqual(options_, options);
                done();
            };
            bucket.getLabels(options, assert.ifError);
        });
        mocha_1.it('should return error from getMetadata', done => {
            const error = new Error('Error.');
            bucket.getMetadata = (options, callback) => {
                callback(error);
            };
            bucket.getLabels((err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
        mocha_1.it('should return labels metadata property', done => {
            const metadata = {
                labels: {
                    label: 'labelvalue',
                },
            };
            bucket.getMetadata = (options, callback) => {
                callback(null, metadata);
            };
            bucket.getLabels((err, labels) => {
                assert.ifError(err);
                assert.strictEqual(labels, metadata.labels);
                done();
            });
        });
        mocha_1.it('should return empty object if no labels exist', done => {
            const metadata = {};
            bucket.getMetadata = (options, callback) => {
                callback(null, metadata);
            };
            bucket.getLabels((err, labels) => {
                assert.ifError(err);
                assert.deepStrictEqual(labels, {});
                done();
            });
        });
    });
    mocha_1.describe('getNotifications', () => {
        mocha_1.it('should make the correct request', done => {
            const options = {};
            bucket.request = (reqOpts) => {
                assert.strictEqual(reqOpts.uri, '/notificationConfigs');
                assert.strictEqual(reqOpts.qs, options);
                done();
            };
            bucket.getNotifications(options, assert.ifError);
        });
        mocha_1.it('should optionally accept options', done => {
            bucket.request = (reqOpts) => {
                assert.deepStrictEqual(reqOpts.qs, {});
                done();
            };
            bucket.getNotifications(assert.ifError);
        });
        mocha_1.it('should return any errors to the callback', done => {
            const error = new Error('err');
            const response = {};
            bucket.request = (reqOpts, callback) => {
                callback(error, response);
            };
            bucket.getNotifications((err, notifications, resp) => {
                assert.strictEqual(err, error);
                assert.strictEqual(notifications, null);
                assert.strictEqual(resp, response);
                done();
            });
        });
        mocha_1.it('should return a list of notification objects', done => {
            const fakeItems = [{ id: '1' }, { id: '2' }, { id: '3' }];
            const response = { items: fakeItems };
            bucket.request = (reqOpts, callback) => {
                callback(null, response);
            };
            let callCount = 0;
            const fakeNotifications = [{}, {}, {}];
            bucket.notification = (id) => {
                const expectedId = fakeItems[callCount].id;
                assert.strictEqual(id, expectedId);
                return fakeNotifications[callCount++];
            };
            bucket.getNotifications((err, notifications, resp) => {
                assert.ifError(err);
                notifications.forEach((notification, i) => {
                    assert.strictEqual(notification, fakeNotifications[i]);
                    assert.strictEqual(notification.metadata, fakeItems[i]);
                });
                assert.strictEqual(resp, response);
                done();
            });
        });
    });
    mocha_1.describe('getSignedUrl', () => {
        const EXPECTED_SIGNED_URL = 'signed-url';
        const CNAME = 'https://www.example.com';
        let sandbox;
        let signer;
        let signerGetSignedUrlStub;
        let urlSignerStub;
        let SIGNED_URL_CONFIG;
        mocha_1.beforeEach(() => {
            sandbox = sinon.createSandbox();
            signerGetSignedUrlStub = sandbox.stub().resolves(EXPECTED_SIGNED_URL);
            signer = {
                getSignedUrl: signerGetSignedUrlStub,
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            urlSignerStub = sandbox.stub(fakeSigner, 'URLSigner').returns(signer);
            SIGNED_URL_CONFIG = {
                version: 'v4',
                expires: new Date(),
                action: 'list',
                cname: CNAME,
            };
        });
        mocha_1.afterEach(() => sandbox.restore());
        mocha_1.it('should construct a URLSigner and call getSignedUrl', done => {
            // assert signer is lazily-initialized.
            assert.strictEqual(bucket.signer, undefined);
            bucket.getSignedUrl(SIGNED_URL_CONFIG, (err, signedUrl) => {
                assert.ifError(err);
                assert.strictEqual(bucket.signer, signer);
                assert.strictEqual(signedUrl, EXPECTED_SIGNED_URL);
                const ctorArgs = urlSignerStub.getCall(0).args;
                assert.strictEqual(ctorArgs[0], bucket.storage.authClient);
                assert.strictEqual(ctorArgs[1], bucket);
                const getSignedUrlArgs = signerGetSignedUrlStub.getCall(0).args;
                assert.deepStrictEqual(getSignedUrlArgs[0], {
                    method: 'GET',
                    version: 'v4',
                    expires: SIGNED_URL_CONFIG.expires,
                    extensionHeaders: {},
                    queryParams: {},
                    cname: CNAME,
                });
                done();
            });
        });
        mocha_1.it('should error if action is null', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            SIGNED_URL_CONFIG.action = null;
            assert.throws(() => {
                bucket.getSignedUrl(SIGNED_URL_CONFIG, () => { });
            }, /The action is not provided or invalid./);
        });
        mocha_1.it('should error if action is undefined', () => {
            delete SIGNED_URL_CONFIG.action;
            assert.throws(() => {
                bucket.getSignedUrl(SIGNED_URL_CONFIG, () => { });
            }, /The action is not provided or invalid./);
        });
        mocha_1.it('should error for an invalid action', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            SIGNED_URL_CONFIG.action = 'watch';
            assert.throws(() => {
                bucket.getSignedUrl(SIGNED_URL_CONFIG, () => { });
            }, /The action is not provided or invalid./);
        });
    });
    mocha_1.describe('lock', () => {
        mocha_1.it('should throw if a metageneration is not provided', () => {
            const expectedError = new RegExp('A metageneration must be provided.');
            assert.throws(() => {
                bucket.lock(assert.ifError);
            }, expectedError);
        });
        mocha_1.it('should make the correct request', done => {
            const metageneration = 8;
            bucket.request = (reqOpts, callback) => {
                assert.deepStrictEqual(reqOpts, {
                    method: 'POST',
                    uri: '/lockRetentionPolicy',
                    qs: {
                        ifMetagenerationMatch: metageneration,
                    },
                });
                callback(); // done()
            };
            bucket.lock(metageneration, done);
        });
    });
    mocha_1.describe('makePrivate', () => {
        mocha_1.it('should set predefinedAcl & privatize files', done => {
            let didSetPredefinedAcl = false;
            let didMakeFilesPrivate = false;
            bucket.setMetadata = (metadata, options) => {
                assert.deepStrictEqual(metadata, { acl: null });
                assert.deepStrictEqual(options, { predefinedAcl: 'projectPrivate' });
                didSetPredefinedAcl = true;
                return Promise.resolve();
            };
            bucket.makeAllFilesPublicPrivate_ = (opts, callback) => {
                assert.strictEqual(opts.private, true);
                assert.strictEqual(opts.force, true);
                didMakeFilesPrivate = true;
                callback();
            };
            bucket.makePrivate({ includeFiles: true, force: true }, (err) => {
                assert.ifError(err);
                assert(didSetPredefinedAcl);
                assert(didMakeFilesPrivate);
                done();
            });
        });
        mocha_1.it('should accept metadata', done => {
            const options = {
                metadata: { a: 'b', c: 'd' },
            };
            bucket.setMetadata = (metadata) => {
                assert.deepStrictEqual(metadata, {
                    acl: null,
                    ...options.metadata,
                });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                assert.strictEqual(typeof options.metadata.acl, 'undefined');
                done();
            };
            bucket.makePrivate(options, assert.ifError);
        });
        mocha_1.it('should accept userProject', done => {
            const options = {
                userProject: 'user-project-id',
            };
            bucket.setMetadata = (metadata, options_) => {
                assert.strictEqual(options_.userProject, options.userProject);
                return Promise.resolve();
            };
            bucket.makePrivate(options, done);
        });
        mocha_1.it('should not make files private by default', done => {
            bucket.parent.request = (reqOpts, callback) => {
                callback();
            };
            bucket.makeAllFilesPublicPrivate_ = () => {
                throw new Error('Please, no. I do not want to be called.');
            };
            bucket.makePrivate(done);
        });
        mocha_1.it('should execute callback with error', done => {
            const error = new Error('Error.');
            bucket.parent.request = (reqOpts, callback) => {
                callback(error);
            };
            bucket.makePrivate((err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
    });
    mocha_1.describe('makePublic', () => {
        mocha_1.beforeEach(() => {
            bucket.request = (reqOpts, callback) => {
                callback();
            };
        });
        mocha_1.it('should set ACL, default ACL, and publicize files', done => {
            let didSetAcl = false;
            let didSetDefaultAcl = false;
            let didMakeFilesPublic = false;
            bucket.acl.add = (opts) => {
                assert.strictEqual(opts.entity, 'allUsers');
                assert.strictEqual(opts.role, 'READER');
                didSetAcl = true;
                return Promise.resolve();
            };
            bucket.acl.default.add = (opts) => {
                assert.strictEqual(opts.entity, 'allUsers');
                assert.strictEqual(opts.role, 'READER');
                didSetDefaultAcl = true;
                return Promise.resolve();
            };
            bucket.makeAllFilesPublicPrivate_ = (opts, callback) => {
                assert.strictEqual(opts.public, true);
                assert.strictEqual(opts.force, true);
                didMakeFilesPublic = true;
                callback();
            };
            bucket.makePublic({
                includeFiles: true,
                force: true,
            }, (err) => {
                assert.ifError(err);
                assert(didSetAcl);
                assert(didSetDefaultAcl);
                assert(didMakeFilesPublic);
                done();
            });
        });
        mocha_1.it('should not make files public by default', done => {
            bucket.acl.add = () => Promise.resolve();
            bucket.acl.default.add = () => Promise.resolve();
            bucket.makeAllFilesPublicPrivate_ = () => {
                throw new Error('Please, no. I do not want to be called.');
            };
            bucket.makePublic(done);
        });
        mocha_1.it('should execute callback with error', done => {
            const error = new Error('Error.');
            bucket.acl.add = () => Promise.reject(error);
            bucket.makePublic((err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
    });
    mocha_1.describe('notification', () => {
        mocha_1.it('should throw an error if an id is not provided', () => {
            assert.throws(() => {
                bucket.notification();
            }, /You must supply a notification ID\./);
        });
        mocha_1.it('should return a Notification object', () => {
            const fakeId = '123';
            const notification = bucket.notification(fakeId);
            assert(notification instanceof FakeNotification);
            assert.strictEqual(notification.bucket, bucket);
            assert.strictEqual(notification.id, fakeId);
        });
    });
    mocha_1.describe('removeRetentionPeriod', () => {
        mocha_1.it('should call setMetadata correctly', done => {
            bucket.setMetadata = (metadata, callback) => {
                assert.deepStrictEqual(metadata, {
                    retentionPolicy: null,
                });
                callback(); // done()
            };
            bucket.removeRetentionPeriod(done);
        });
    });
    mocha_1.describe('request', () => {
        const USER_PROJECT = 'grape-spaceship-123';
        mocha_1.beforeEach(() => {
            bucket.userProject = USER_PROJECT;
        });
        mocha_1.it('should set the userProject if qs is undefined', done => {
            FakeServiceObject.prototype.request = ((reqOpts) => {
                assert.strictEqual(reqOpts.qs.userProject, USER_PROJECT);
                done();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            });
            bucket.request({}, assert.ifError);
        });
        mocha_1.it('should set the userProject if field is undefined', done => {
            const options = {
                qs: {
                    foo: 'bar',
                },
            };
            FakeServiceObject.prototype.request = ((reqOpts) => {
                assert.strictEqual(reqOpts.qs.userProject, USER_PROJECT);
                assert.strictEqual(reqOpts.qs, options.qs);
                done();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            });
            bucket.request(options, assert.ifError);
        });
        mocha_1.it('should not overwrite the userProject', done => {
            const fakeUserProject = 'not-grape-spaceship-123';
            const options = {
                qs: {
                    userProject: fakeUserProject,
                },
            };
            FakeServiceObject.prototype.request = ((reqOpts) => {
                assert.strictEqual(reqOpts.qs.userProject, fakeUserProject);
                done();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            });
            bucket.request(options, assert.ifError);
        });
        mocha_1.it('should call ServiceObject#request correctly', done => {
            const options = {};
            Object.assign(FakeServiceObject.prototype, {
                request(reqOpts, callback) {
                    assert.strictEqual(this, bucket);
                    assert.strictEqual(reqOpts, options);
                    callback(); // done fn
                },
            });
            bucket.request(options, done);
        });
    });
    mocha_1.describe('setLabels', () => {
        mocha_1.it('should correctly call setMetadata', done => {
            const labels = {};
            bucket.setMetadata = (metadata, options, callback) => {
                assert.strictEqual(metadata.labels, labels);
                callback(); // done()
            };
            bucket.setLabels(labels, done);
        });
        mocha_1.it('should accept an options object', done => {
            const labels = {};
            const options = {};
            bucket.setMetadata = (metadata, options_) => {
                assert.strictEqual(options_, options);
                done();
            };
            bucket.setLabels(labels, options, done);
        });
    });
    mocha_1.describe('setRetentionPeriod', () => {
        mocha_1.it('should call setMetadata correctly', done => {
            const duration = 90000;
            bucket.setMetadata = (metadata, callback) => {
                assert.deepStrictEqual(metadata, {
                    retentionPolicy: {
                        retentionPeriod: duration,
                    },
                });
                callback(); // done()
            };
            bucket.setRetentionPeriod(duration, done);
        });
    });
    mocha_1.describe('setCorsConfiguration', () => {
        mocha_1.it('should call setMetadata correctly', done => {
            const corsConfiguration = [{ maxAgeSeconds: 3600 }];
            bucket.setMetadata = (metadata, callback) => {
                assert.deepStrictEqual(metadata, {
                    cors: corsConfiguration,
                });
                callback(); // done()
            };
            bucket.setCorsConfiguration(corsConfiguration, done);
        });
    });
    mocha_1.describe('setStorageClass', () => {
        const STORAGE_CLASS = 'NEW_STORAGE_CLASS';
        const OPTIONS = {};
        const CALLBACK = common_1.util.noop;
        mocha_1.it('should convert camelCase to snake_case', done => {
            bucket.setMetadata = (metadata) => {
                assert.strictEqual(metadata.storageClass, 'CAMEL_CASE');
                done();
            };
            bucket.setStorageClass('camelCase', OPTIONS, CALLBACK);
        });
        mocha_1.it('should convert hyphenate to snake_case', done => {
            bucket.setMetadata = (metadata) => {
                assert.strictEqual(metadata.storageClass, 'HYPHENATED_CLASS');
                done();
            };
            bucket.setStorageClass('hyphenated-class', OPTIONS, CALLBACK);
        });
        mocha_1.it('should call setMetdata correctly', done => {
            bucket.setMetadata = (metadata, options, callback) => {
                assert.deepStrictEqual(metadata, { storageClass: STORAGE_CLASS });
                assert.strictEqual(options, OPTIONS);
                assert.strictEqual(callback, CALLBACK);
                done();
            };
            bucket.setStorageClass(STORAGE_CLASS, OPTIONS, CALLBACK);
        });
    });
    mocha_1.describe('setUserProject', () => {
        const USER_PROJECT = 'grape-spaceship-123';
        mocha_1.it('should set the userProject property', () => {
            bucket.setUserProject(USER_PROJECT);
            assert.strictEqual(bucket.userProject, USER_PROJECT);
        });
        mocha_1.it('should set the userProject on the global request options', () => {
            const methods = [
                'create',
                'delete',
                'exists',
                'get',
                'getMetadata',
                'setMetadata',
            ];
            methods.forEach(method => {
                assert.strictEqual(bucket.methods[method].reqOpts.qs.userProject, undefined);
            });
            bucket.setUserProject(USER_PROJECT);
            methods.forEach(method => {
                assert.strictEqual(bucket.methods[method].reqOpts.qs.userProject, USER_PROJECT);
            });
        });
    });
    mocha_1.describe('upload', () => {
        const basename = 'testfile.json';
        const filepath = path.join(__dirname, '../../test/testdata/' + basename);
        const metadata = {
            metadata: {
                a: 'b',
                c: 'd',
            },
        };
        mocha_1.beforeEach(() => {
            bucket.file = (name, metadata) => {
                return new FakeFile(bucket, name, metadata);
            };
        });
        mocha_1.it('should return early in snippet sandbox', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            global['GCLOUD_SANDBOX_ENV'] = true;
            const returnValue = bucket.upload(filepath, assert.ifError);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete global['GCLOUD_SANDBOX_ENV'];
            assert.strictEqual(returnValue, undefined);
        });
        mocha_1.it('should accept a path & cb', done => {
            bucket.upload(filepath, (err, file) => {
                assert.ifError(err);
                assert.strictEqual(file.bucket.name, bucket.name);
                assert.strictEqual(file.name, basename);
                done();
            });
        });
        mocha_1.it('should accept a path, metadata, & cb', done => {
            const options = {
                metadata,
                encryptionKey: 'key',
                kmsKeyName: 'kms-key-name',
            };
            bucket.upload(filepath, options, (err, file) => {
                assert.ifError(err);
                assert.strictEqual(file.bucket.name, bucket.name);
                assert.deepStrictEqual(file.metadata, metadata);
                assert.strictEqual(file.options.encryptionKey, options.encryptionKey);
                assert.strictEqual(file.options.kmsKeyName, options.kmsKeyName);
                done();
            });
        });
        mocha_1.it('should accept a path, a string dest, & cb', done => {
            const newFileName = 'new-file-name.png';
            const options = {
                destination: newFileName,
                encryptionKey: 'key',
                kmsKeyName: 'kms-key-name',
            };
            bucket.upload(filepath, options, (err, file) => {
                assert.ifError(err);
                assert.strictEqual(file.bucket.name, bucket.name);
                assert.strictEqual(file.name, newFileName);
                assert.strictEqual(file.options.encryptionKey, options.encryptionKey);
                assert.strictEqual(file.options.kmsKeyName, options.kmsKeyName);
                done();
            });
        });
        mocha_1.it('should accept a path, a string dest, metadata, & cb', done => {
            const newFileName = 'new-file-name.png';
            const options = {
                destination: newFileName,
                metadata,
                encryptionKey: 'key',
                kmsKeyName: 'kms-key-name',
            };
            bucket.upload(filepath, options, (err, file) => {
                assert.ifError(err);
                assert.strictEqual(file.bucket.name, bucket.name);
                assert.strictEqual(file.name, newFileName);
                assert.deepStrictEqual(file.metadata, metadata);
                assert.strictEqual(file.options.encryptionKey, options.encryptionKey);
                assert.strictEqual(file.options.kmsKeyName, options.kmsKeyName);
                done();
            });
        });
        mocha_1.it('should accept a path, a File dest, & cb', done => {
            const fakeFile = new FakeFile(bucket, 'file-name');
            fakeFile.isSameFile = () => {
                return true;
            };
            const options = { destination: fakeFile };
            bucket.upload(filepath, options, (err, file) => {
                assert.ifError(err);
                assert(file.isSameFile());
                done();
            });
        });
        mocha_1.it('should accept a path, a File dest, metadata, & cb', done => {
            const fakeFile = new FakeFile(bucket, 'file-name');
            fakeFile.isSameFile = () => {
                return true;
            };
            const options = { destination: fakeFile, metadata };
            bucket.upload(filepath, options, (err, file) => {
                assert.ifError(err);
                assert(file.isSameFile());
                assert.deepStrictEqual(file.metadata, metadata);
                done();
            });
        });
        mocha_1.describe('resumable uploads', () => {
            mocha_1.beforeEach(() => {
                fsStatOverride = (path, callback) => {
                    callback(null, { size: 1 }); // Small size to guarantee simple upload
                };
            });
            mocha_1.it('should force a resumable upload', done => {
                const fakeFile = new FakeFile(bucket, 'file-name');
                const options = { destination: fakeFile, resumable: true };
                fakeFile.createWriteStream = (options_) => {
                    const ws = new stream.Writable();
                    ws.write = () => true;
                    setImmediate(() => {
                        assert.strictEqual(options_.resumable, options.resumable);
                        done();
                    });
                    return ws;
                };
                bucket.upload(filepath, options, assert.ifError);
            });
            mocha_1.it('should not pass resumable option to createWriteStream when file size is greater than minimum resumable threshold', done => {
                const fakeFile = new FakeFile(bucket, 'file-name');
                const options = { destination: fakeFile };
                fsStatOverride = (path, callback) => {
                    // Set size greater than threshold
                    callback(null, { size: 5000001 });
                };
                fakeFile.createWriteStream = (options_) => {
                    const ws = new stream.Writable();
                    ws.write = () => true;
                    setImmediate(() => {
                        assert.strictEqual(typeof options_.resumable, 'undefined');
                        done();
                    });
                    return ws;
                };
                bucket.upload(filepath, options, assert.ifError);
            });
            mocha_1.it('should prevent resumable when file size is less than minimum resumable threshold', done => {
                const fakeFile = new FakeFile(bucket, 'file-name');
                const options = { destination: fakeFile };
                fakeFile.createWriteStream = (options_) => {
                    const ws = new stream.Writable();
                    ws.write = () => true;
                    setImmediate(() => {
                        assert.strictEqual(options_.resumable, false);
                        done();
                    });
                    return ws;
                };
                bucket.upload(filepath, options, assert.ifError);
            });
        });
        mocha_1.it('should allow overriding content type', done => {
            const fakeFile = new FakeFile(bucket, 'file-name');
            const metadata = { contentType: 'made-up-content-type' };
            const options = { destination: fakeFile, metadata };
            fakeFile.createWriteStream = (options) => {
                const ws = new stream.Writable();
                ws.write = () => true;
                setImmediate(() => {
                    assert.strictEqual(options.metadata.contentType, metadata.contentType);
                    done();
                });
                return ws;
            };
            bucket.upload(filepath, options, assert.ifError);
        });
        mocha_1.it('should pass provided options to createWriteStream', done => {
            const fakeFile = new FakeFile(bucket, 'file-name');
            const options = {
                destination: fakeFile,
                a: 'b',
                c: 'd',
            };
            fakeFile.createWriteStream = (options_) => {
                const ws = new stream.Writable();
                ws.write = () => true;
                setImmediate(() => {
                    assert.strictEqual(options_.a, options.a);
                    assert.strictEqual(options_.c, options.c);
                    done();
                });
                return ws;
            };
            bucket.upload(filepath, options, assert.ifError);
        });
        mocha_1.it('should execute callback on error', done => {
            const error = new Error('Error.');
            const fakeFile = new FakeFile(bucket, 'file-name');
            const options = { destination: fakeFile };
            fakeFile.createWriteStream = () => {
                const ws = new stream.PassThrough();
                setImmediate(() => {
                    ws.destroy(error);
                });
                return ws;
            };
            bucket.upload(filepath, options, (err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
        mocha_1.it('should return file and metadata', done => {
            const fakeFile = new FakeFile(bucket, 'file-name');
            const options = { destination: fakeFile };
            const metadata = {};
            fakeFile.createWriteStream = () => {
                const ws = new stream.PassThrough();
                setImmediate(() => {
                    fakeFile.metadata = metadata;
                    ws.end();
                });
                return ws;
            };
            bucket.upload(filepath, options, (err, file, apiResponse) => {
                assert.ifError(err);
                assert.strictEqual(file, fakeFile);
                assert.strictEqual(apiResponse, metadata);
                done();
            });
        });
    });
    mocha_1.describe('makeAllFilesPublicPrivate_', () => {
        mocha_1.it('should get all files from the bucket', done => {
            const options = {};
            bucket.getFiles = (options_) => {
                assert.strictEqual(options_, options);
                return Promise.resolve([[]]);
            };
            bucket.makeAllFilesPublicPrivate_(options, done);
        });
        mocha_1.it('should process 10 files at a time', done => {
            pLimitOverride = (limit) => {
                assert.strictEqual(limit, 10);
                setImmediate(done);
                return () => { };
            };
            bucket.getFiles = () => Promise.resolve([[]]);
            bucket.makeAllFilesPublicPrivate_({}, assert.ifError);
        });
        mocha_1.it('should make files public', done => {
            let timesCalled = 0;
            const files = [bucket.file('1'), bucket.file('2')].map(file => {
                file.makePublic = () => {
                    timesCalled++;
                    return Promise.resolve();
                };
                return file;
            });
            bucket.getFiles = () => Promise.resolve([files]);
            bucket.makeAllFilesPublicPrivate_({ public: true }, (err) => {
                assert.ifError(err);
                assert.strictEqual(timesCalled, files.length);
                done();
            });
        });
        mocha_1.it('should make files private', done => {
            const options = {
                private: true,
            };
            let timesCalled = 0;
            const files = [bucket.file('1'), bucket.file('2')].map(file => {
                file.makePrivate = () => {
                    timesCalled++;
                    return Promise.resolve();
                };
                return file;
            });
            bucket.getFiles = () => Promise.resolve([files]);
            bucket.makeAllFilesPublicPrivate_(options, (err) => {
                assert.ifError(err);
                assert.strictEqual(timesCalled, files.length);
                done();
            });
        });
        mocha_1.it('should execute callback with error from getting files', done => {
            const error = new Error('Error.');
            bucket.getFiles = () => Promise.reject(error);
            bucket.makeAllFilesPublicPrivate_({}, (err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
        mocha_1.it('should execute callback with error from changing file', done => {
            const error = new Error('Error.');
            const files = [bucket.file('1'), bucket.file('2')].map(file => {
                file.makePublic = () => Promise.reject(error);
                return file;
            });
            bucket.getFiles = () => Promise.resolve([files]);
            bucket.makeAllFilesPublicPrivate_({ public: true }, (err) => {
                assert.strictEqual(err, error);
                done();
            });
        });
        mocha_1.it('should execute callback with queued errors', done => {
            const error = new Error('Error.');
            const files = [bucket.file('1'), bucket.file('2')].map(file => {
                file.makePublic = () => Promise.reject(error);
                return file;
            });
            bucket.getFiles = () => Promise.resolve([files]);
            bucket.makeAllFilesPublicPrivate_({
                public: true,
                force: true,
            }, (errs) => {
                assert.deepStrictEqual(errs, [error, error]);
                done();
            });
        });
        mocha_1.it('should execute callback with files changed', done => {
            const error = new Error('Error.');
            const successFiles = [bucket.file('1'), bucket.file('2')].map(file => {
                file.makePublic = () => Promise.resolve();
                return file;
            });
            const errorFiles = [bucket.file('3'), bucket.file('4')].map(file => {
                file.makePublic = () => Promise.reject(error);
                return file;
            });
            bucket.getFiles = () => {
                const files = successFiles.concat(errorFiles);
                return Promise.resolve([files]);
            };
            bucket.makeAllFilesPublicPrivate_({
                public: true,
                force: true,
            }, (errs, files) => {
                assert.deepStrictEqual(errs, [error, error]);
                assert.deepStrictEqual(files, successFiles);
                done();
            });
        });
    });
});
//# sourceMappingURL=bucket.js.map