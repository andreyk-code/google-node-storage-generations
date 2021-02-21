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
const proxyquire = require("proxyquire");
const error = Error('not implemented');
mocha_1.describe('headers', () => {
    const requests = [];
    const { Storage } = proxyquire('../src', {
        'google-auth-library': {
            GoogleAuth: class {
                async getProjectId() {
                    return 'foo-project';
                }
                async getClient() {
                    return class {
                        async request() {
                            return {};
                        }
                    };
                }
                getCredentials() {
                    return {};
                }
                async authorizeRequest(req) {
                    requests.push(req);
                    throw error;
                }
            },
            '@global': true,
        },
    });
    mocha_1.it('populates x-goog-api-client header', async () => {
        const storage = new Storage();
        const bucket = storage.bucket('foo-bucket');
        try {
            await bucket.create();
        }
        catch (err) {
            if (err !== error)
                throw err;
        }
        assert.ok(/^gl-node\/[0-9]+\.[0-9]+\.[-.\w]+ gccl\/[0-9]+\.[0-9]+\.[-.\w]+$/.test(requests[0].headers['x-goog-api-client']));
    });
});
//# sourceMappingURL=headers.js.map