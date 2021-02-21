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
const assert = require("assert");
const mocha_1 = require("mocha");
const crypto = require("crypto");
const fs = require("fs");
const node_fetch_1 = require("node-fetch");
const FormData = require("form-data");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const normalizeNewline = require('normalize-newline');
const pLimit = require("p-limit");
const util_1 = require("util");
const path = require("path");
const tmp = require("tmp");
const uuid = require("uuid");
const common_1 = require("@google-cloud/common");
const src_1 = require("../src");
const nock = require("nock");
const stream_1 = require("stream");
const pubsub_1 = require("@google-cloud/pubsub");
// When set to true, skips all tests that is not compatible for
// running inside VPCSC.
const RUNNING_IN_VPCSC = !!process.env['GOOGLE_CLOUD_TESTS_IN_VPCSC'];
// block all attempts to chat with the metadata server (kokoro runs on GCE)
nock('http://metadata.google.internal')
    .get(() => true)
    .replyWithError({ code: 'ENOTFOUND' })
    .persist();
mocha_1.describe('storage', () => {
    const USER_ACCOUNT = 'user-spsawchuk@gmail.com';
    const TESTS_PREFIX = `storage-tests-${shortUUID()}-`;
    const RETENTION_DURATION_SECONDS = 10;
    const storage = new src_1.Storage();
    const bucket = storage.bucket(generateName());
    const pubsub = new pubsub_1.PubSub({
        projectId: process.env.PROJECT_ID,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let topic;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const FILES = {
        logo: {
            path: path.join(__dirname, '../../system-test/data/CloudPlatform_128px_Retina.png'),
        },
        big: {
            path: path.join(__dirname, '../../system-test/data/three-mb-file.tif'),
            hash: undefined,
        },
        html: {
            path: path.join(__dirname, '../../system-test/data/long-html-file.html'),
        },
        gzip: {
            path: path.join(__dirname, '../../system-test/data/long-html-file.html.gz'),
        },
    };
    mocha_1.before(() => {
        return bucket
            .create()
            .then(() => {
            return pubsub.createTopic(generateName());
        })
            .then(data => {
            topic = data[0];
            return topic.iam.setPolicy({
                bindings: [
                    {
                        role: 'roles/pubsub.editor',
                        members: ['allUsers'],
                    },
                ],
            });
        });
    });
    mocha_1.after(() => {
        return Promise.all([deleteAllBucketsAsync(), deleteAllTopicsAsync()]);
    });
    mocha_1.describe('without authentication', () => {
        let privateBucket;
        let privateFile;
        let storageWithoutAuth;
        let GOOGLE_APPLICATION_CREDENTIALS;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        let GOOGLE_CLOUD_PROJECT;
        mocha_1.before(done => {
            // CI authentication is done with ADC. Cache it here, restore it `after`
            GOOGLE_APPLICATION_CREDENTIALS =
                process.env.GOOGLE_APPLICATION_CREDENTIALS;
            GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
            privateBucket = bucket; // `bucket` was created in the global `before`
            privateFile = privateBucket.file('file-name');
            privateFile.save('data', done);
        });
        mocha_1.beforeEach(() => {
            delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
            delete process.env.GOOGLE_CLOUD_PROJECT;
            delete require.cache[require.resolve('../src')];
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { Storage } = require('../src');
            storageWithoutAuth = new Storage();
        });
        mocha_1.after(() => {
            process.env.GOOGLE_APPLICATION_CREDENTIALS = GOOGLE_APPLICATION_CREDENTIALS;
            process.env.GOOGLE_CLOUD_PROJECT = GOOGLE_APPLICATION_CREDENTIALS;
        });
        mocha_1.describe('public data', () => {
            mocha_1.before(function () {
                if (RUNNING_IN_VPCSC)
                    this.skip();
            });
            let bucket;
            mocha_1.beforeEach(() => {
                bucket = storageWithoutAuth.bucket('gcp-public-data-landsat');
            });
            mocha_1.it('should list and download a file', async () => {
                const [files] = await bucket.getFiles({ autoPaginate: false });
                const file = files[0];
                const [isPublic] = await file.isPublic();
                assert.strictEqual(isPublic, true);
                assert.doesNotReject(file.download());
            });
        });
        mocha_1.describe('private data', () => {
            let bucket;
            let file;
            mocha_1.beforeEach(() => {
                bucket = storageWithoutAuth.bucket(privateBucket.id);
                file = bucket.file(privateFile.id);
            });
            mocha_1.it('should not download a file', async () => {
                const [isPublic] = await file.isPublic();
                assert.strictEqual(isPublic, false);
                await assert.rejects(file.download(), (err) => err.message.indexOf('does not have storage.objects.get') > -1);
            });
            mocha_1.it('should not upload a file', async () => {
                try {
                    await file.save('new data');
                }
                catch (e) {
                    const allowedErrorMessages = [
                        /Could not load the default credentials/,
                        /does not have storage\.objects\.create access/,
                    ];
                    assert(allowedErrorMessages.some(msg => msg.test(e.message)));
                }
            });
        });
    });
    mocha_1.describe('acls', () => {
        mocha_1.describe('buckets', () => {
            mocha_1.it('should get access controls', done => {
                bucket.acl.get((err, accessControls) => {
                    assert.ifError(err);
                    assert(Array.isArray(accessControls));
                    done();
                });
            });
            mocha_1.it('should add entity to default access controls', done => {
                bucket.acl.default.add({
                    entity: USER_ACCOUNT,
                    role: storage.acl.OWNER_ROLE,
                }, (err, accessControl) => {
                    assert.ifError(err);
                    assert.strictEqual(accessControl.role, storage.acl.OWNER_ROLE);
                    bucket.acl.default.get({
                        entity: USER_ACCOUNT,
                    }, (err, accessControl) => {
                        assert.ifError(err);
                        assert.strictEqual(accessControl.role, storage.acl.OWNER_ROLE);
                        bucket.acl.default.update({
                            entity: USER_ACCOUNT,
                            role: storage.acl.READER_ROLE,
                        }, (err, accessControl) => {
                            assert.ifError(err);
                            assert.strictEqual(accessControl.role, storage.acl.READER_ROLE);
                            bucket.acl.default.delete({ entity: USER_ACCOUNT }, done);
                        });
                    });
                });
            });
            mocha_1.it('should get default access controls', done => {
                bucket.acl.default.get((err, accessControls) => {
                    assert.ifError(err);
                    assert(Array.isArray(accessControls));
                    done();
                });
            });
            mocha_1.it('should grant an account access', done => {
                bucket.acl.add({
                    entity: USER_ACCOUNT,
                    role: storage.acl.OWNER_ROLE,
                }, (err, accessControl) => {
                    assert.ifError(err);
                    assert.strictEqual(accessControl.role, storage.acl.OWNER_ROLE);
                    const opts = { entity: USER_ACCOUNT };
                    bucket.acl.get(opts, (err, accessControl) => {
                        assert.ifError(err);
                        assert.strictEqual(accessControl.role, storage.acl.OWNER_ROLE);
                        bucket.acl.delete(opts, done);
                    });
                });
            });
            mocha_1.it('should update an account', done => {
                bucket.acl.add({
                    entity: USER_ACCOUNT,
                    role: storage.acl.OWNER_ROLE,
                }, (err, accessControl) => {
                    assert.ifError(err);
                    assert.strictEqual(accessControl.role, storage.acl.OWNER_ROLE);
                    bucket.acl.update({
                        entity: USER_ACCOUNT,
                        role: storage.acl.WRITER_ROLE,
                    }, (err, accessControl) => {
                        assert.ifError(err);
                        assert.strictEqual(accessControl.role, storage.acl.WRITER_ROLE);
                        bucket.acl.delete({ entity: USER_ACCOUNT }, done);
                    });
                });
            });
            mocha_1.it('should make a bucket public', done => {
                bucket.makePublic(err => {
                    assert.ifError(err);
                    bucket.acl.get({ entity: 'allUsers' }, (err, aclObject) => {
                        assert.ifError(err);
                        assert.deepStrictEqual(aclObject, {
                            entity: 'allUsers',
                            role: 'READER',
                        });
                        bucket.acl.delete({ entity: 'allUsers' }, done);
                    });
                });
            });
            mocha_1.it('should make files public', async () => {
                await Promise.all(['a', 'b', 'c'].map(text => createFileWithContentPromise(text)));
                await bucket.makePublic({ includeFiles: true });
                const [files] = await bucket.getFiles();
                const resps = await Promise.all(files.map(file => isFilePublicAsync(file)));
                resps.forEach(resp => assert.strictEqual(resp, true));
                await Promise.all([
                    bucket.acl.default.delete({ entity: 'allUsers' }),
                    bucket.deleteFiles(),
                ]);
            });
            mocha_1.it('should make a bucket private', done => {
                bucket.makePublic(err => {
                    assert.ifError(err);
                    bucket.makePrivate(err => {
                        assert.ifError(err);
                        bucket.acl.get({ entity: 'allUsers' }, (err, aclObject) => {
                            assert.strictEqual(err.code, 404);
                            assert.strictEqual(err.message, 'Not Found');
                            assert.strictEqual(aclObject, null);
                            done();
                        });
                    });
                });
            });
            mocha_1.it('should make files private', async () => {
                await Promise.all(['a', 'b', 'c'].map(text => createFileWithContentPromise(text)));
                await bucket.makePrivate({ includeFiles: true });
                const [files] = await bucket.getFiles();
                const resps = await Promise.all(files.map(file => isFilePublicAsync(file)));
                resps.forEach(resp => {
                    assert.strictEqual(resp, false);
                });
                await bucket.deleteFiles();
            });
        });
        mocha_1.describe('files', () => {
            let file;
            mocha_1.beforeEach(done => {
                const options = {
                    destination: generateName() + '.png',
                };
                bucket.upload(FILES.logo.path, options, (err, f) => {
                    assert.ifError(err);
                    file = f;
                    done();
                });
            });
            mocha_1.afterEach(done => {
                file.delete(done);
            });
            mocha_1.it('should get access controls', done => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                file.acl.get(done, (err, accessControls) => {
                    assert.ifError(err);
                    assert(Array.isArray(accessControls));
                    done();
                });
            });
            mocha_1.it('should not expose default api', () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                assert.strictEqual(typeof file.default, 'undefined');
            });
            mocha_1.it('should grant an account access', done => {
                file.acl.add({
                    entity: USER_ACCOUNT,
                    role: storage.acl.OWNER_ROLE,
                }, (err, accessControl) => {
                    assert.ifError(err);
                    assert.strictEqual(accessControl.role, storage.acl.OWNER_ROLE);
                    file.acl.get({ entity: USER_ACCOUNT }, (err, accessControl) => {
                        assert.ifError(err);
                        assert.strictEqual(accessControl.role, storage.acl.OWNER_ROLE);
                        file.acl.delete({ entity: USER_ACCOUNT }, done);
                    });
                });
            });
            mocha_1.it('should update an account', done => {
                file.acl.add({
                    entity: USER_ACCOUNT,
                    role: storage.acl.OWNER_ROLE,
                }, (err, accessControl) => {
                    assert.ifError(err);
                    assert.strictEqual(accessControl.role, storage.acl.OWNER_ROLE);
                    file.acl.update({
                        entity: USER_ACCOUNT,
                        role: storage.acl.READER_ROLE,
                    }, (err, accessControl) => {
                        assert.ifError(err);
                        assert.strictEqual(accessControl.role, storage.acl.READER_ROLE);
                        file.acl.delete({ entity: USER_ACCOUNT }, done);
                    });
                });
            });
            mocha_1.it('should make a file public', done => {
                file.makePublic(err => {
                    assert.ifError(err);
                    file.acl.get({ entity: 'allUsers' }, (err, aclObject) => {
                        assert.ifError(err);
                        assert.deepStrictEqual(aclObject, {
                            entity: 'allUsers',
                            role: 'READER',
                        });
                        file.acl.delete({ entity: 'allUsers' }, done);
                    });
                });
            });
            mocha_1.it('should make a file private', done => {
                file.makePublic(err => {
                    assert.ifError(err);
                    file.makePrivate(err => {
                        assert.ifError(err);
                        file.acl.get({ entity: 'allUsers' }, (err, aclObject) => {
                            assert.strictEqual(err.code, 404);
                            assert.strictEqual(err.message, 'Not Found');
                            assert.strictEqual(aclObject, null);
                            done();
                        });
                    });
                });
            });
            mocha_1.it('should set custom encryption during the upload', done => {
                const key = '12345678901234567890123456789012';
                bucket.upload(FILES.big.path, {
                    encryptionKey: key,
                    resumable: false,
                }, (err, file) => {
                    assert.ifError(err);
                    file.getMetadata((err, metadata) => {
                        assert.ifError(err);
                        assert.strictEqual(metadata.customerEncryption.encryptionAlgorithm, 'AES256');
                        done();
                    });
                });
            });
            mocha_1.it('should set custom encryption in a resumable upload', done => {
                const key = crypto.randomBytes(32);
                bucket.upload(FILES.big.path, {
                    encryptionKey: key,
                    resumable: true,
                }, (err, file) => {
                    assert.ifError(err);
                    file.getMetadata((err, metadata) => {
                        assert.ifError(err);
                        assert.strictEqual(metadata.customerEncryption.encryptionAlgorithm, 'AES256');
                        done();
                    });
                });
            });
            mocha_1.it('should make a file public during the upload', done => {
                bucket.upload(FILES.big.path, {
                    resumable: false,
                    public: true,
                }, (err, file) => {
                    assert.ifError(err);
                    file.acl.get({ entity: 'allUsers' }, (err, aclObject) => {
                        assert.ifError(err);
                        assert.deepStrictEqual(aclObject, {
                            entity: 'allUsers',
                            role: 'READER',
                        });
                        done();
                    });
                });
            });
            mocha_1.it('should make a file public from a resumable upload', done => {
                bucket.upload(FILES.big.path, {
                    resumable: true,
                    public: true,
                }, (err, file) => {
                    assert.ifError(err);
                    file.acl.get({ entity: 'allUsers' }, (err, aclObject) => {
                        assert.ifError(err);
                        assert.deepStrictEqual(aclObject, {
                            entity: 'allUsers',
                            role: 'READER',
                        });
                        done();
                    });
                });
            });
            mocha_1.it('should make a file private from a resumable upload', done => {
                bucket.upload(FILES.big.path, {
                    resumable: true,
                    private: true,
                }, (err, file) => {
                    assert.ifError(err);
                    file.acl.get({ entity: 'allUsers' }, (err, aclObject) => {
                        assert.strictEqual(err.code, 404);
                        assert.strictEqual(err.message, 'Not Found');
                        assert.strictEqual(aclObject, null);
                        done();
                    });
                });
            });
        });
    });
    mocha_1.describe('iam', () => {
        let PROJECT_ID;
        mocha_1.before(done => {
            storage.authClient.getProjectId((err, projectId) => {
                if (err) {
                    done(err);
                    return;
                }
                PROJECT_ID = projectId;
                done();
            });
        });
        mocha_1.describe('buckets', () => {
            let bucket;
            mocha_1.before(() => {
                bucket = storage.bucket(generateName());
                return bucket.create();
            });
            mocha_1.it('should get a policy', done => {
                bucket.iam.getPolicy((err, policy) => {
                    assert.ifError(err);
                    assert.deepStrictEqual(policy.bindings, [
                        {
                            members: [
                                'projectEditor:' + PROJECT_ID,
                                'projectOwner:' + PROJECT_ID,
                            ],
                            role: 'roles/storage.legacyBucketOwner',
                        },
                        {
                            members: ['projectViewer:' + PROJECT_ID],
                            role: 'roles/storage.legacyBucketReader',
                        },
                    ]);
                    done();
                });
            });
            mocha_1.it('should set a policy', done => {
                bucket.iam.getPolicy((err, policy) => {
                    assert.ifError(err);
                    policy.bindings.push({
                        role: 'roles/storage.legacyBucketReader',
                        members: ['allUsers'],
                    });
                    bucket.iam.setPolicy(policy, (err, newPolicy) => {
                        assert.ifError(err);
                        const legacyBucketReaderBinding = newPolicy.bindings.filter(binding => {
                            return binding.role === 'roles/storage.legacyBucketReader';
                        })[0];
                        assert(legacyBucketReaderBinding.members.includes('allUsers'));
                        done();
                    });
                });
            });
            mocha_1.it('should get-modify-set a conditional policy', async () => {
                // Uniform-bucket-level-access is required to use IAM Conditions.
                await bucket.setMetadata({
                    iamConfiguration: {
                        uniformBucketLevelAccess: {
                            enabled: true,
                        },
                    },
                });
                const [policy] = await bucket.iam.getPolicy();
                const serviceAccount = (await storage.authClient.getCredentials())
                    .client_email;
                const conditionalBinding = {
                    role: 'roles/storage.objectViewer',
                    members: [`serviceAccount:${serviceAccount}`],
                    condition: {
                        title: 'always-true',
                        description: 'this condition is always effective',
                        expression: 'true',
                    },
                };
                policy.version = 3;
                policy.bindings.push(conditionalBinding);
                await bucket.iam.setPolicy(policy);
                const [newPolicy] = await bucket.iam.getPolicy({
                    requestedPolicyVersion: 3,
                });
                assert.deepStrictEqual(newPolicy.bindings, policy.bindings);
            });
            mocha_1.it('should test the iam permissions', done => {
                const testPermissions = [
                    'storage.buckets.get',
                    'storage.buckets.getIamPolicy',
                ];
                bucket.iam.testPermissions(testPermissions, (err, permissions) => {
                    assert.ifError(err);
                    assert.deepStrictEqual(permissions, {
                        'storage.buckets.get': true,
                        'storage.buckets.getIamPolicy': true,
                    });
                    done();
                });
            });
        });
    });
    mocha_1.describe('uniform bucket-level access', () => {
        let bucket;
        const customAcl = {
            entity: USER_ACCOUNT,
            role: storage.acl.OWNER_ROLE,
        };
        const createBucket = () => {
            bucket = storage.bucket(generateName());
            return bucket.create();
        };
        const setUniformBucketLevelAccess = (bucket, enabled) => bucket.setMetadata({
            iamConfiguration: {
                uniformBucketLevelAccess: {
                    enabled,
                },
            },
        });
        mocha_1.describe('files', () => {
            mocha_1.before(createBucket);
            mocha_1.it('can be written to the bucket by project owner w/o configuration', async () => {
                await setUniformBucketLevelAccess(bucket, true);
                const file = bucket.file('file');
                return assert.doesNotReject(() => file.save('data'));
            });
        });
        mocha_1.describe('disables file ACL', () => {
            let file;
            const validateUniformBucketLevelAccessEnabledError = (err) => {
                assert.strictEqual(err.code, 400);
                return true;
            };
            mocha_1.before(async () => {
                await createBucket();
                await setUniformBucketLevelAccess(bucket, true);
                file = bucket.file('file');
                await file.save('data');
            });
            mocha_1.it('should fail to get file ACL', () => {
                return assert.rejects(() => file.acl.get(), validateUniformBucketLevelAccessEnabledError);
            });
            mocha_1.it('should fail to update file ACL', () => {
                return assert.rejects(() => file.acl.update(customAcl), validateUniformBucketLevelAccessEnabledError);
            });
        });
        mocha_1.describe('preserves bucket/file ACL over uniform bucket-level access on/off', () => {
            mocha_1.beforeEach(createBucket);
            mocha_1.it('should preserve default bucket ACL', async () => {
                await bucket.acl.default.update(customAcl);
                const [aclBefore] = await bucket.acl.default.get();
                await setUniformBucketLevelAccess(bucket, true);
                await setUniformBucketLevelAccess(bucket, false);
                const [aclAfter] = await bucket.acl.default.get();
                assert.deepStrictEqual(aclAfter, aclBefore);
            });
            mocha_1.it('should preserve file ACL', async () => {
                const file = bucket.file('file');
                await file.save('data');
                await file.acl.update(customAcl);
                const [aclBefore] = await file.acl.get();
                await setUniformBucketLevelAccess(bucket, true);
                await setUniformBucketLevelAccess(bucket, false);
                const [aclAfter] = await file.acl.get();
                assert.deepStrictEqual(aclAfter, aclBefore);
            });
        });
    });
    mocha_1.describe('unicode validation', () => {
        mocha_1.before(function () {
            if (RUNNING_IN_VPCSC)
                this.skip();
        });
        let bucket;
        mocha_1.before(async () => {
            [bucket] = await storage.createBucket(generateName());
        });
        // Normalization form C: a single character for e-acute;
        // URL should end with Cafe%CC%81
        mocha_1.it('should not perform normalization form C', async () => {
            const name = 'Caf\u00e9';
            const expectedContents = 'Normalization Form C';
            const file = bucket.file(name);
            await file.save(expectedContents);
            return file
                .get()
                .then(data => {
                const receivedFile = data[0];
                assert.strictEqual(receivedFile.name, name);
                return receivedFile.download();
            })
                .then(contents => {
                assert.strictEqual(contents.toString(), expectedContents);
            });
        });
        // Normalization form D: an ASCII character followed by U+0301 combining
        // character; URL should end with Caf%C3%A9
        mocha_1.it('should not perform normalization form D', async () => {
            const name = 'Cafe\u0301';
            const expectedContents = 'Normalization Form D';
            const file = bucket.file(name);
            await file.save(expectedContents);
            return file
                .get()
                .then(data => {
                const receivedFile = data[0];
                assert.strictEqual(receivedFile.name, name);
                return receivedFile.download();
            })
                .then(contents => {
                assert.strictEqual(contents.toString(), expectedContents);
            });
        });
    });
    mocha_1.describe('getting buckets', () => {
        const bucketsToCreate = [generateName(), generateName()];
        mocha_1.before(async () => {
            await Promise.all(bucketsToCreate.map(b => storage.createBucket(b)));
        });
        mocha_1.after(async () => {
            await Promise.all(bucketsToCreate.map(bucket => storage.bucket(bucket).delete()));
        });
        mocha_1.it('should get buckets', done => {
            storage.getBuckets((err, buckets) => {
                const createdBuckets = buckets.filter(bucket => {
                    return bucketsToCreate.indexOf(bucket.name) > -1;
                });
                assert.strictEqual(createdBuckets.length, bucketsToCreate.length);
                done();
            });
        });
        mocha_1.it('should get buckets as a stream', done => {
            let bucketEmitted = false;
            storage
                .getBucketsStream()
                .on('error', done)
                .on('data', bucket => {
                bucketEmitted = bucket instanceof src_1.Bucket;
            })
                .on('end', () => {
                assert.strictEqual(bucketEmitted, true);
                done();
            });
        });
    });
    mocha_1.describe('bucket metadata', () => {
        mocha_1.it('should allow setting metadata on a bucket', done => {
            const metadata = {
                website: {
                    mainPageSuffix: 'http://fakeuri',
                    notFoundPage: 'http://fakeuri/404.html',
                },
            };
            bucket.setMetadata(metadata, (err, meta) => {
                assert.ifError(err);
                assert.deepStrictEqual(meta.website, metadata.website);
                done();
            });
        });
        mocha_1.it('should allow changing the storage class', async () => {
            const bucket = storage.bucket(generateName());
            await bucket.create();
            let [metadata] = await bucket.getMetadata();
            assert.strictEqual(metadata.storageClass, 'STANDARD');
            await bucket.setStorageClass('coldline');
            [metadata] = await bucket.getMetadata();
            assert.strictEqual(metadata.storageClass, 'COLDLINE');
        });
        mocha_1.describe('locationType', () => {
            const types = ['multi-region', 'region', 'dual-region'];
            mocha_1.beforeEach(() => {
                delete bucket.metadata;
            });
            mocha_1.it('should be available from getting a bucket', async () => {
                const [metadata] = await bucket.getMetadata();
                assert(types.includes(metadata.locationType));
            });
            mocha_1.it('should be available from creating a bucket', async () => {
                const [bucket] = await storage.createBucket(generateName());
                assert(types.includes(bucket.metadata.locationType));
                return bucket.delete();
            });
            mocha_1.it('should be available from listing buckets', async () => {
                const [buckets] = await storage.getBuckets();
                assert(buckets.length > 0);
                buckets.forEach(bucket => {
                    assert(types.includes(bucket.metadata.locationType));
                });
            });
            mocha_1.it('should be available from setting retention policy', async () => {
                await bucket.setRetentionPeriod(RETENTION_DURATION_SECONDS);
                assert(types.includes(bucket.metadata.locationType));
                await bucket.removeRetentionPeriod();
            });
            mocha_1.it('should be available from updating a bucket', async () => {
                await bucket.setLabels({ a: 'b' });
                assert(types.includes(bucket.metadata.locationType));
            });
        });
        mocha_1.describe('labels', () => {
            const LABELS = {
                label: 'labelvalue',
                labeltwo: 'labelvaluetwo',
            };
            mocha_1.beforeEach(done => {
                bucket.deleteLabels(done);
            });
            mocha_1.it('should set labels', done => {
                bucket.setLabels(LABELS, err => {
                    assert.ifError(err);
                    bucket.getLabels((err, labels) => {
                        assert.ifError(err);
                        assert.deepStrictEqual(labels, LABELS);
                        done();
                    });
                });
            });
            mocha_1.it('should update labels', done => {
                const newLabels = {
                    siblinglabel: 'labelvalue',
                };
                bucket.setLabels(LABELS, err => {
                    assert.ifError(err);
                    bucket.setLabels(newLabels, err => {
                        assert.ifError(err);
                        bucket.getLabels((err, labels) => {
                            assert.ifError(err);
                            assert.deepStrictEqual(labels, Object.assign({}, LABELS, newLabels));
                            done();
                        });
                    });
                });
            });
            mocha_1.it('should delete a single label', done => {
                if (Object.keys(LABELS).length <= 1) {
                    done(new Error('Maintainer Error: `LABELS` needs 2 labels.'));
                    return;
                }
                const labelKeyToDelete = Object.keys(LABELS)[0];
                bucket.setLabels(LABELS, err => {
                    assert.ifError(err);
                    bucket.deleteLabels(labelKeyToDelete, err => {
                        assert.ifError(err);
                        bucket.getLabels((err, labels) => {
                            assert.ifError(err);
                            const expectedLabels = Object.assign({}, LABELS);
                            delete expectedLabels[labelKeyToDelete];
                            assert.deepStrictEqual(labels, expectedLabels);
                            done();
                        });
                    });
                });
            });
            mocha_1.it('should delete all labels', done => {
                bucket.deleteLabels(err => {
                    assert.ifError(err);
                    bucket.getLabels((err, labels) => {
                        assert.ifError(err);
                        assert.deepStrictEqual(labels, {});
                        done();
                    });
                });
            });
        });
    });
    mocha_1.describe('bucket object lifecycle management', () => {
        mocha_1.it('should add a rule', done => {
            bucket.addLifecycleRule({
                action: 'delete',
                condition: {
                    age: 30,
                    isLive: true,
                },
            }, err => {
                assert.ifError(err);
                const rules = [].slice.call(bucket.metadata.lifecycle.rule);
                assert.deepStrictEqual(rules.pop(), {
                    action: {
                        type: 'Delete',
                    },
                    condition: {
                        age: 30,
                        isLive: true,
                    },
                });
                done();
            });
        });
        mocha_1.it('should append a new rule', async () => {
            const numExistingRules = (bucket.metadata.lifecycle && bucket.metadata.lifecycle.rule.length) ||
                0;
            await bucket.addLifecycleRule({
                action: 'delete',
                condition: {
                    age: 30,
                    isLive: true,
                },
            });
            await bucket.addLifecycleRule({
                action: 'setStorageClass',
                condition: {
                    age: 60,
                    isLive: true,
                },
                storageClass: 'coldline',
            });
            assert.strictEqual(bucket.metadata.lifecycle.rule.length, numExistingRules + 2);
        });
        mocha_1.it('should convert a rule with createdBefore to a date in string', done => {
            bucket.addLifecycleRule({
                action: 'delete',
                condition: {
                    createdBefore: new Date('2018'),
                },
            }, err => {
                assert.ifError(err);
                const rules = [].slice.call(bucket.metadata.lifecycle.rule);
                assert.deepStrictEqual(rules.pop(), {
                    action: {
                        type: 'Delete',
                    },
                    condition: {
                        createdBefore: '2018-01-01',
                    },
                });
                done();
            });
        });
        mocha_1.it('should add a noncurrent time rule', async () => {
            const NONCURRENT_TIME_BEFORE = '2020-01-01';
            await bucket.addLifecycleRule({
                action: 'delete',
                condition: {
                    noncurrentTimeBefore: new Date(NONCURRENT_TIME_BEFORE),
                    daysSinceNoncurrentTime: 100,
                },
            });
            assert(bucket.metadata.lifecycle.rule.some((rule) => typeof rule.action === 'object' &&
                rule.action.type === 'Delete' &&
                rule.condition.noncurrentTimeBefore === NONCURRENT_TIME_BEFORE &&
                rule.condition.daysSinceNoncurrentTime === 100));
        });
        mocha_1.it('should add a custom time rule', async () => {
            const CUSTOM_TIME_BEFORE = '2020-01-01';
            await bucket.addLifecycleRule({
                action: 'delete',
                condition: {
                    customTimeBefore: new Date(CUSTOM_TIME_BEFORE),
                    daysSinceCustomTime: 100,
                },
            });
            assert(bucket.metadata.lifecycle.rule.some((rule) => typeof rule.action === 'object' &&
                rule.action.type === 'Delete' &&
                rule.condition.customTimeBefore === CUSTOM_TIME_BEFORE &&
                rule.condition.daysSinceCustomTime === 100));
        });
        mocha_1.it('should remove all existing rules', done => {
            bucket.setMetadata({
                lifecycle: null,
            }, (err) => {
                assert.ifError(err);
                assert.strictEqual(bucket.metadata.lifecycle, undefined);
                done();
            });
        });
    });
    mocha_1.describe('cors configuration', () => {
        const corsEntry = [
            {
                maxAgeSeconds: 1600,
            },
            {
                maxAgeSeconds: 3600,
                method: ['GET', 'POST'],
                origin: ['*'],
                responseHeader: ['Content-Type', 'Access-Control-Allow-Origin'],
            },
        ];
        mocha_1.describe('bucket', () => {
            mocha_1.it('should create a bucket with a CORS configuration when passed in', async () => {
                const bucket = storage.bucket(generateName());
                await storage.createBucket(bucket.name, {
                    cors: corsEntry,
                });
                await bucket.getMetadata();
                assert.deepStrictEqual(bucket.metadata.cors, corsEntry);
            });
            mocha_1.it('should set a CORS configuration', async () => {
                const bucket = storage.bucket(generateName());
                await bucket.create();
                await bucket.setCorsConfiguration(corsEntry);
                await bucket.getMetadata();
                assert.deepStrictEqual(bucket.metadata.cors, corsEntry);
            });
            mocha_1.it('should remove a CORS configuration', async () => {
                const bucket = storage.bucket(generateName());
                await bucket.create();
                await bucket.setCorsConfiguration(corsEntry);
                await bucket.getMetadata();
                assert.deepStrictEqual(bucket.metadata.cors, corsEntry);
                // And now test the removing
                await bucket.setCorsConfiguration([]);
                assert.ok(!bucket.metadata.cors);
            });
        });
    });
    mocha_1.describe('bucket versioning', () => {
        mocha_1.describe('bucket', () => {
            mocha_1.it('should create a bucket with versioning enabled', async () => {
                const bucket = storage.bucket(generateName());
                await storage.createBucket(bucket.name, {
                    versioning: {
                        enabled: true,
                    },
                });
                await bucket.getMetadata();
                assert.strictEqual(bucket.metadata.versioning.enabled, true);
            });
            mocha_1.it('should by default create a bucket without versioning set', async () => {
                const bucket = storage.bucket(generateName());
                await storage.createBucket(bucket.name);
                await bucket.getMetadata();
                assert.strictEqual(bucket.metadata.versioning, undefined);
            });
        });
    });
    mocha_1.describe('bucket retention policies', () => {
        mocha_1.describe('bucket', () => {
            mocha_1.it('should create a bucket with a retention policy', async () => {
                const bucket = storage.bucket(generateName());
                await storage.createBucket(bucket.name, {
                    retentionPolicy: {
                        retentionPeriod: RETENTION_DURATION_SECONDS,
                    },
                });
                await bucket.getMetadata();
                assert.strictEqual(bucket.metadata.retentionPolicy.retentionPeriod, `${RETENTION_DURATION_SECONDS}`);
            });
            mocha_1.it('should set a retention policy', async () => {
                const bucket = storage.bucket(generateName());
                await bucket.create();
                await bucket.setRetentionPeriod(RETENTION_DURATION_SECONDS);
                await bucket.getMetadata();
                assert.strictEqual(bucket.metadata.retentionPolicy.retentionPeriod, `${RETENTION_DURATION_SECONDS}`);
            });
            mocha_1.it('should lock the retention period', async () => {
                const bucket = storage.bucket(generateName());
                await bucket.create();
                await bucket.setRetentionPeriod(RETENTION_DURATION_SECONDS);
                await bucket.getMetadata();
                await bucket.lock(bucket.metadata.metageneration);
                await assert.rejects(bucket.setRetentionPeriod(RETENTION_DURATION_SECONDS / 2), (err) => {
                    return err.code === 403;
                });
            });
            mocha_1.it('should remove a retention period', async () => {
                const bucket = storage.bucket(generateName());
                await bucket.create();
                await bucket.setRetentionPeriod(RETENTION_DURATION_SECONDS);
                await bucket.getMetadata();
                assert.strictEqual(bucket.metadata.retentionPolicy.retentionPeriod, `${RETENTION_DURATION_SECONDS}`);
                await bucket.removeRetentionPeriod();
                await bucket.getMetadata();
                assert.strictEqual(bucket.metadata.retentionPolicy, undefined);
            });
        });
        mocha_1.describe('file', () => {
            const BUCKET = storage.bucket(generateName());
            const FILE = BUCKET.file(generateName());
            const BUCKET_RETENTION_PERIOD = 1;
            mocha_1.before(done => {
                BUCKET.create({
                    retentionPolicy: {
                        retentionPeriod: BUCKET_RETENTION_PERIOD,
                    },
                }, err => {
                    if (err) {
                        done(err);
                        return;
                    }
                    FILE.save('data', done);
                });
            });
            mocha_1.afterEach(() => {
                return FILE.setMetadata({ temporaryHold: null, eventBasedHold: null });
            });
            mocha_1.after(done => {
                setTimeout(() => FILE.delete(done), BUCKET_RETENTION_PERIOD * 1000);
            });
            mocha_1.it('should set and release an event-based hold', async () => {
                await FILE.setMetadata({ eventBasedHold: true });
                assert.strictEqual(FILE.metadata.eventBasedHold, true);
                await FILE.setMetadata({ eventBasedHold: false });
                assert.strictEqual(FILE.metadata.eventBasedHold, false);
            });
            mocha_1.it('should set and release a temporary hold', async () => {
                await FILE.setMetadata({ temporaryHold: true });
                assert.strictEqual(FILE.metadata.temporaryHold, true);
                await FILE.setMetadata({ temporaryHold: false });
                assert.strictEqual(FILE.metadata.temporaryHold, false);
            });
            mocha_1.it('should get an expiration date', done => {
                FILE.getExpirationDate((err, expirationDate) => {
                    assert.ifError(err);
                    assert(expirationDate instanceof Date);
                    done();
                });
            });
        });
        mocha_1.describe('operations on held objects', () => {
            const BUCKET = storage.bucket(generateName());
            const FILES = [];
            const RETENTION_PERIOD_SECONDS = 5; // Each test has this much time!
            function createFile(callback) {
                const file = BUCKET.file(generateName());
                FILES.push(file);
                file.save('data', err => {
                    if (err) {
                        callback(err);
                        return;
                    }
                    callback(null, file);
                });
            }
            async function deleteFilesAsync() {
                await new Promise(resolve => setTimeout(resolve, RETENTION_PERIOD_SECONDS * 1000));
                return Promise.all(FILES.map(async (file) => {
                    await file.setMetadata({ temporaryHold: null });
                    return file.delete();
                }));
            }
            mocha_1.before(done => {
                BUCKET.create({
                    retentionPolicy: {
                        retentionPeriod: RETENTION_PERIOD_SECONDS,
                    },
                }, done);
            });
            mocha_1.after(() => {
                return deleteFilesAsync();
            });
            mocha_1.it('should block an overwrite request', done => {
                createFile((err, file) => {
                    assert.ifError(err);
                    file.save('new data', err => {
                        assert.strictEqual(err.code, 403);
                        done();
                    });
                });
            });
            mocha_1.it('should block a delete request', done => {
                createFile((err, file) => {
                    assert.ifError(err);
                    file.delete((err) => {
                        assert.strictEqual(err.code, 403);
                        done();
                    });
                });
            });
        });
    });
    mocha_1.describe('bucket logging', () => {
        const PREFIX = 'sys-test';
        mocha_1.it('should enable logging on current bucket by default', async () => {
            const [metadata] = await bucket.enableLogging({ prefix: PREFIX });
            assert.deepStrictEqual(metadata.logging, {
                logBucket: bucket.id,
                logObjectPrefix: PREFIX,
            });
        });
        mocha_1.it('should enable logging on another bucket', async () => {
            const bucketForLogging = storage.bucket(generateName());
            await bucketForLogging.create();
            const [metadata] = await bucket.enableLogging({
                bucket: bucketForLogging,
                prefix: PREFIX,
            });
            assert.deepStrictEqual(metadata.logging, {
                logBucket: bucketForLogging.id,
                logObjectPrefix: PREFIX,
            });
        });
    });
    mocha_1.describe('requester pays', () => {
        const HAS_2ND_PROJECT = process.env.GCN_STORAGE_2ND_PROJECT_ID !== undefined;
        let bucket;
        mocha_1.before(done => {
            bucket = storage.bucket(generateName());
            bucket.create({
                requesterPays: true,
            }, done);
        });
        mocha_1.after(done => {
            bucket.delete(done);
        });
        mocha_1.it('should have enabled requesterPays functionality', done => {
            bucket.getMetadata((err, metadata) => {
                assert.ifError(err);
                assert.strictEqual(metadata.billing.requesterPays, true);
                done();
            });
        });
        // These tests will verify that the requesterPays functionality works from
        // the perspective of another project.
        (HAS_2ND_PROJECT ? mocha_1.describe : mocha_1.describe.skip)('existing bucket', () => {
            const storageNonAllowList = new src_1.Storage({
                projectId: process.env.GCN_STORAGE_2ND_PROJECT_ID,
                keyFilename: process.env.GCN_STORAGE_2ND_PROJECT_KEY,
            });
            // the source bucket, which will have requesterPays enabled.
            let bucket;
            // the bucket object from the requesting user.
            let bucketNonAllowList;
            function isRequesterPaysEnabled(callback) {
                bucket.getMetadata((err, metadata) => {
                    if (err) {
                        callback(err);
                        return;
                    }
                    const billing = metadata.billing || {};
                    callback(null, !!billing && billing.requesterPays === true);
                });
            }
            mocha_1.before(done => {
                bucket = storage.bucket(generateName());
                bucketNonAllowList = storageNonAllowList.bucket(bucket.name);
                bucket.create(done);
            });
            mocha_1.it('should enable requesterPays', done => {
                isRequesterPaysEnabled((err, isEnabled) => {
                    assert.ifError(err);
                    assert.strictEqual(isEnabled, false);
                    bucket.enableRequesterPays(err => {
                        assert.ifError(err);
                        isRequesterPaysEnabled((err, isEnabled) => {
                            assert.ifError(err);
                            assert.strictEqual(isEnabled, true);
                            done();
                        });
                    });
                });
            });
            mocha_1.it('should disable requesterPays', done => {
                bucket.enableRequesterPays(err => {
                    assert.ifError(err);
                    isRequesterPaysEnabled((err, isEnabled) => {
                        assert.ifError(err);
                        assert.strictEqual(isEnabled, true);
                        bucket.disableRequesterPays(err => {
                            assert.ifError(err);
                            isRequesterPaysEnabled((err, isEnabled) => {
                                assert.ifError(err);
                                assert.strictEqual(isEnabled, false);
                                done();
                            });
                        });
                    });
                });
            });
            mocha_1.describe('methods that accept userProject', () => {
                let file;
                let notification;
                let topicName;
                const USER_PROJECT_OPTIONS = {
                    userProject: process.env.GCN_STORAGE_2ND_PROJECT_ID,
                };
                // This acts as a test for the following methods:
                //
                // - file.save()
                //   -> file.createWriteStream()
                mocha_1.before(() => {
                    file = bucketNonAllowList.file(generateName());
                    return bucket
                        .enableRequesterPays()
                        .then(() => bucket.iam.getPolicy())
                        .then(data => {
                        const policy = data[0];
                        // Allow an absolute or relative path (from project root)
                        // for the key file.
                        let key2 = process.env.GCN_STORAGE_2ND_PROJECT_KEY;
                        if (key2 && key2.charAt(0) === '.') {
                            key2 = `${__dirname}/../../${key2}`;
                        }
                        // Get the service account for the "second" account (the
                        // one that will read the requester pays file).
                        const clientEmail = require(key2).client_email;
                        policy.bindings.push({
                            role: 'roles/storage.admin',
                            members: [`serviceAccount:${clientEmail}`],
                        });
                        return bucket.iam.setPolicy(policy);
                    })
                        .then(() => file.save('abc', USER_PROJECT_OPTIONS))
                        .then(() => topic.getMetadata())
                        .then(data => {
                        topicName = data[0].name;
                    });
                });
                // This acts as a test for the following methods:
                //
                //  - bucket.delete({ userProject: ... })
                //    -> bucket.deleteFiles({ userProject: ... })
                //       -> bucket.getFiles({ userProject: ... })
                //          -> file.delete({ userProject: ... })
                mocha_1.after(done => {
                    deleteBucket(bucketNonAllowList, USER_PROJECT_OPTIONS, done);
                });
                mocha_1.beforeEach(() => {
                    bucketNonAllowList = storageNonAllowList.bucket(bucket.name);
                    file = bucketNonAllowList.file(file.name);
                });
                function doubleTest(testFunction) {
                    const failureMessage = 'Bucket is requester pays bucket but no user project provided.';
                    return (done) => {
                        testFunction({}, (err) => {
                            assert(err.message.indexOf(failureMessage) > -1);
                            testFunction(USER_PROJECT_OPTIONS, done);
                        });
                    };
                }
                mocha_1.it('bucket#combine', async () => {
                    const files = [
                        { file: bucketNonAllowList.file('file-one.txt'), contents: '123' },
                        { file: bucketNonAllowList.file('file-two.txt'), contents: '456' },
                    ];
                    await Promise.all(files.map(file => createFileAsync(file)));
                    const sourceFiles = files.map(x => x.file);
                    const destinationFile = bucketNonAllowList.file('file-one-n-two.txt');
                    await bucketNonAllowList.combine(sourceFiles, destinationFile, USER_PROJECT_OPTIONS);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    function createFileAsync(fileObject) {
                        return fileObject.file.save(fileObject.contents, USER_PROJECT_OPTIONS);
                    }
                });
                mocha_1.it('bucket#createNotification', doubleTest((options, done) => {
                    bucketNonAllowList.createNotification(topicName, options, (err, _notification) => {
                        notification = _notification;
                        done(err);
                    });
                }));
                mocha_1.it('bucket#exists', doubleTest((options, done) => {
                    bucketNonAllowList.exists(options, done);
                }));
                mocha_1.it('bucket#get', doubleTest((options, done) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    bucketNonAllowList.get(options, done);
                }));
                mocha_1.it('bucket#getMetadata', doubleTest((options, done) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    bucketNonAllowList.get(options, done);
                }));
                mocha_1.it('bucket#getNotifications', doubleTest((options, done) => {
                    bucketNonAllowList.getNotifications(options, done);
                }));
                mocha_1.it('bucket#makePrivate', doubleTest((options, done) => {
                    bucketNonAllowList.makePrivate(options, done);
                }));
                mocha_1.it('bucket#setMetadata', doubleTest((options, done) => {
                    bucketNonAllowList.setMetadata({ newMetadata: true }, options, done);
                }));
                mocha_1.it('bucket#setStorageClass', doubleTest((options, done) => {
                    bucketNonAllowList.setStorageClass('multi-regional', options, done);
                }));
                mocha_1.it('bucket#upload', doubleTest((options, done) => {
                    bucketNonAllowList.upload(FILES.big.path, options, done);
                }));
                mocha_1.it('file#copy', doubleTest((options, done) => {
                    file.copy('new-file.txt', options, done);
                }));
                mocha_1.it('file#createReadStream', doubleTest((options, done) => {
                    file
                        .createReadStream(options)
                        .on('error', done)
                        .on('end', done)
                        .on('data', common_1.util.noop);
                }));
                mocha_1.it('file#createResumableUpload', doubleTest((options, done) => {
                    file.createResumableUpload(options, (err, uri) => {
                        if (err) {
                            done(err);
                            return;
                        }
                        file
                            .createWriteStream({ uri })
                            .on('error', done)
                            .on('finish', done)
                            .end('Test data');
                    });
                }));
                mocha_1.it('file#download', doubleTest((options, done) => {
                    file.download(options, done);
                }));
                mocha_1.it('file#exists', doubleTest((options, done) => {
                    file.exists(options, done);
                }));
                mocha_1.it('file#get', doubleTest((options, done) => {
                    file.get(options, (err) => {
                        done(err);
                    });
                }));
                mocha_1.it('file#getMetadata', doubleTest((options, done) => {
                    file.getMetadata(options, done);
                }));
                mocha_1.it('file#makePrivate', doubleTest((options, done) => {
                    file.makePrivate(options, done);
                }));
                mocha_1.it('file#move', doubleTest((options, done) => {
                    const newFile = bucketNonAllowList.file(generateName());
                    file.move(newFile, options, err => {
                        if (err) {
                            done(err);
                            return;
                        }
                        // Re-create the file. The tests need it.
                        file.save('newcontent', options, done);
                    });
                }));
                mocha_1.it('file#rename', doubleTest((options, done) => {
                    const newFile = bucketNonAllowList.file(generateName());
                    file.rename(newFile, options, err => {
                        if (err) {
                            done(err);
                            return;
                        }
                        // Re-create the file. The tests need it.
                        file.save('newcontent', options, done);
                    });
                }));
                mocha_1.it('file#setMetadata', doubleTest((options, done) => {
                    file.setMetadata({ newMetadata: true }, options, done);
                }));
                mocha_1.it('file#setStorageClass', doubleTest((options, done) => {
                    file.setStorageClass('multi-regional', options, done);
                }));
                mocha_1.it('acl#add', doubleTest((options, done) => {
                    options = Object.assign({
                        entity: USER_ACCOUNT,
                        role: storage.acl.OWNER_ROLE,
                    }, options);
                    bucketNonAllowList.acl.add(options, done);
                }));
                mocha_1.it('acl#update', doubleTest((options, done) => {
                    options = Object.assign({
                        entity: USER_ACCOUNT,
                        role: storage.acl.WRITER_ROLE,
                    }, options);
                    bucketNonAllowList.acl.update(options, done);
                }));
                mocha_1.it('acl#get', doubleTest((options, done) => {
                    options = Object.assign({
                        entity: USER_ACCOUNT,
                    }, options);
                    bucketNonAllowList.acl.get(options, done);
                }));
                mocha_1.it('acl#delete', doubleTest((options, done) => {
                    options = Object.assign({
                        entity: USER_ACCOUNT,
                    }, options);
                    bucketNonAllowList.acl.delete(options, done);
                }));
                mocha_1.it('iam#getPolicy', doubleTest((options, done) => {
                    bucketNonAllowList.iam.getPolicy(options, done);
                }));
                mocha_1.it('iam#setPolicy', doubleTest((options, done) => {
                    bucket.iam.getPolicy((err, policy) => {
                        if (err) {
                            done(err);
                            return;
                        }
                        policy.bindings.push({
                            role: 'roles/storage.objectViewer',
                            members: ['allUsers'],
                        });
                        bucketNonAllowList.iam.setPolicy(policy, options, done);
                    });
                }));
                mocha_1.it('iam#testPermissions', doubleTest((options, done) => {
                    const tests = ['storage.buckets.delete'];
                    bucketNonAllowList.iam.testPermissions(tests, options, done);
                }));
                mocha_1.it('notification#get', doubleTest((options, done) => {
                    if (!notification) {
                        throw new Error('Notification was not successfully created.');
                    }
                    notification.get(options, done);
                }));
                mocha_1.it('notification#getMetadata', doubleTest((options, done) => {
                    if (!notification) {
                        throw new Error('Notification was not successfully created.');
                    }
                    notification.getMetadata(options, done);
                }));
                mocha_1.it('notification#delete', doubleTest((options, done) => {
                    if (!notification) {
                        throw new Error('Notification was not successfully created.');
                    }
                    notification.delete(options, done);
                }));
            });
        });
    });
    mocha_1.describe('write, read, and remove files', () => {
        mocha_1.before(async () => {
            function setHash(filesKey) {
                const file = FILES[filesKey];
                const hash = crypto.createHash('md5');
                return new Promise(resolve => fs
                    .createReadStream(file.path)
                    .on('data', hash.update.bind(hash))
                    .on('end', () => {
                    file.hash = hash.digest('base64');
                    resolve();
                }));
            }
            await Promise.all(Object.keys(FILES).map(key => setHash(key)));
        });
        mocha_1.it('should read/write from/to a file in a directory', done => {
            const file = bucket.file('directory/file');
            const contents = 'test';
            const writeStream = file.createWriteStream({ resumable: false });
            writeStream.write(contents);
            writeStream.end();
            writeStream.on('error', done);
            writeStream.on('finish', () => {
                let data = Buffer.from('', 'utf8');
                file
                    .createReadStream()
                    .on('error', done)
                    .on('data', (chunk) => {
                    data = Buffer.concat([data, chunk]);
                })
                    .on('end', () => {
                    assert.strictEqual(data.toString(), contents);
                    done();
                });
            });
        });
        mocha_1.it('should not push data when a file cannot be read', done => {
            const file = bucket.file('non-existing-file');
            let dataEmitted = false;
            file
                .createReadStream()
                .on('data', () => {
                dataEmitted = true;
            })
                .on('error', err => {
                assert.strictEqual(dataEmitted, false);
                assert.strictEqual(err.code, 404);
                done();
            });
        });
        mocha_1.it('should throw original error message on non JSON response on large metadata', async () => {
            const largeCustomMeta = (size) => {
                let str = '';
                for (let i = 0; i < size; i++) {
                    str += 'a';
                }
                return str;
            };
            const file = bucket.file('large-metadata-error-test');
            await assert.rejects(file.save('test', {
                resumable: false,
                metadata: {
                    metadata: {
                        custom: largeCustomMeta(2.1e6),
                    },
                },
            }), /Metadata part is too large/);
        });
        mocha_1.it('should read a byte range from a file', done => {
            bucket.upload(FILES.big.path, (err, file) => {
                assert.ifError(err);
                const fileSize = file.metadata.size;
                const byteRange = {
                    start: Math.floor((fileSize * 1) / 3),
                    end: Math.floor((fileSize * 2) / 3),
                };
                const expectedContentSize = byteRange.start + 1;
                let sizeStreamed = 0;
                file
                    .createReadStream(byteRange)
                    .on('data', chunk => {
                    sizeStreamed += chunk.length;
                })
                    .on('error', done)
                    .on('end', () => {
                    assert.strictEqual(sizeStreamed, expectedContentSize);
                    file.delete(done);
                });
            });
        });
        mocha_1.it('should support readable[Symbol.asyncIterator]()', async () => {
            const fileContents = fs.readFileSync(FILES.big.path);
            const [file] = await bucket.upload(FILES.big.path);
            const stream = file.createReadStream();
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const remoteContents = Buffer.concat(chunks).toString();
            assert.strictEqual(String(fileContents), String(remoteContents));
        });
        mocha_1.it('should download a file to memory', done => {
            const fileContents = fs.readFileSync(FILES.big.path);
            bucket.upload(FILES.big.path, (err, file) => {
                assert.ifError(err);
                file.download((err, remoteContents) => {
                    assert.ifError(err);
                    assert.strictEqual(String(fileContents), String(remoteContents));
                    done();
                });
            });
        });
        mocha_1.it('should handle non-network errors', done => {
            const file = bucket.file('hi.jpg');
            file.download(err => {
                assert.strictEqual(err.code, 404);
                done();
            });
        });
        mocha_1.it('should gzip a file on the fly and download it', done => {
            const options = {
                gzip: true,
            };
            const expectedContents = fs.readFileSync(FILES.html.path, 'utf-8');
            bucket.upload(FILES.html.path, options, (err, file) => {
                assert.ifError(err);
                file.download((err, contents) => {
                    assert.ifError(err);
                    assert.strictEqual(contents.toString(), expectedContents);
                    file.delete(done);
                });
            });
        });
        mocha_1.it('should upload a gzipped file and download it', done => {
            const options = {
                metadata: {
                    contentEncoding: 'gzip',
                    contentType: 'text/html',
                },
            };
            const expectedContents = normalizeNewline(fs.readFileSync(FILES.html.path, 'utf-8'));
            bucket.upload(FILES.gzip.path, options, (err, file) => {
                assert.ifError(err);
                // Sometimes this file is not found immediately; include some
                // retry to attempt to make the test less flaky.
                let attempt = 0;
                const downloadCallback = (err, contents) => {
                    // If we got an error, gracefully retry a few times.
                    if (err) {
                        attempt += 1;
                        if (attempt >= 5) {
                            return assert.ifError(err);
                        }
                        return file.download(downloadCallback);
                    }
                    // Ensure the contents match.
                    assert.strictEqual(contents.toString(), expectedContents);
                    file.delete(done);
                };
                file.download(downloadCallback);
            });
        });
        mocha_1.it('should skip validation if file is served decompressed', async () => {
            const filename = 'logo-gzipped.png';
            await bucket.upload(FILES.logo.path, { destination: filename, gzip: true });
            tmp.setGracefulCleanup();
            const { name: tmpFilePath } = tmp.fileSync();
            const file = bucket.file(filename);
            await new Promise((resolve, reject) => {
                file
                    .createReadStream()
                    .on('error', reject)
                    .on('response', raw => {
                    assert.strictEqual(raw.toJSON().headers['content-encoding'], undefined);
                })
                    .pipe(fs.createWriteStream(tmpFilePath))
                    .on('error', reject)
                    .on('finish', resolve);
            });
            await file.delete();
        });
        mocha_1.describe('simple write', () => {
            mocha_1.it('should save arbitrary data', done => {
                const file = bucket.file('TestFile');
                const data = 'hello';
                file.save(data, err => {
                    assert.ifError(err);
                    file.download((err, contents) => {
                        assert.strictEqual(contents.toString(), data);
                        done();
                    });
                });
            });
        });
        mocha_1.describe('stream write', () => {
            mocha_1.it('should stream write, then remove file (3mb)', done => {
                const file = bucket.file('LargeFile');
                fs.createReadStream(FILES.big.path)
                    .pipe(file.createWriteStream({ resumable: false }))
                    .on('error', done)
                    .on('finish', () => {
                    assert.strictEqual(file.metadata.md5Hash, FILES.big.hash);
                    file.delete(done);
                });
            });
            mocha_1.it('should write metadata', done => {
                const options = {
                    metadata: { contentType: 'image/png' },
                    resumable: false,
                };
                bucket.upload(FILES.logo.path, options, (err, file) => {
                    assert.ifError(err);
                    file.getMetadata((err, metadata) => {
                        assert.ifError(err);
                        assert.strictEqual(metadata.contentType, options.metadata.contentType);
                        file.delete(done);
                    });
                });
            });
            mocha_1.it('should resume an upload after an interruption', done => {
                fs.stat(FILES.big.path, (err, metadata) => {
                    assert.ifError(err);
                    // Use a random name to force an empty ConfigStore cache.
                    const file = bucket.file(generateName());
                    const fileSize = metadata.size;
                    upload({ interrupt: true }, err => {
                        assert.strictEqual(err.message, 'Interrupted.');
                        upload({ interrupt: false }, err => {
                            assert.ifError(err);
                            assert.strictEqual(Number(file.metadata.size), fileSize);
                            file.delete(done);
                        });
                    });
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    function upload(opts, callback) {
                        const ws = file.createWriteStream();
                        let sizeStreamed = 0;
                        const streamTransform = new stream_1.Transform({
                            transform(chunk, enc, next) {
                                sizeStreamed += chunk.length;
                                if (opts.interrupt && sizeStreamed >= fileSize / 2) {
                                    // stop sending data half way through.
                                    this.push(chunk);
                                    this.destroy();
                                    process.nextTick(() => {
                                        ws.destroy(new Error('Interrupted.'));
                                    });
                                }
                                else {
                                    this.push(chunk);
                                    next();
                                }
                            },
                        });
                        fs.createReadStream(FILES.big.path)
                            .pipe(streamTransform)
                            .pipe(ws)
                            .on('error', callback)
                            .on('finish', callback);
                    }
                });
            });
            mocha_1.it('should write/read/remove from a buffer', done => {
                tmp.setGracefulCleanup();
                tmp.file((err, tmpFilePath) => {
                    assert.ifError(err);
                    const file = bucket.file('MyBuffer');
                    const fileContent = 'Hello World';
                    const writable = file.createWriteStream();
                    writable.write(fileContent);
                    writable.end();
                    writable.on('finish', () => {
                        file
                            .createReadStream()
                            .on('error', done)
                            .pipe(fs.createWriteStream(tmpFilePath))
                            .on('error', done)
                            .on('finish', () => {
                            file.delete((err) => {
                                assert.ifError(err);
                                fs.readFile(tmpFilePath, (err, data) => {
                                    assert.strictEqual(data.toString(), fileContent);
                                    done();
                                });
                            });
                        });
                    });
                });
            });
        });
        mocha_1.describe('customer-supplied encryption keys', () => {
            const encryptionKey = crypto.randomBytes(32);
            const file = bucket.file('encrypted-file', {
                encryptionKey,
            });
            const unencryptedFile = bucket.file(file.name);
            mocha_1.before(done => {
                file.save('secret data', { resumable: false }, done);
            });
            mocha_1.it('should not get the hashes from the unencrypted file', done => {
                unencryptedFile.getMetadata((err, metadata) => {
                    assert.ifError(err);
                    assert.strictEqual(metadata.crc32c, undefined);
                    done();
                });
            });
            mocha_1.it('should get the hashes from the encrypted file', done => {
                file.getMetadata((err, metadata) => {
                    assert.ifError(err);
                    assert.notStrictEqual(metadata.crc32c, undefined);
                    done();
                });
            });
            mocha_1.it('should not download from the unencrypted file', done => {
                unencryptedFile.download(err => {
                    if (!err) {
                        done(new Error('Expected an error.'));
                        return;
                    }
                    assert(err.message.indexOf([
                        'The target object is encrypted by a',
                        'customer-supplied encryption key.',
                    ].join(' ')) > -1);
                    done();
                });
            });
            mocha_1.it('should download from the encrytped file', done => {
                file.download((err, contents) => {
                    assert.ifError(err);
                    assert.strictEqual(contents.toString(), 'secret data');
                    done();
                });
            });
            mocha_1.it('should rotate encryption keys', done => {
                const newEncryptionKey = crypto.randomBytes(32);
                file.rotateEncryptionKey(newEncryptionKey, err => {
                    assert.ifError(err);
                    file.download((err, contents) => {
                        assert.ifError(err);
                        assert.strictEqual(contents.toString(), 'secret data');
                        done();
                    });
                });
            });
        });
        mocha_1.describe('kms keys', () => {
            const FILE_CONTENTS = 'secret data';
            const BUCKET_LOCATION = 'us';
            let PROJECT_ID;
            let SERVICE_ACCOUNT_EMAIL;
            const keyRingId = generateName();
            const cryptoKeyId = generateName();
            const request = util_1.promisify(storage.request).bind(storage);
            let bucket;
            let kmsKeyName;
            let keyRingsBaseUrl;
            function setProjectId(projectId) {
                PROJECT_ID = projectId;
                keyRingsBaseUrl = `https://cloudkms.googleapis.com/v1/projects/${PROJECT_ID}/locations/${BUCKET_LOCATION}/keyRings`;
                kmsKeyName = generateKmsKeyName(cryptoKeyId);
            }
            function generateKmsKeyName(cryptoKeyId) {
                return `projects/${PROJECT_ID}/locations/${BUCKET_LOCATION}/keyRings/${keyRingId}/cryptoKeys/${cryptoKeyId}`;
            }
            async function createCryptoKeyAsync(cryptoKeyId) {
                // createCryptoKeyId
                await request({
                    method: 'POST',
                    uri: `${keyRingsBaseUrl}/${keyRingId}/cryptoKeys`,
                    qs: { cryptoKeyId },
                    json: { purpose: 'ENCRYPT_DECRYPT' },
                });
                // getServiceAccountEmail
                if (!SERVICE_ACCOUNT_EMAIL) {
                    const [serviceAccount] = await storage.getServiceAccount();
                    SERVICE_ACCOUNT_EMAIL = serviceAccount.emailAddress;
                }
                await request({
                    method: 'POST',
                    uri: `${keyRingsBaseUrl}/${keyRingId}/cryptoKeys/${cryptoKeyId}:setIamPolicy`,
                    json: {
                        policy: {
                            bindings: [
                                {
                                    role: 'roles/cloudkms.cryptoKeyEncrypterDecrypter',
                                    members: `serviceAccount:${SERVICE_ACCOUNT_EMAIL}`,
                                },
                            ],
                        },
                    },
                });
            }
            mocha_1.before(async () => {
                bucket = storage.bucket(generateName());
                setProjectId(await storage.authClient.getProjectId());
                await bucket.create({ location: BUCKET_LOCATION });
                // create keyRing
                await request({
                    method: 'POST',
                    uri: keyRingsBaseUrl,
                    qs: { keyRingId },
                });
                await createCryptoKeyAsync(cryptoKeyId);
            });
            mocha_1.describe('files', () => {
                let file;
                mocha_1.before(done => {
                    file = bucket.file('kms-encrypted-file', { kmsKeyName });
                    file.save(FILE_CONTENTS, { resumable: false }, done);
                });
                mocha_1.it('should have set kmsKeyName on created file', done => {
                    file.getMetadata((err, metadata) => {
                        assert.ifError(err);
                        // Strip the project ID, as it could be the placeholder locally, but
                        // the real value upstream.
                        const projectIdRegExp = /^.+\/locations/;
                        const actualKmsKeyName = metadata.kmsKeyName.replace(projectIdRegExp, '');
                        let expectedKmsKeyName = kmsKeyName.replace(projectIdRegExp, '');
                        // Upstream attaches a version.
                        expectedKmsKeyName = `${expectedKmsKeyName}/cryptoKeyVersions/1`;
                        assert.strictEqual(actualKmsKeyName, expectedKmsKeyName);
                        done();
                    });
                });
                mocha_1.it('should set kmsKeyName on resumable uploaded file', done => {
                    const file = bucket.file('resumable-file', { kmsKeyName });
                    file.save(FILE_CONTENTS, { resumable: true }, err => {
                        assert.ifError(err);
                        file.getMetadata((err, metadata) => {
                            assert.ifError(err);
                            // Strip the project ID, as it could be the placeholder locally,
                            // but the real value upstream.
                            const projectIdRegExp = /^.+\/locations/;
                            const actualKmsKeyName = metadata.kmsKeyName.replace(projectIdRegExp, '');
                            let expectedKmsKeyName = kmsKeyName.replace(projectIdRegExp, '');
                            // Upstream attaches a version.
                            expectedKmsKeyName = `${expectedKmsKeyName}/cryptoKeyVersions/1`;
                            assert.strictEqual(actualKmsKeyName, expectedKmsKeyName);
                            done();
                        });
                    });
                });
                mocha_1.it('should rotate encryption keys', async () => {
                    const cryptoKeyId = generateName();
                    const newKmsKeyName = generateKmsKeyName(cryptoKeyId);
                    await createCryptoKeyAsync(cryptoKeyId);
                    await file.rotateEncryptionKey({ kmsKeyName: newKmsKeyName });
                    const [contents] = await file.download();
                    assert.strictEqual(contents.toString(), FILE_CONTENTS);
                });
                mocha_1.it('should convert CSEK to KMS key', done => {
                    const encryptionKey = crypto.randomBytes(32);
                    const file = bucket.file('encrypted-file', { encryptionKey });
                    file.save(FILE_CONTENTS, { resumable: false }, err => {
                        assert.ifError(err);
                        file.rotateEncryptionKey({ kmsKeyName }, err => {
                            assert.ifError(err);
                            file.download((err, contents) => {
                                assert.ifError(err);
                                assert.strictEqual(contents.toString(), 'secret data');
                                done();
                            });
                        });
                    });
                });
            });
            mocha_1.describe('buckets', () => {
                let bucket;
                mocha_1.before(async () => {
                    bucket = storage.bucket(generateName(), { kmsKeyName });
                    await bucket.create();
                    await bucket.setMetadata({
                        encryption: {
                            defaultKmsKeyName: kmsKeyName,
                        },
                    });
                });
                mocha_1.after(done => {
                    bucket.setMetadata({
                        encryption: null,
                    }, done);
                });
                mocha_1.it('should have set defaultKmsKeyName on created bucket', done => {
                    bucket.getMetadata((err, metadata) => {
                        assert.ifError(err);
                        // Strip the project ID, as it could be the placeholder locally, but
                        // the real value upstream.
                        const projectIdRegExp = /^.+\/locations/;
                        const actualKmsKeyName = metadata.encryption.defaultKmsKeyName.replace(projectIdRegExp, '');
                        const expectedKmsKeyName = kmsKeyName.replace(projectIdRegExp, '');
                        assert.strictEqual(actualKmsKeyName, expectedKmsKeyName);
                        done();
                    });
                });
                mocha_1.it('should update the defaultKmsKeyName', async () => {
                    const cryptoKeyId = generateName();
                    const newKmsKeyName = generateKmsKeyName(cryptoKeyId);
                    await createCryptoKeyAsync(cryptoKeyId);
                    await bucket.setMetadata({
                        encryption: {
                            defaultKmsKeyName: newKmsKeyName,
                        },
                    });
                });
                mocha_1.it('should insert an object that inherits the kms key name', done => {
                    const file = bucket.file('kms-encrypted-file');
                    bucket.getMetadata((err, metadata) => {
                        assert.ifError(err);
                        const defaultKmsKeyName = metadata.encryption.defaultKmsKeyName;
                        file.save(FILE_CONTENTS, { resumable: false }, err => {
                            assert.ifError(err);
                            // Strip the project ID, as it could be the placeholder locally,
                            // but the real value upstream.
                            const projectIdRegExp = /^.+\/locations/;
                            const actualKmsKeyName = file.metadata.kmsKeyName.replace(projectIdRegExp, '');
                            let expectedKmsKeyName = defaultKmsKeyName.replace(projectIdRegExp, '');
                            // Upstream attaches a version.
                            expectedKmsKeyName = `${expectedKmsKeyName}/cryptoKeyVersions/1`;
                            assert.strictEqual(actualKmsKeyName, expectedKmsKeyName);
                            done();
                        });
                    });
                });
            });
        });
        mocha_1.it('should copy an existing file', async () => {
            const opts = { destination: 'CloudLogo' };
            const [file] = await bucket.upload(FILES.logo.path, opts);
            const [copiedFile] = await file.copy('CloudLogoCopy');
            await Promise.all([file.delete, copiedFile.delete()]);
        });
        mocha_1.it('should respect predefined Acl at file#copy', async () => {
            const opts = { destination: 'CloudLogo' };
            const [file] = await bucket.upload(FILES.logo.path, opts);
            const copyOpts = { predefinedAcl: 'publicRead' };
            const [copiedFile] = await file.copy('CloudLogoCopy', copyOpts);
            const publicAcl = await isFilePublicAsync(copiedFile);
            assert.strictEqual(publicAcl, true);
            await Promise.all([file.delete, copiedFile.delete()]);
        });
        mocha_1.it('should copy a large file', async () => {
            const otherBucket = storage.bucket(generateName());
            const file = bucket.file('Big');
            const copiedFile = otherBucket.file(file.name);
            await bucket.upload(FILES.logo.path, { destination: file });
            await otherBucket.create({
                location: 'ASIA-EAST1',
                dra: true,
            });
            await file.copy(copiedFile);
            await copiedFile.delete();
            await otherBucket.delete();
            await file.delete();
        });
        mocha_1.it('should copy to another bucket given a gs:// URL', done => {
            const opts = { destination: 'CloudLogo' };
            bucket.upload(FILES.logo.path, opts, (err, file) => {
                assert.ifError(err);
                const otherBucket = storage.bucket(generateName());
                otherBucket.create((err) => {
                    assert.ifError(err);
                    const destPath = 'gs://' + otherBucket.name + '/CloudLogoCopy';
                    file.copy(destPath, err => {
                        assert.ifError(err);
                        otherBucket.getFiles((err, files) => {
                            assert.ifError(err);
                            assert.strictEqual(files.length, 1);
                            const newFile = files[0];
                            assert.strictEqual(newFile.name, 'CloudLogoCopy');
                            done();
                        });
                    });
                });
            });
        });
        mocha_1.it('should allow changing the storage class', async () => {
            const file = bucket.file(generateName());
            await bucket.upload(FILES.logo.path, { destination: file });
            await file.setStorageClass('standard');
            const [metadata] = await file.getMetadata();
            assert.strictEqual(metadata.storageClass, 'STANDARD');
        });
    });
    mocha_1.describe('bucket upload with progress', () => {
        mocha_1.it('show bytes sent with resumable upload', async () => {
            const fileSize = fs.statSync(FILES.big.path).size;
            let called = false;
            function onUploadProgress(evt) {
                called = true;
                assert.strictEqual(typeof evt.bytesWritten, 'number');
                assert.ok(evt.bytesWritten >= 0 && evt.bytesWritten <= fileSize);
            }
            await bucket.upload(FILES.big.path, {
                resumable: true,
                onUploadProgress,
            });
            assert.strictEqual(called, true);
        });
        mocha_1.it('show bytes sent with simple upload', async () => {
            const fileSize = fs.statSync(FILES.big.path).size;
            let called = false;
            function onUploadProgress(evt) {
                called = true;
                assert.strictEqual(typeof evt.bytesWritten, 'number');
                assert.ok(evt.bytesWritten >= 0 && evt.bytesWritten <= fileSize);
            }
            await bucket.upload(FILES.big.path, {
                resumable: false,
                onUploadProgress,
            });
            assert.strictEqual(called, true);
        });
    });
    mocha_1.describe('channels', () => {
        mocha_1.it('should create a channel', done => {
            const config = {
                address: 'https://yahoo.com',
            };
            bucket.createChannel('new-channel', config, (err) => {
                // Actually creating a channel is pretty complicated. This will at least
                // let us know we reached the right endpoint and it received "yahoo.com".
                assert(err.message.includes(config.address));
                done();
            });
        });
        mocha_1.it('should stop a channel', done => {
            // We can't actually create a channel. But we can test to see that we're
            // reaching the right endpoint with the API request.
            const channel = storage.channel('id', 'resource-id');
            channel.stop(err => {
                assert.strictEqual(err.code, 404);
                assert.strictEqual(err.message.indexOf("Channel 'id' not found"), 0);
                done();
            });
        });
    });
    mocha_1.describe('combine files', () => {
        mocha_1.it('should combine multiple files into one', async () => {
            const files = [
                { file: bucket.file('file-one.txt'), contents: '123' },
                { file: bucket.file('file-two.txt'), contents: '456' },
            ];
            await Promise.all(files.map(file => createFileAsync(file)));
            const sourceFiles = files.map(x => x.file);
            let destinationFile = bucket.file('file-one-and-two.txt');
            [destinationFile] = await bucket.combine(sourceFiles, destinationFile);
            const [contents] = await destinationFile.download();
            assert.strictEqual(contents.toString(), files.map(x => x.contents).join(''));
            await Promise.all(sourceFiles.concat([destinationFile]).map(file => deleteFileAsync(file)));
        });
    });
    mocha_1.describe('HMAC keys', () => {
        // This is generally a valid service account for a project.
        const ALTERNATE_SERVICE_ACCOUNT = `${process.env.PROJECT_ID}@appspot.gserviceaccount.com`;
        const SERVICE_ACCOUNT = process.env.HMAC_KEY_TEST_SERVICE_ACCOUNT || ALTERNATE_SERVICE_ACCOUNT;
        const HMAC_PROJECT = process.env.HMAC_KEY_TEST_SERVICE_ACCOUNT
            ? process.env.HMAC_PROJECT
            : process.env.PROJECT_ID;
        // Second service account to test listing HMAC keys from different accounts.
        const SECOND_SERVICE_ACCOUNT = process.env.HMAC_KEY_TEST_SECOND_SERVICE_ACCOUNT;
        let accessId;
        mocha_1.before(async () => {
            await deleteStaleHmacKeys(SERVICE_ACCOUNT, HMAC_PROJECT);
            if (SECOND_SERVICE_ACCOUNT) {
                await deleteStaleHmacKeys(SECOND_SERVICE_ACCOUNT, HMAC_PROJECT);
            }
        });
        mocha_1.it('should create an HMAC key for a service account', async () => {
            const [hmacKey, secret] = await storage.createHmacKey(SERVICE_ACCOUNT, {
                projectId: HMAC_PROJECT,
            });
            // We should always get a 40 character secret, which is valid base64.
            assert.strictEqual(secret.length, 40);
            accessId = hmacKey.id;
            const metadata = hmacKey.metadata;
            assert.strictEqual(metadata.accessId, accessId);
            assert.strictEqual(metadata.state, 'ACTIVE');
            assert.strictEqual(metadata.projectId, HMAC_PROJECT);
            assert.strictEqual(metadata.serviceAccountEmail, SERVICE_ACCOUNT);
            assert(typeof metadata.etag === 'string');
            assert(typeof metadata.timeCreated === 'string');
            assert(typeof metadata.updated === 'string');
        });
        mocha_1.it('should get metadata for an HMAC key', async () => {
            const hmacKey = storage.hmacKey(accessId, { projectId: HMAC_PROJECT });
            const [metadata] = await hmacKey.getMetadata();
            assert.strictEqual(metadata.accessId, accessId);
        });
        mocha_1.it('should show up from getHmacKeys() without serviceAccountEmail param', async () => {
            const [hmacKeys] = await storage.getHmacKeys({ projectId: HMAC_PROJECT });
            assert(hmacKeys.length > 0);
            assert(hmacKeys.some(hmacKey => hmacKey.id === accessId), 'created HMAC key not found from getHmacKeys result');
        });
        mocha_1.it('should make the key INACTIVE', async () => {
            const hmacKey = storage.hmacKey(accessId, { projectId: HMAC_PROJECT });
            let [metadata] = await hmacKey.setMetadata({ state: 'INACTIVE' });
            assert.strictEqual(metadata.state, 'INACTIVE');
            [metadata] = await hmacKey.getMetadata();
            assert.strictEqual(metadata.state, 'INACTIVE');
        });
        mocha_1.it('should delete the key', async () => {
            const hmacKey = storage.hmacKey(accessId, { projectId: HMAC_PROJECT });
            await hmacKey.delete();
            const [metadata] = await hmacKey.getMetadata();
            assert.strictEqual(metadata.state, 'DELETED');
            assert.strictEqual(hmacKey.metadata.state, 'DELETED');
        });
        mocha_1.it('deleted key should not show up from getHmacKeys() by default', async () => {
            const [hmacKeys] = await storage.getHmacKeys({
                serviceAccountEmail: SERVICE_ACCOUNT,
                projectId: HMAC_PROJECT,
            });
            assert(Array.isArray(hmacKeys));
            assert(!hmacKeys.some(hmacKey => hmacKey.id === accessId), 'deleted HMAC key is found from getHmacKeys result');
        });
        mocha_1.describe('second service account', () => {
            let accessId;
            mocha_1.before(function () {
                if (!SECOND_SERVICE_ACCOUNT) {
                    this.skip();
                }
            });
            mocha_1.after(async () => {
                const hmacKey = storage.hmacKey(accessId, { projectId: HMAC_PROJECT });
                await hmacKey.setMetadata({ state: 'INACTIVE' });
                await hmacKey.delete();
            });
            mocha_1.it('should create key for a second service account', async () => {
                const [hmacKey] = await storage.createHmacKey(SECOND_SERVICE_ACCOUNT, {
                    projectId: HMAC_PROJECT,
                });
                accessId = hmacKey.id;
            });
            mocha_1.it('get HMAC keys for both service accounts', async () => {
                // Create a key for the first service account
                await storage.createHmacKey(SERVICE_ACCOUNT, {
                    projectId: HMAC_PROJECT,
                });
                const [hmacKeys] = await storage.getHmacKeys({ projectId: HMAC_PROJECT });
                assert(hmacKeys.some(hmacKey => hmacKey.metadata.serviceAccountEmail === SERVICE_ACCOUNT), `Expected at least 1 key for service account: ${SERVICE_ACCOUNT}`);
                assert(hmacKeys.some(hmacKey => hmacKey.metadata.serviceAccountEmail === SECOND_SERVICE_ACCOUNT), `Expected at least 1 key for service account: ${SECOND_SERVICE_ACCOUNT}`);
            });
            mocha_1.it('filter by service account email', async () => {
                const [hmacKeys] = await storage.getHmacKeys({
                    serviceAccountEmail: SECOND_SERVICE_ACCOUNT,
                    projectId: HMAC_PROJECT,
                });
                assert(hmacKeys.every(hmacKey => hmacKey.metadata.serviceAccountEmail === SECOND_SERVICE_ACCOUNT), 'HMAC key belonging to other service accounts unexpected');
            });
        });
    });
    mocha_1.describe('list files', () => {
        const DIRECTORY_NAME = 'directory-name';
        const NEW_FILES = [
            bucket.file('CloudLogo1'),
            bucket.file('CloudLogo2'),
            bucket.file('CloudLogo3'),
            bucket.file(`${DIRECTORY_NAME}/CloudLogo4`),
            bucket.file(`${DIRECTORY_NAME}/CloudLogo5`),
            bucket.file(`${DIRECTORY_NAME}/inner/CloudLogo6`),
        ];
        mocha_1.before(async () => {
            await bucket.deleteFiles();
            const originalFile = NEW_FILES[0];
            const cloneFiles = NEW_FILES.slice(1);
            await bucket.upload(FILES.logo.path, {
                destination: originalFile,
            });
            await Promise.all(cloneFiles.map(f => originalFile.copy(f)));
        });
        mocha_1.after(async () => {
            await Promise.all(NEW_FILES.map(file => deleteFileAsync(file)));
        });
        mocha_1.it('should get files', done => {
            bucket.getFiles((err, files) => {
                assert.ifError(err);
                assert.strictEqual(files.length, NEW_FILES.length);
                done();
            });
        });
        mocha_1.it('should get files as a stream', done => {
            let numFilesEmitted = 0;
            bucket
                .getFilesStream()
                .on('error', done)
                .on('data', () => {
                numFilesEmitted++;
            })
                .on('end', () => {
                assert.strictEqual(numFilesEmitted, NEW_FILES.length);
                done();
            });
        });
        mocha_1.it('should get files from a directory', done => {
            //Note: Directory is deprecated.
            bucket.getFiles({ directory: DIRECTORY_NAME }, (err, files) => {
                assert.ifError(err);
                assert.strictEqual(files.length, 3);
                done();
            });
        });
        mocha_1.it('should get files from a directory as a stream', done => {
            //Note: Directory is deprecated.
            let numFilesEmitted = 0;
            bucket
                .getFilesStream({ directory: DIRECTORY_NAME })
                .on('error', done)
                .on('data', () => {
                numFilesEmitted++;
            })
                .on('end', () => {
                assert.strictEqual(numFilesEmitted, 3);
                done();
            });
        });
        mocha_1.it('should paginate the list', done => {
            const query = {
                maxResults: NEW_FILES.length - 1,
            };
            bucket.getFiles(query, (err, files, nextQuery) => {
                assert.ifError(err);
                assert.strictEqual(files.length, NEW_FILES.length - 1);
                assert(nextQuery);
                bucket.getFiles(nextQuery, (err, files) => {
                    assert.ifError(err);
                    assert.strictEqual(files.length, 1);
                    done();
                });
            });
        });
    });
    mocha_1.describe('offset', () => {
        const NEW_FILES = [
            bucket.file('startOffset_file1'),
            bucket.file('startOffset_file2'),
            bucket.file('file3_endOffset'),
        ];
        mocha_1.before(async () => {
            await bucket.deleteFiles();
            const originalFile = NEW_FILES[0];
            const cloneFiles = NEW_FILES.slice(1);
            await bucket.upload(FILES.logo.path, {
                destination: originalFile,
            });
            await Promise.all(cloneFiles.map(f => originalFile.copy(f)));
        });
        mocha_1.after(async () => {
            await Promise.all(NEW_FILES.map(file => deleteFileAsync(file)));
        });
        mocha_1.it('should get files with offset', async () => {
            // Listing files with startOffset.
            const [filesWithStartOffset] = await bucket.getFiles({
                startOffset: 'startOffset',
            });
            assert.strictEqual(filesWithStartOffset.length, 2);
            // Listing files with endOffset.
            const [filesWithEndOffset] = await bucket.getFiles({
                endOffset: 'set',
            });
            assert.strictEqual(filesWithEndOffset.length, 1);
            // Listing files with startOffset and endOffset.
            const [filesWithStartAndEndOffset] = await bucket.getFiles({
                startOffset: 'startOffset',
                endOffset: 'endOffset',
            });
            assert.strictEqual(filesWithStartAndEndOffset.length, 0);
        });
    });
    mocha_1.describe('file generations', () => {
        const bucketWithVersioning = storage.bucket(generateName());
        mocha_1.before(done => {
            bucketWithVersioning.create({
                versioning: {
                    enabled: true,
                },
            }, done);
        });
        mocha_1.after(done => {
            bucketWithVersioning.deleteFiles({
                versions: true,
            }, err => {
                if (err) {
                    done(err);
                    return;
                }
                bucketWithVersioning.delete(done);
            });
        });
        mocha_1.it('should overwrite file, then get older version', done => {
            const versionedFile = bucketWithVersioning.file(generateName());
            versionedFile.save('a', err => {
                assert.ifError(err);
                versionedFile.getMetadata((err, metadata) => {
                    assert.ifError(err);
                    const initialGeneration = metadata.generation;
                    versionedFile.save('b', err => {
                        assert.ifError(err);
                        const firstGenFile = bucketWithVersioning.file(versionedFile.name, {
                            generation: initialGeneration,
                        });
                        firstGenFile.download((err, contents) => {
                            assert.ifError(err);
                            assert.strictEqual(contents.toString(), 'a');
                            done();
                        });
                    });
                });
            });
        });
        mocha_1.it('should get all files scoped to their version', async () => {
            const filesToCreate = [
                { file: bucketWithVersioning.file('file-one.txt'), contents: '123' },
                { file: bucketWithVersioning.file('file-one.txt'), contents: '456' },
            ];
            await Promise.all(filesToCreate.map(file => createFileAsync(file)));
            const [files] = await bucketWithVersioning.getFiles({ versions: true });
            assert.strictEqual(files[0].name, files[1].name);
            assert.notStrictEqual(files[0].metadata.generation, files[1].metadata.generation);
        });
        mocha_1.it('should throw an error Precondition Failed on overwrite with version 0, then save file with and without resumable', async () => {
            const fileName = `test-${Date.now()}.txt`;
            await bucketWithVersioning
                .file(fileName)
                .save('hello1', { resumable: false });
            await assert.rejects(async () => {
                await bucketWithVersioning
                    .file(fileName, { generation: 0 })
                    .save('hello2');
            }, {
                code: 412,
                message: 'Precondition Failed',
            });
            await bucketWithVersioning
                .file(fileName)
                .save('hello3', { resumable: false });
            await bucketWithVersioning.file(fileName).save('hello4');
        });
    });
    mocha_1.describe('v2 signed urls', () => {
        const localFile = fs.readFileSync(FILES.logo.path);
        let file;
        mocha_1.before(done => {
            file = bucket.file('LogoToSign.jpg');
            fs.createReadStream(FILES.logo.path)
                .pipe(file.createWriteStream())
                .on('error', done)
                .on('finish', done.bind(null, null));
        });
        mocha_1.it('should create a signed read url', async () => {
            const [signedReadUrl] = await file.getSignedUrl({
                version: 'v2',
                action: 'read',
                expires: Date.now() + 5000,
            });
            const res = await node_fetch_1.default(signedReadUrl);
            const body = await res.text();
            assert.strictEqual(body, localFile.toString());
        });
        mocha_1.it('should work with multi-valued extension headers', async () => {
            const HEADERS = {
                'x-goog-custom-header': ['value1', 'value2'],
            };
            const [signedReadUrl] = await file.getSignedUrl({
                action: 'read',
                expires: Date.now() + 5000,
                extensionHeaders: HEADERS,
            });
            const res = await node_fetch_1.default(signedReadUrl, {
                headers: { 'x-goog-custom-header': 'value1,value2' },
            });
            const body = await res.text();
            assert.strictEqual(body, localFile.toString());
        });
        mocha_1.it('should create a signed delete url', async () => {
            await file.delete();
            const [signedDeleteUrl] = await file.getSignedUrl({
                version: 'v2',
                action: 'delete',
                expires: Date.now() + 5000,
            });
            await node_fetch_1.default(signedDeleteUrl, { method: 'DELETE' });
            assert.rejects(() => file.getMetadata(), (err) => err.code === 404);
        });
    });
    mocha_1.describe('v2 signed url with special characters in file name', () => {
        const localFile = fs.readFileSync(FILES.logo.path);
        let file;
        mocha_1.before(done => {
            file = bucket.file("special/azAZ!*'()*%/file.jpg");
            fs.createReadStream(FILES.logo.path)
                .pipe(file.createWriteStream())
                .on('error', done)
                .on('finish', done.bind(null, null));
        });
        mocha_1.after(() => file.delete());
        mocha_1.it('should create a signed read url and fetch a file', async () => {
            const [signedUrl] = await file.getSignedUrl({
                version: 'v2',
                action: 'read',
                expires: Date.now() + 5000,
            });
            const res = await node_fetch_1.default(signedUrl);
            const body = await res.text();
            assert.strictEqual(body, localFile.toString());
        });
    });
    mocha_1.describe('v4 signed urls', () => {
        const localFile = fs.readFileSync(FILES.logo.path);
        let file;
        mocha_1.before(done => {
            file = bucket.file('LogoToSign.jpg');
            fs.createReadStream(FILES.logo.path)
                .pipe(file.createWriteStream())
                .on('error', done)
                .on('finish', done.bind(null, null));
        });
        mocha_1.it('should create a signed read url', async () => {
            const [signedReadUrl] = await file.getSignedUrl({
                version: 'v4',
                action: 'read',
                expires: Date.now() + 5000,
            });
            const res = await node_fetch_1.default(signedReadUrl);
            const body = await res.text();
            assert.strictEqual(body, localFile.toString());
        });
        mocha_1.it('should create a signed read url with accessibleAt in the past', async () => {
            const [signedReadUrl] = await file.getSignedUrl({
                version: 'v4',
                action: 'read',
                accessibleAt: Date.now() - 5000,
                expires: Date.now() + 5000,
            });
            const res = await node_fetch_1.default(signedReadUrl);
            const body = await res.text();
            assert.strictEqual(body, localFile.toString());
        });
        mocha_1.it('should create a signed read url with accessibleAt in the future', async () => {
            const accessibleAtDate = new Date();
            const accessibleAtMinutes = accessibleAtDate.getMinutes();
            const expiresDate = new Date();
            const expiresMinutes = expiresDate.getMinutes();
            const [signedReadUrl] = await file.getSignedUrl({
                version: 'v4',
                action: 'read',
                accessibleAt: accessibleAtDate.setMinutes(accessibleAtMinutes + 60),
                expires: expiresDate.setMinutes(expiresMinutes + 90),
            });
            const res = await node_fetch_1.default(signedReadUrl);
            assert.strictEqual(res.status, 403);
        });
        mocha_1.it('should work with special characters in extension headers', async () => {
            const HEADERS = {
                'x-goog-custom-header': ['value1', "azAZ!*'()*%"],
            };
            const [signedReadUrl] = await file.getSignedUrl({
                version: 'v4',
                action: 'read',
                expires: Date.now() + 5000,
                extensionHeaders: HEADERS,
            });
            const res = await node_fetch_1.default(signedReadUrl, {
                headers: { 'x-goog-custom-header': "value1,azAZ!*'()*%" },
            });
            const body = await res.text();
            assert.strictEqual(body, localFile.toString());
        });
        mocha_1.it('should create a virtual-hosted style URL', async () => {
            const [signedUrl] = await file.getSignedUrl({
                virtualHostedStyle: true,
                version: 'v4',
                action: 'read',
                expires: Date.now() + 5000,
            });
            const res = await node_fetch_1.default(signedUrl);
            const body = await res.text();
            assert.strictEqual(body, localFile.toString());
        });
        mocha_1.it('should create a signed delete url', async () => {
            const [signedDeleteUrl] = await file.getSignedUrl({
                version: 'v4',
                action: 'delete',
                expires: Date.now() + 5000,
            });
            await node_fetch_1.default(signedDeleteUrl, { method: 'DELETE' });
            const [exists] = await file.exists();
            assert.strictEqual(exists, false);
        });
        mocha_1.it('should create a signed list bucket url', async () => {
            const [signedUrl] = await bucket.getSignedUrl({
                version: 'v4',
                action: 'list',
                expires: Date.now() + 5000,
            });
            const res = await node_fetch_1.default(signedUrl, { method: 'GET' });
            const body = await res.text();
            assert.strictEqual(res.status, 200);
            assert(body.includes('ListBucketResult'));
        });
    });
    mocha_1.describe('v4 signed url with special characters in file name', () => {
        const localFile = fs.readFileSync(FILES.logo.path);
        let file;
        mocha_1.before(done => {
            file = bucket.file("special/azAZ!*'()*%/file.jpg");
            fs.createReadStream(FILES.logo.path)
                .pipe(file.createWriteStream())
                .on('error', done)
                .on('finish', done.bind(null, null));
        });
        mocha_1.after(async () => file.delete());
        mocha_1.it('should create a signed read url and fetch a file', async () => {
            const [signedUrl] = await file.getSignedUrl({
                version: 'v4',
                action: 'read',
                expires: Date.now() + 5000,
            });
            const res = await node_fetch_1.default(signedUrl);
            const body = await res.text();
            assert.strictEqual(body, localFile.toString());
        });
    });
    mocha_1.describe('sign policy', () => {
        let file;
        mocha_1.before(() => {
            file = bucket.file('LogoToSign.jpg');
        });
        mocha_1.beforeEach(function () {
            if (!storage.projectId) {
                this.skip();
            }
        });
        mocha_1.it('should create a V2 policy', async () => {
            const expires = Date.now() + 60 * 1000; // one minute
            const expectedExpiration = new Date(expires).toISOString();
            const options = {
                equals: ['$Content-Type', 'image/jpeg'],
                expires,
                contentLengthRange: {
                    min: 0,
                    max: 1024,
                },
            };
            const [policy] = await file.generateSignedPostPolicyV2(options);
            const policyJson = JSON.parse(policy.string);
            assert.strictEqual(policyJson.expiration, expectedExpiration);
        });
        mocha_1.it('should create a V4 policy', async () => {
            const expires = Date.now() + 60 * 1000; // one minute
            const options = {
                expires,
                contentLengthRange: {
                    min: 0,
                    max: 50000,
                },
                fields: { 'x-goog-meta-test': 'data' },
            };
            const [policy] = await file.generateSignedPostPolicyV4(options);
            const form = new FormData();
            for (const [key, value] of Object.entries(policy.fields)) {
                form.append(key, value);
            }
            const CONTENT = 'my-content';
            form.append('file', CONTENT);
            const res = await node_fetch_1.default(policy.url, { method: 'POST', body: form });
            assert.strictEqual(res.status, 204);
            const [buf] = await file.download();
            assert.strictEqual(buf.toString(), CONTENT);
        });
    });
    mocha_1.describe('notifications', () => {
        let notification;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let subscription;
        mocha_1.before(() => {
            return bucket
                .createNotification(topic, {
                eventTypes: ['OBJECT_FINALIZE'],
            })
                .then(data => {
                notification = data[0];
                subscription = topic.subscription(generateName());
                return subscription.create();
            });
        });
        mocha_1.after(() => {
            return (subscription
                .delete()
                .then(() => {
                return bucket.getNotifications();
            })
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .then((data) => {
                return Promise.all(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data[0].map((notification) => {
                    return notification.delete();
                }));
            }));
        });
        mocha_1.it('should get an existing notification', done => {
            notification.get(err => {
                assert.ifError(err);
                assert(Object.keys(notification.metadata).length > 0);
                done();
            });
        });
        mocha_1.it('should get a notifications metadata', done => {
            notification.getMetadata((err, metadata) => {
                assert.ifError(err);
                assert(metadata !== null && typeof metadata === 'object');
                done();
            });
        });
        mocha_1.it('should tell us if a notification exists', done => {
            notification.exists((err, exists) => {
                assert.ifError(err);
                assert(exists);
                done();
            });
        });
        mocha_1.it('should tell us if a notification does not exist', done => {
            const notification = bucket.notification('123');
            notification.exists((err, exists) => {
                assert.ifError(err);
                assert.strictEqual(exists, false);
                done();
            });
        });
        mocha_1.it('should get a list of notifications', done => {
            bucket.getNotifications((err, notifications) => {
                assert.ifError(err);
                assert.strictEqual(notifications.length, 1);
                done();
            });
        });
        mocha_1.it('should emit events to a subscription', done => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            subscription.on('error', done).on('message', (message) => {
                const attrs = message.attributes;
                assert.strictEqual(attrs.eventType, 'OBJECT_FINALIZE');
                done();
            });
            bucket.upload(FILES.logo.path, (err) => {
                if (err) {
                    done(err);
                }
            });
        });
        mocha_1.it('should delete a notification', () => {
            let notificationCount = 0;
            let notification;
            return bucket
                .createNotification(topic, {
                eventTypes: ['OBJECT_DELETE'],
            })
                .then(data => {
                notification = data[0];
                return bucket.getNotifications();
            })
                .then(data => {
                notificationCount = data[0].length;
                return notification.delete();
            })
                .then(() => {
                return bucket.getNotifications();
            })
                .then(data => {
                assert.strictEqual(data[0].length, notificationCount - 1);
            });
        });
    });
    async function deleteBucketAsync(bucket, options) {
        // After files are deleted, eventual consistency may require a bit of a
        // delay to ensure that the bucket recognizes that the files don't exist
        // anymore.
        const CONSISTENCY_DELAY_MS = 250;
        options = Object.assign({}, options, {
            versions: true,
        });
        await bucket.deleteFiles(options);
        await new Promise(resolve => setTimeout(resolve, CONSISTENCY_DELAY_MS));
        await bucket.delete();
    }
    function deleteBucket(bucket, optsOrCb, callback) {
        let options = typeof optsOrCb === 'object' ? optsOrCb : {};
        callback =
            typeof optsOrCb === 'function'
                ? optsOrCb
                : callback;
        // After files are deleted, eventual consistency may require a bit of a
        // delay to ensure that the bucket recognizes that the files don't exist
        // anymore.
        const CONSISTENCY_DELAY_MS = 250;
        options = Object.assign({}, options, {
            versions: true,
        });
        bucket.deleteFiles(options, err => {
            if (err) {
                callback(err);
                return;
            }
            setTimeout(() => {
                bucket.delete(options, callback);
            }, CONSISTENCY_DELAY_MS);
        });
    }
    function deleteFileAsync(file) {
        return file.delete();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function deleteTopicAsync(topic) {
        return topic.delete();
    }
    function shortUUID() {
        return uuid.v1().split('-').shift();
    }
    function generateName() {
        return TESTS_PREFIX + shortUUID();
    }
    async function deleteAllBucketsAsync() {
        const [buckets] = await storage.getBuckets({ prefix: TESTS_PREFIX });
        const limit = pLimit(10);
        await new Promise(resolve => setTimeout(resolve, RETENTION_DURATION_SECONDS * 1000));
        return Promise.all(buckets.map(bucket => limit(() => deleteBucketAsync(bucket))));
    }
    async function deleteAllTopicsAsync() {
        const [topics] = await pubsub.getTopics();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filteredTopics = topics.filter(topic => {
            return topic.name.indexOf(TESTS_PREFIX) > -1;
        });
        const limit = pLimit(10);
        return Promise.all(filteredTopics.map(topic => limit(() => deleteTopicAsync(topic))));
    }
    async function isFilePublicAsync(file) {
        try {
            const [aclObject] = await file.acl.get({ entity: 'allUsers' });
            if (aclObject.entity === 'allUsers' &&
                aclObject.role === 'READER') {
                return true;
            }
            else {
                return false;
            }
        }
        catch (error) {
            if (error.code === 404) {
                return false;
            }
            else {
                throw error;
            }
        }
    }
    async function deleteStaleHmacKeys(serviceAccountEmail, projectId) {
        const old = new Date();
        old.setHours(old.getHours() - 1);
        const [hmacKeys] = await storage.getHmacKeys({
            serviceAccountEmail,
            projectId,
        });
        const limit = pLimit(10);
        await Promise.all(hmacKeys
            .filter(hmacKey => {
            const hmacKeyCreated = new Date(hmacKey.metadata.timeCreated);
            return hmacKey.metadata.state !== 'DELETED' && hmacKeyCreated < old;
        })
            .map(hmacKey => limit(async () => {
            await hmacKey.setMetadata({ state: 'INACTIVE' });
            await hmacKey.delete();
        })));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function createFileAsync(fileObject) {
        return fileObject.file.save(fileObject.contents);
    }
    function createFileWithContentPromise(content) {
        return bucket.file(`${generateName()}.txt`).save(content);
    }
});
//# sourceMappingURL=storage.js.map