"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Copyright 2020 Google LLC
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
const assert = require("assert");
const dateFormat = require("date-and-time");
const crypto = require("crypto");
const sinon = require("sinon");
const mocha_1 = require("mocha");
const signer_1 = require("../src/signer");
const util_1 = require("../src/util");
mocha_1.describe('signer', () => {
    const BUCKET_NAME = 'bucket-name';
    const FILE_NAME = 'file-name.png';
    const CLIENT_EMAIL = 'client-email';
    let sandbox;
    mocha_1.beforeEach(() => (sandbox = sinon.createSandbox()));
    mocha_1.afterEach(() => sandbox.restore());
    mocha_1.describe('URLSigner', () => {
        let authClient;
        let bucket;
        let file;
        const NOW = new Date('2019-03-18T00:00:00Z');
        let fakeTimers;
        mocha_1.beforeEach(() => (fakeTimers = sinon.useFakeTimers(NOW)));
        mocha_1.afterEach(() => fakeTimers.restore());
        mocha_1.beforeEach(() => {
            authClient = {
                sign: async () => 'signature',
                getCredentials: async () => ({ client_email: CLIENT_EMAIL }),
            };
            bucket = { name: BUCKET_NAME };
            file = { name: FILE_NAME };
        });
        mocha_1.describe('URLSigner constructor', () => {
            let signer;
            mocha_1.beforeEach(() => {
                signer = new signer_1.URLSigner(authClient, bucket, file);
            });
            mocha_1.it('should localize authClient', () => {
                assert.strictEqual(signer['authClient'], authClient);
            });
            mocha_1.it('should localize bucket', () => {
                assert.strictEqual(signer['bucket'], bucket);
            });
            mocha_1.it('should localize file', () => {
                assert.strictEqual(signer['file'], file);
            });
        });
        mocha_1.describe('getSignedUrl', () => {
            let signer;
            let CONFIG;
            mocha_1.beforeEach(() => {
                signer = new signer_1.URLSigner(authClient, bucket, file);
                CONFIG = {
                    method: 'GET',
                    expires: new Date().valueOf() + 2000,
                };
            });
            mocha_1.describe('version', () => {
                mocha_1.it('should default to v2 if version is not given', async () => {
                    const v2 = sandbox
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .stub(signer, 'getSignedUrlV2')
                        .resolves({});
                    await signer.getSignedUrl(CONFIG);
                    assert(v2.calledOnce);
                });
                mocha_1.it('should use v2 if set', async () => {
                    CONFIG = {
                        version: 'v2',
                        contentMd5: 'md5',
                        contentType: 'application/json',
                        extensionHeaders: {
                            key: 'value',
                        },
                        ...CONFIG,
                    };
                    const v2 = sandbox
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .stub(signer, 'getSignedUrlV2')
                        .resolves({});
                    await signer.getSignedUrl(CONFIG);
                    assert(v2.calledOnce);
                    const v2arg = v2.getCall(0).args[0];
                    assert.strictEqual(v2arg.bucket, bucket.name);
                    assert.strictEqual(v2arg.method, CONFIG.method);
                    assert.strictEqual(v2arg.contentMd5, CONFIG.contentMd5);
                    assert.strictEqual(v2arg.contentType, CONFIG.contentType);
                    assert.deepStrictEqual(v2arg.extensionHeaders, CONFIG.extensionHeaders);
                });
                mocha_1.it('should use v4 if set', async () => {
                    CONFIG = {
                        version: 'v4',
                        contentMd5: 'md5',
                        contentType: 'application/json',
                        extensionHeaders: {
                            key: 'value',
                        },
                        ...CONFIG,
                    };
                    const v4 = sandbox
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .stub(signer, 'getSignedUrlV4')
                        .resolves({});
                    await signer.getSignedUrl(CONFIG);
                    assert(v4.calledOnce);
                    const v4arg = v4.getCall(0).args[0];
                    assert.strictEqual(v4arg.bucket, bucket.name);
                    assert.strictEqual(v4arg.method, CONFIG.method);
                    assert.strictEqual(v4arg.contentMd5, CONFIG.contentMd5);
                    assert.strictEqual(v4arg.contentType, CONFIG.contentType);
                    assert.deepStrictEqual(v4arg.extensionHeaders, CONFIG.extensionHeaders);
                });
                mocha_1.it('should error for an invalid version', () => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    CONFIG.version = 'v42';
                    assert.throws(() => signer.getSignedUrl(CONFIG), /Invalid signed URL version: v42\. Supported versions are 'v2' and 'v4'\./);
                });
            });
            mocha_1.describe('accessibleAt', () => {
                const accessibleAtNumber = 1581984000000; //2020-02-17T16:00:00-08:00
                const expiresNumber = accessibleAtNumber + 86400000; //2020-02-18T16:00:00-08:00
                mocha_1.it('should set correct settings if accessibleAt provided', async () => {
                    const authClientSign = sandbox.stub(authClient, 'sign').resolves('signature');
                    const accessibleAt = new Date(accessibleAtNumber);
                    await signer.getSignedUrl({
                        version: 'v4',
                        method: 'GET',
                        accessibleAt,
                        expires: expiresNumber,
                    });
                    const blobToSign = authClientSign.getCall(0).args[0];
                    assert(blobToSign.includes(dateFormat.format(accessibleAt, 'YYYYMMDD[T]HHmmss[Z]', true)));
                });
                mocha_1.it('should throw if an expiration date from the before accessibleAt date is given', () => {
                    const accessibleAt = accessibleAtNumber;
                    const expires = accessibleAt - 86400000;
                    assert.throws(() => {
                        signer.getSignedUrl({
                            version: 'v4',
                            method: 'GET',
                            accessibleAt,
                            expires,
                        });
                    }, /An expiration date cannot be before accessible date\./);
                });
                mocha_1.describe('checkInputTypes', () => {
                    const query = {
                        'X-Goog-Date': dateFormat.format(new Date(accessibleAtNumber), 'YYYYMMDD[T]HHmmss[Z]', true),
                    };
                    mocha_1.it('should accept Date objects', async () => {
                        const accessibleAt = new Date(accessibleAtNumber);
                        const signedUrl = await signer.getSignedUrl({
                            version: 'v4',
                            method: 'GET',
                            accessibleAt,
                            expires: expiresNumber,
                        });
                        assert(signedUrl.includes(util_1.qsStringify(query)));
                    });
                    mocha_1.it('should accept numbers', async () => {
                        const accessibleAt = accessibleAtNumber;
                        const signedUrl = await signer.getSignedUrl({
                            version: 'v4',
                            method: 'GET',
                            accessibleAt,
                            expires: expiresNumber,
                        });
                        assert(signedUrl.includes(util_1.qsStringify(query)));
                    });
                    mocha_1.it('should accept strings', async () => {
                        const accessibleAt = '2020-02-17T16:00:00-08:00';
                        const signedUrl = await signer.getSignedUrl({
                            version: 'v4',
                            method: 'GET',
                            accessibleAt,
                            expires: expiresNumber,
                        });
                        assert(signedUrl.includes(util_1.qsStringify(query)));
                    });
                    mocha_1.it('should throw if a date is invalid', () => {
                        const accessibleAt = new Date('31-12-2019');
                        assert.throws(() => {
                            signer.getSignedUrl({
                                version: 'v4',
                                method: 'GET',
                                accessibleAt,
                                expires: expiresNumber,
                            });
                        }, /The accessible at date provided was invalid\./);
                    });
                });
            });
            mocha_1.describe('expires', () => {
                mocha_1.it('should parse Date object into expiration seconds', async () => {
                    const parseExpires = sandbox
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .spy(signer, 'parseExpires');
                    const v2 = sandbox
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .stub(signer, 'getSignedUrlV2')
                        .resolves({});
                    await signer.getSignedUrl(CONFIG);
                    assert(parseExpires.calledOnceWith(CONFIG.expires));
                    const expiresInSeconds = parseExpires.getCall(0).lastArg;
                    assert(v2.getCall(0).args[0].expiration, expiresInSeconds);
                });
            });
            mocha_1.describe('URL style', () => {
                let v2;
                mocha_1.beforeEach(() => {
                    v2 = sandbox
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .stub(signer, 'getSignedUrlV2')
                        .resolves({});
                });
                mocha_1.it('should pass cname', async () => {
                    CONFIG.cname = 'http://www.example.com';
                    const url = await signer.getSignedUrl(CONFIG);
                    const v2arg = v2.getCall(0).args[0];
                    assert.strictEqual(v2arg.cname, CONFIG.cname);
                    assert(url.startsWith(CONFIG.cname));
                });
                mocha_1.it('should pass virtual host to cname', async () => {
                    CONFIG.virtualHostedStyle = true;
                    const expectedCname = `https://${bucket.name}.storage.googleapis.com`;
                    await signer.getSignedUrl(CONFIG);
                    const v2arg = v2.getCall(0).args[0];
                    assert.strictEqual(v2arg.cname, expectedCname);
                });
                mocha_1.it('should take precedence in cname if both passed', async () => {
                    CONFIG = {
                        virtualHostedStyle: true,
                        cname: 'http://www.example.com',
                        ...CONFIG,
                    };
                    await signer.getSignedUrl(CONFIG);
                    const v2arg = v2.getCall(0).args[0];
                    assert.strictEqual(v2arg.cname, CONFIG.cname);
                });
                mocha_1.it('should not pass cname parameter', async () => {
                    CONFIG = {
                        virtualHostedStyle: false,
                        cname: undefined,
                        ...CONFIG,
                    };
                    await signer.getSignedUrl(CONFIG);
                    const v2arg = v2.getCall(0).args[0];
                    assert.strictEqual(v2arg.cname, undefined);
                });
            });
            mocha_1.describe('composing signed URL', () => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                let v2;
                const query = {
                    GoogleAccessId: CLIENT_EMAIL,
                    Expires: NOW.valueOf() + 2000,
                    Signature: 'signature',
                };
                mocha_1.beforeEach(() => {
                    v2 = sandbox
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .stub(signer, 'getSignedUrlV2')
                        .resolves(query);
                });
                mocha_1.it('shuold insert user-provided queryParams', async () => {
                    CONFIG.queryParams = { key: 'AZ!*()*%/f' };
                    const url = await signer.getSignedUrl(CONFIG);
                    assert(url.includes(util_1.qsStringify({
                        ...query,
                        ...CONFIG.queryParams,
                    })));
                });
            });
            mocha_1.it('should URI encode file name with special characters', async () => {
                file.name = "special/azAZ!*'()*%/file.jpg";
                const encoded = util_1.encodeURI(file.name, false);
                const signedUrl = await signer.getSignedUrl(CONFIG);
                const v2 = sandbox
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .stub(signer, 'getSignedUrlV2')
                    .resolves({});
                await signer.getSignedUrl(CONFIG);
                const v2arg = v2.getCall(0).args[0];
                assert.strictEqual(v2arg.file, encoded);
                assert(signedUrl.includes(encoded));
            });
            mocha_1.it('should generate URL with given cname', async () => {
                CONFIG.cname = 'http://www.example.com';
                const signedUrl = await signer.getSignedUrl(CONFIG);
                assert(signedUrl.startsWith(CONFIG.cname));
            });
            mocha_1.it('should remove trailing slashes from cname', async () => {
                CONFIG.cname = 'http://www.example.com//';
                const signedUrl = await signer.getSignedUrl(CONFIG);
                assert(signedUrl.startsWith(`http://www.example.com/${file.name}`));
            });
            mocha_1.it('should generate virtual hosted style URL', async () => {
                CONFIG.virtualHostedStyle = true;
                const signedUrl = await signer.getSignedUrl(CONFIG);
                assert(signedUrl.startsWith(`https://${bucket.name}.storage.googleapis.com/${file.name}`));
            });
            mocha_1.it('should generate path styled URL', async () => {
                CONFIG.virtualHostedStyle = false;
                const signedUrl = await signer.getSignedUrl(CONFIG);
                assert(signedUrl.startsWith(signer_1.PATH_STYLED_HOST));
            });
            mocha_1.it('should generate URL with returned query params appended', async () => {
                const query = {
                    'X-Goog-Foo': 'value',
                    'X-Goog-Bar': 'azAZ!*()*%',
                };
                sandbox
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .stub(signer, 'getSignedUrlV2')
                    .resolves(query);
                const signedUrl = await signer.getSignedUrl(CONFIG);
                assert(signedUrl.includes(util_1.qsStringify(query)));
            });
        });
        mocha_1.describe('getSignedUrlV2', () => {
            let signer;
            let CONFIG;
            mocha_1.beforeEach(() => {
                signer = new signer_1.URLSigner(authClient, bucket, file);
                CONFIG = {
                    method: 'GET',
                    expiration: Math.floor((NOW.valueOf() + 2000) / 1000),
                    bucket: bucket.name,
                    file: file.name,
                };
            });
            mocha_1.describe('blobToSign', () => {
                let authClientSign;
                mocha_1.beforeEach(() => {
                    authClientSign = sandbox
                        .stub(authClient, 'sign')
                        .resolves('signature');
                });
                mocha_1.it('should sign method', async () => {
                    await signer['getSignedUrlV2'](CONFIG);
                    const blobToSign = authClientSign.getCall(0).args[0];
                    assert(blobToSign.startsWith('GET'));
                });
                mocha_1.it('should sign contentMd5 if given', async () => {
                    CONFIG.contentMd5 = 'md5-hash';
                    await signer['getSignedUrlV2'](CONFIG);
                    const blobToSign = authClientSign.getCall(0).args[0];
                    assert(blobToSign.includes(CONFIG.contentMd5));
                });
                mocha_1.it('should sign contentType if given', async () => {
                    CONFIG.contentType = 'application/octet-stream';
                    await signer['getSignedUrlV2'](CONFIG);
                    const blobToSign = authClientSign.getCall(0).args[0];
                    assert(blobToSign.includes(CONFIG.contentType));
                });
                mocha_1.it('should sign expiration', async () => {
                    await signer['getSignedUrlV2'](CONFIG);
                    const blobToSign = authClientSign.getCall(0).args[0];
                    assert(blobToSign.includes(CONFIG.expiration.toString(10)));
                });
                mocha_1.it('should sign canonical headers', async () => {
                    sandbox
                        .stub(signer, 'getCanonicalHeaders')
                        .returns('canonical-headers');
                    await signer['getSignedUrlV2'](CONFIG);
                    const blobToSign = authClientSign.getCall(0).args[0];
                    assert(blobToSign.includes('canonical-headers'));
                });
                mocha_1.it('should sign resource path', async () => {
                    sandbox.stub(signer, 'getResourcePath').returns('/resource/path');
                    await signer['getSignedUrlV2'](CONFIG);
                    const blobToSign = authClientSign.getCall(0).args[0];
                    assert(blobToSign.endsWith('/resource/path'));
                });
                mocha_1.it('should compose blobToSign without contentMd5 and contentType', async () => {
                    sandbox
                        .stub(signer, 'getCanonicalHeaders')
                        .returns('canonical-headers');
                    sandbox.stub(signer, 'getResourcePath').returns('/resource/path');
                    await signer['getSignedUrlV2'](CONFIG);
                    const blobToSign = authClientSign.getCall(0).args[0];
                    assert.strictEqual(blobToSign, [
                        'GET',
                        '',
                        '',
                        CONFIG.expiration,
                        'canonical-headers' + '/resource/path',
                    ].join('\n'));
                });
            });
            mocha_1.it('should return v2 query', async () => {
                const query = (await signer['getSignedUrlV2'](CONFIG));
                assert.deepStrictEqual(query, {
                    GoogleAccessId: CLIENT_EMAIL,
                    Expires: CONFIG.expiration,
                    Signature: 'signature',
                });
            });
            mocha_1.it('rejects with SigningError on signing Error', () => {
                const err = new Error('my-err');
                err.stack = 'some-stack-trace';
                sandbox.stub(authClient, 'sign').rejects(err);
                assert.rejects(() => signer['getSignedUrlV2'](CONFIG), {
                    name: 'SigningError',
                    message: 'my-err',
                    stack: 'some-stack-trace',
                });
            });
        });
        mocha_1.describe('getSignedUrlV4', () => {
            let signer;
            let CONFIG;
            mocha_1.beforeEach(() => {
                signer = new signer_1.URLSigner(authClient, bucket, file);
                CONFIG = {
                    method: 'GET',
                    expiration: Math.floor((NOW.valueOf() + 2000) / 1000),
                    bucket: bucket.name,
                };
            });
            mocha_1.it('should fail for expirations beyond 7 days', () => {
                CONFIG.expiration = NOW.valueOf() + 7.1 * 24 * 60 * 60;
                const SEVEN_DAYS = 7 * 24 * 60 * 60;
                assert.throws(() => {
                    signer['getSignedUrlV4'](CONFIG);
                }, {
                    message: `Max allowed expiration is seven days (${SEVEN_DAYS} seconds).`,
                });
            });
            mocha_1.describe('headers', () => {
                mocha_1.it('should add path-styled host header', async () => {
                    const getCanonicalHeaders = sandbox
                        .stub(signer, 'getCanonicalHeaders')
                        .returns('');
                    await signer['getSignedUrlV4'](CONFIG);
                    const arg = getCanonicalHeaders.getCall(0).args[0];
                    assert.strictEqual(arg.host, signer_1.PATH_STYLED_HOST.replace('https://', ''));
                });
                mocha_1.it('should add cname as host header', async () => {
                    CONFIG.cname = 'http://www.example.com';
                    const getCanonicalHeaders = sandbox
                        .stub(signer, 'getCanonicalHeaders')
                        .returns('');
                    await signer['getSignedUrlV4'](CONFIG);
                    const arg = getCanonicalHeaders.getCall(0).args[0];
                    assert.strictEqual(arg.host, 'www.example.com');
                });
                mocha_1.it('should strip trailing slashes from host', async () => {
                    CONFIG.cname = 'http://www.example.com//';
                    const getCanonicalHeaders = sandbox
                        .stub(signer, 'getCanonicalHeaders')
                        .returns('');
                    await signer['getSignedUrlV4'](CONFIG);
                    const arg = getCanonicalHeaders.getCall(0).args[0];
                    assert.strictEqual(arg.host, 'www.example.com');
                });
                mocha_1.it('should add Content-MD5 to header', async () => {
                    CONFIG.contentMd5 = 'md5-hash';
                    const getCanonicalHeaders = sandbox
                        .stub(signer, 'getCanonicalHeaders')
                        .returns('');
                    await signer['getSignedUrlV4'](CONFIG);
                    const arg = getCanonicalHeaders.getCall(0).args[0];
                    assert.strictEqual(arg['content-md5'], CONFIG.contentMd5);
                });
                mocha_1.it('should add Content-Type to header', async () => {
                    CONFIG.contentType = 'application/octet-stream';
                    const getCanonicalHeaders = sandbox
                        .stub(signer, 'getCanonicalHeaders')
                        .returns('');
                    await signer['getSignedUrlV4'](CONFIG);
                    const arg = getCanonicalHeaders.getCall(0).args[0];
                    assert.strictEqual(arg['content-type'], CONFIG.contentType);
                });
                mocha_1.it('should merge extensionHeaders', async () => {
                    CONFIG = {
                        extensionHeaders: {
                            'x-goog-content-sha256': '76af7efae0d034d1e3335ed1b90f24b6cadf2bf1',
                        },
                        cname: 'http://www.example.com',
                        contentMd5: 'md5-hash',
                        contentType: 'application/octet-stream',
                        ...CONFIG,
                    };
                    const getCanonicalHeaders = sandbox
                        .stub(signer, 'getCanonicalHeaders')
                        .returns('');
                    await signer['getSignedUrlV4'](CONFIG);
                    const arg = getCanonicalHeaders.getCall(0).args[0];
                    assert.deepStrictEqual(arg, {
                        ...CONFIG.extensionHeaders,
                        host: CONFIG.cname.replace('http://', ''),
                        'content-md5': CONFIG.contentMd5,
                        'content-type': CONFIG.contentType,
                    });
                });
                mocha_1.it('should throw if x-goog-content-sha256 header is not a hash', () => {
                    CONFIG = {
                        extensionHeaders: {
                            'x-goog-content-sha256': 'not-a-hash',
                        },
                        ...CONFIG,
                    };
                    assert.throws(() => signer['getSignedUrlV4'](CONFIG), /The header X-Goog-Content-SHA256 must be a hexadecimal string./);
                });
            });
            mocha_1.describe('query parameters', () => {
                let getCanonicalQueryParams;
                mocha_1.beforeEach(() => {
                    getCanonicalQueryParams = sandbox
                        .stub(signer, 'getCanonicalQueryParams')
                        .returns('');
                });
                mocha_1.it('should populate X-Goog-Algorithm', async () => {
                    const query = (await signer['getSignedUrlV4'](CONFIG));
                    const arg = getCanonicalQueryParams.getCall(0).args[0];
                    assert.strictEqual(arg['X-Goog-Algorithm'], 'GOOG4-RSA-SHA256');
                    assert.strictEqual(query['X-Goog-Algorithm'], 'GOOG4-RSA-SHA256');
                });
                mocha_1.it('should populate X-Goog-Credential', async () => {
                    const query = (await signer['getSignedUrlV4'](CONFIG));
                    const arg = getCanonicalQueryParams.getCall(0).args[0];
                    const datestamp = dateFormat.format(NOW, 'YYYYMMDD', true);
                    const credentialScope = `${datestamp}/auto/storage/goog4_request`;
                    const EXPECTED_CREDENTIAL = `${CLIENT_EMAIL}/${credentialScope}`;
                    assert.strictEqual(arg['X-Goog-Credential'], EXPECTED_CREDENTIAL);
                    assert.strictEqual(query['X-Goog-Credential'], EXPECTED_CREDENTIAL);
                });
                mocha_1.it('should populate X-Goog-Date', async () => {
                    const dateISO = dateFormat.format(NOW, 'YYYYMMDD[T]HHmmss[Z]', true);
                    const query = (await signer['getSignedUrlV4'](CONFIG));
                    const arg = getCanonicalQueryParams.getCall(0).args[0];
                    assert.strictEqual(arg['X-Goog-Date'], dateISO);
                    assert.strictEqual(query['X-Goog-Date'], dateISO);
                });
                mocha_1.it('should populate X-Goog-Expires', async () => {
                    const query = (await signer['getSignedUrlV4'](CONFIG));
                    const arg = getCanonicalQueryParams.getCall(0).args[0];
                    assert.strictEqual(arg['X-Goog-Expires'], '2');
                    assert.strictEqual(query['X-Goog-Expires'], '2');
                });
                mocha_1.it('should lowercase and sort signed headers, and populate X-Goog-SignedHeaders', async () => {
                    CONFIG.extensionHeaders = {
                        'x-foo': 'bar',
                        'X-Goog-acl': 'public-read',
                    };
                    const query = (await signer['getSignedUrlV4'](CONFIG));
                    const arg = getCanonicalQueryParams.getCall(0).args[0];
                    assert.strictEqual(arg['X-Goog-SignedHeaders'], 'host;x-foo;x-goog-acl');
                    assert.strictEqual(query['X-Goog-SignedHeaders'], 'host;x-foo;x-goog-acl');
                });
                mocha_1.it('should merge user-provided queryParams', async () => {
                    CONFIG.queryParams = {
                        foo: 'bar',
                    };
                    const query = (await signer['getSignedUrlV4'](CONFIG));
                    const arg = getCanonicalQueryParams.getCall(0).args[0];
                    assert.strictEqual(arg['foo'], 'bar');
                    assert.strictEqual(query['foo'], 'bar');
                });
            });
            mocha_1.it('should build canonical request', async () => {
                CONFIG.extensionHeaders = {
                    'x-foo': 'bar',
                    'x-goog-content-sha256': '76af7efae0d034d1e3335ed1b90f24b6cadf2bf1',
                };
                CONFIG.file = 'file-name.png';
                sinon.stub(signer, 'getCanonicalHeaders').returns('canonical-headers');
                sinon
                    .stub(signer, 'getCanonicalQueryParams')
                    .returns('canonical-query');
                const getCanonicalRequest = sinon.spy(signer, 'getCanonicalRequest');
                await signer['getSignedUrlV4'](CONFIG);
                const args = getCanonicalRequest.getCall(0).args;
                assert.strictEqual(args[0], CONFIG.method);
                assert.strictEqual(args[1], '/bucket-name/file-name.png');
                assert.strictEqual(args[2], 'canonical-query');
                assert.strictEqual(args[3], 'canonical-headers');
                assert.strictEqual(args[4], 'host;x-foo;x-goog-content-sha256');
                assert.strictEqual(args[5], '76af7efae0d034d1e3335ed1b90f24b6cadf2bf1');
            });
            mocha_1.it('should compute SHA256 digest in hex on canonical request', async () => {
                sinon.stub(signer, 'getCanonicalRequest').returns('canonical-request');
                const authClientSign = sinon
                    .stub(authClient, 'sign')
                    .resolves('signature');
                await signer['getSignedUrlV4'](CONFIG);
                const blobToSign = authClientSign.getCall(0).args[0];
                const canonicalRequestHash = crypto
                    .createHash('sha256')
                    .update('canonical-request')
                    .digest('hex');
                assert(blobToSign.endsWith(canonicalRequestHash));
            });
            mocha_1.it('should compose blobToSign', async () => {
                const datestamp = dateFormat.format(NOW, 'YYYYMMDD', true);
                const credentialScope = `${datestamp}/auto/storage/goog4_request`;
                const dateISO = dateFormat.format(NOW, 'YYYYMMDD[T]HHmmss[Z]', true);
                const authClientSign = sinon
                    .stub(authClient, 'sign')
                    .resolves('signature');
                await signer['getSignedUrlV4'](CONFIG);
                const blobToSign = authClientSign.getCall(0).args[0];
                assert(blobToSign.startsWith(['GOOG4-RSA-SHA256', dateISO, credentialScope].join('\n')));
            });
            mocha_1.it('rejects with SigningError on signing Error', () => {
                const err = new Error('my-err');
                err.stack = 'some-stack-trace';
                sinon.stub(authClient, 'sign').rejects(err);
                assert.rejects(() => signer['getSignedUrlV4'](CONFIG), {
                    name: 'SigningError',
                    message: 'my-err',
                    stack: 'some-stack-trace',
                });
            });
            mocha_1.it('should returns query params with signature', async () => {
                CONFIG.queryParams = {
                    foo: 'bar',
                };
                const query = (await signer['getSignedUrlV4'](CONFIG));
                const signatureInHex = Buffer.from('signature', 'base64').toString('hex');
                assert.strictEqual(query['X-Goog-Signature'], signatureInHex);
            });
        });
        mocha_1.describe('getCanonicalHeaders', () => {
            const signer = new signer_1.URLSigner(authClient, bucket, file);
            mocha_1.it('should accept multi-valued header as an array', () => {
                const headers = {
                    foo: ['bar', 'pub'],
                };
                const canonical = signer.getCanonicalHeaders(headers);
                assert.strictEqual(canonical, 'foo:bar,pub\n');
            });
            mocha_1.it('should lowercase and then sort header names', () => {
                const headers = {
                    B: 'foo',
                    a: 'bar',
                };
                const canonical = signer.getCanonicalHeaders(headers);
                assert.strictEqual(canonical, 'a:bar\nb:foo\n');
            });
            mocha_1.it('should trim leading and trailing space', () => {
                const headers = {
                    foo: '  bar   ',
                    my: '\t  header  ',
                };
                const canonical = signer.getCanonicalHeaders(headers);
                assert.strictEqual(canonical, 'foo:bar\nmy:header\n');
            });
            mocha_1.it('should convert sequential spaces into single space', () => {
                const headers = {
                    foo: 'a\t\t\tbar   pub',
                };
                const canonical = signer.getCanonicalHeaders(headers);
                assert.strictEqual(canonical, 'foo:a bar pub\n');
            });
        });
        mocha_1.describe('getCanonicalRequest', () => {
            const signer = new signer_1.URLSigner(authClient, bucket, file);
            mocha_1.it('should return canonical request string with unsigned-payload', () => {
                const args = [
                    'DELETE',
                    'path',
                    'query',
                    'headers',
                    'signedHeaders',
                ];
                const canonical = signer.getCanonicalRequest(...args);
                const EXPECTED = [...args, 'UNSIGNED-PAYLOAD'].join('\n');
                assert.strictEqual(canonical, EXPECTED);
            });
            mocha_1.it('should include contentSha256 value if not undefined', () => {
                const SHA = '76af7efae0d034d1e3335ed1b90f24b6cadf2bf1';
                const canonical = signer.getCanonicalRequest('DELETE', 'path', 'query', 'headers', 'signedHeaders', SHA);
                const EXPECTED = [
                    'DELETE',
                    'path',
                    'query',
                    'headers',
                    'signedHeaders',
                    SHA,
                ].join('\n');
                assert.strictEqual(canonical, EXPECTED);
            });
        });
        mocha_1.describe('getCanonicalQueryParams', () => {
            const signer = new signer_1.URLSigner(authClient, bucket, file);
            mocha_1.it('should encode key', () => {
                const key = 'AZ!*()*%/f';
                const query = {};
                query[key] = 'value';
                const canonical = signer.getCanonicalQueryParams(query);
                const EXPECTED = `${util_1.encodeURI(key, true)}=value`;
                assert.strictEqual(canonical, EXPECTED);
            });
            mocha_1.it('should encode value', () => {
                const value = 'AZ!*()*%/f';
                const query = { key: value };
                const canonical = signer.getCanonicalQueryParams(query);
                const EXPECTED = `key=${util_1.encodeURI(value, true)}`;
                assert.strictEqual(canonical, EXPECTED);
            });
            mocha_1.it('should sort by key', () => {
                const query = {
                    B: 'bar',
                    A: 'foo',
                };
                const canonical = signer.getCanonicalQueryParams(query);
                const EXPECTED = 'A=foo&B=bar';
                assert.strictEqual(canonical, EXPECTED);
            });
        });
        mocha_1.describe('getResourcePath', () => {
            const signer = new signer_1.URLSigner(authClient, bucket, file);
            mocha_1.it('should not include bucket with cname', () => {
                const path = signer.getResourcePath(true, bucket.name, file.name);
                assert.strictEqual(path, `/${file.name}`);
            });
            mocha_1.it('should include file name', () => {
                const path = signer.getResourcePath(false, bucket.name, file.name);
                assert.strictEqual(path, `/${bucket.name}/${file.name}`);
            });
            mocha_1.it('should return path with no file name', () => {
                const path = signer.getResourcePath(false, bucket.name);
                assert.strictEqual(path, `/${bucket.name}`);
            });
        });
        mocha_1.describe('parseExpires', () => {
            const signer = new signer_1.URLSigner(authClient, bucket, file);
            mocha_1.it('throws invalid date', () => {
                assert.throws(() => signer.parseExpires('2019-31-12T25:60:60Z'), {
                    message: 'The expiration date provided was invalid.',
                });
            });
            mocha_1.it('throws if expiration is in the past', () => {
                assert.throws(() => signer.parseExpires(NOW.valueOf() - 1, NOW), {
                    message: 'An expiration date cannot be in the past.',
                });
            });
            mocha_1.it('returns expiration date in seconds', () => {
                const expires = signer.parseExpires(NOW);
                assert.strictEqual(expires, Math.round(NOW.valueOf() / 1000));
            });
        });
    });
    mocha_1.describe('SigningError', () => {
        mocha_1.it('should extend from Error', () => {
            const err = new signer_1.SigningError();
            assert(err instanceof Error);
            assert.strictEqual(err.name, 'SigningError');
        });
    });
});
//# sourceMappingURL=signer.js.map