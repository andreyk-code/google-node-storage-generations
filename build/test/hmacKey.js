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
const sinon = require("sinon");
const proxyquire = require("proxyquire");
const assert = require("assert");
const mocha_1 = require("mocha");
const common_1 = require("@google-cloud/common");
const sandbox = sinon.createSandbox();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let STORAGE;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let hmacKey;
const ACCESS_ID = 'fake-access-id';
mocha_1.describe('HmacKey', () => {
    mocha_1.afterEach(() => sandbox.restore());
    mocha_1.describe('initialization', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let serviceObjectSpy;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let commonModule;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let HmacKey;
        mocha_1.beforeEach(() => {
            commonModule = { ServiceObject: common_1.ServiceObject };
            serviceObjectSpy = sandbox.spy(commonModule, 'ServiceObject');
            HmacKey = proxyquire('../src/hmacKey', {
                '@google-cloud/common': commonModule,
            }).HmacKey;
            STORAGE = {
                request: common_1.util.noop,
                projectId: 'my-project',
            };
            hmacKey = new HmacKey(STORAGE, ACCESS_ID);
        });
        mocha_1.it('should inherit from ServiceObject', () => {
            assert(hmacKey instanceof common_1.ServiceObject);
            const ctorArg = serviceObjectSpy.firstCall.args[0];
            assert(ctorArg.parent, STORAGE);
            assert(ctorArg.id, ACCESS_ID);
            assert(ctorArg.baseUrl, '/projects/my-project/hmacKeys');
            assert.deepStrictEqual(ctorArg.methods, {
                delete: true,
                get: true,
                getMetadata: true,
                setMetadata: {
                    reqOpts: {
                        method: 'PUT',
                    },
                },
            });
        });
        mocha_1.it('should form baseUrl using options.projectId if given', () => {
            hmacKey = new HmacKey(STORAGE, ACCESS_ID, { projectId: 'another-project' });
            const ctorArg = serviceObjectSpy.firstCall.args[0];
            assert(ctorArg.baseUrl, '/projects/another-project/hmacKeys');
        });
    });
});
//# sourceMappingURL=hmacKey.js.map