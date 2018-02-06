const expect = require('chai').expect;
const nock = require('nock');

const BuzzApi = require('../index');
const response = require('./response');

const buzzapisync = new BuzzApi({'apiUser': '', 'apiPassword': '', 'sync': true});
const buzzapi = new BuzzApi({'apiUser': '', 'apiPassword': ''});

beforeEach(() => {
    nock.cleanAll();
});

describe('Sync tests', () => {

    it('Gets a resource in a single request', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.sync);
        return buzzapisync.post('test', 'test', {}).then(response => {
            expect(typeof response).to.equal('object');
            expect(response.success);
        });
    });

    it('Handles buzzapi errors', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.syncError);
        return buzzapisync.post('test', 'test', {}).catch(err => {
            expect(typeof err.buzzApiBody).to.equal('object');
            expect(err.buzzApiErrorInfo.success).to.equal(false);
        });
    });

    it('Handles http errors', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(404, 'Not Found');
        return buzzapisync.post('test', 'test', {}).catch(err => {
            expect(err.buzzApiBody).to.equal('Not Found');
            return expect(err.buzzApiErrorInfo).to.be.empty;
        });
    });

    it('Handles errors with no body set', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(400);
        return buzzapisync.post('test', 'test', {}).catch(err => {
            expect(err.message).to.equal('BuzzApi error');
            return expect(err.buzzApiBody).to.be.empty;
        });
    });

    it('Responds via callback if provided', done => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.sync);
        buzzapisync.post('test', 'test', (err, response) => {
            expect(typeof response).to.equal('object');
            expect(response.success);
            done();
        });
    });

    it('Sends errors via callback if provided', done => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(404, 'Not Found');
        buzzapisync.post('test', 'test', (err, response) => {
            expect(response).to.be.null;
            expect(err.buzzApiBody).to.equal('Not Found');
            done();
        });
    });

    it('Does not lose requests when opening more than the queuing limit of 20', () => {
        let reqs = nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).times(25).socketDelay(200).reply(200, response.sync);
        let check = response => {
            expect(typeof response).to.equal('object');
            expect(response.success);
        };
        for (let i=0; i < 25; i++) {
            buzzapisync.post('test', 'test', {}).then(check);
        }
        expect(reqs.isDone());
    });
});

describe('Async tests', () => {

    it('Makes a second request to get async messages', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.async);
        var aReq = nock('https://api.gatech.edu').get('/apiv3/api.my_messages').query(qo => {return qo.api_pull_response_to === 'ABC123';}).reply(200, response.asyncSuccess);
        return buzzapi.post('test', 'test', {}).then(response => {
            expect(typeof response).to.equal('object');
            expect(response.success);
            expect(aReq.isDone());
        });
    });

    it('Tries again if async result not ready', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.async);
        var nrReq = nock('https://api.gatech.edu').get('/apiv3/api.my_messages').query(qo => {return qo.api_pull_response_to === 'ABC123';}).reply(200, response.asyncNotReady);
        nock('https://api.gatech.edu').get('/apiv3/api.my_messages').query(qo => {return qo.api_pull_response_to === 'ABC123';}).reply(200, response.asyncSuccess);
        return buzzapi.post('test', 'test', {}).then(response => {
            expect(typeof response).to.equal('object');
            expect(response.success);
            expect(nrReq.isDone());
        });
    }).timeout(6000);

    it('Handles buzzapi errors', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.async);
        nock('https://api.gatech.edu').get('/apiv3/api.my_messages').query(qo => {return qo.api_pull_response_to === 'ABC123';}).reply(200, response.asyncError);
        return buzzapi.post('test', 'test', {}).catch(err => {
            expect(typeof err.buzzApiBody).to.equal('object');
            expect(err.buzzApiErrorInfo.success).to.equal(false);
        });
    });

    it('Handles buzzapi errors at top level of response', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.async);
        nock('https://api.gatech.edu').get('/apiv3/api.my_messages').query(qo => {return qo.api_pull_response_to === 'ABC123';}).reply(200, response.syncError);
        return buzzapi.post('test', 'test', {}).catch(err => {
            expect(typeof err.buzzApiBody).to.equal('object');
            expect(err.buzzApiErrorInfo.success).to.equal(false);
        });
    });

    it('Handles http errors', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.async);
        nock('https://api.gatech.edu').get('/apiv3/api.my_messages').query(qo => {return qo.api_pull_response_to === 'ABC123';}).reply(404, 'Not Found');
        return buzzapi.post('test', 'test', {}).catch(err => {
            expect(err.buzzApiBody).to.equal('Not Found');
        });
    });

    it('Responds via callback if provided', done => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.async);
        nock('https://api.gatech.edu').get('/apiv3/api.my_messages').query(qo => {return qo.api_pull_response_to === 'ABC123';}).reply(200, response.asyncSuccess);
        buzzapi.post('test', 'test', (err, response) => {
            expect(typeof response).to.equal('object');
            expect(response.success);
            done();
        });
    });

    it('Responds via callback if provided', done => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.async);
        nock('https://api.gatech.edu').get('/apiv3/api.my_messages').query(qo => {return qo.api_pull_response_to === 'ABC123';}).reply(404, 'Not Found');
        buzzapi.post('test', 'test', (err, response) => {
            expect(response).to.be.null;
            expect(err.buzzApiBody).to.equal('Not Found');
            done();
        });
    });

    it('Gives up retrying a request after reaching the timeout', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.async);
        nock('https://api.gatech.edu').get('/apiv3/api.my_messages').query(qo => {return qo.api_pull_response_to === 'ABC123';}).reply(200, response.asyncNotReady);
        let defaultTimeout = buzzapi.options.api_receive_timeout;
        buzzapi.options.api_receive_timeout = 1;
        return buzzapi.post('test', 'test', {}).catch(err => {
            buzzapi.options.api_receive_timeout = defaultTimeout;
            expect(err.message).to.equal('Request timed out for: ABC123');
        });
    }).timeout(6000);

    it('Handles errors with no body set', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.async);
        nock('https://api.gatech.edu').get('/apiv3/api.my_messages').query(qo => {return qo.api_pull_response_to === 'ABC123';}).reply(400);
        return buzzapi.post('test', 'test', {}).catch(err => {
            expect(err.message).to.equal('BuzzApi error');
            return expect(err.buzzApiBody).to.be.empty;
        });
    });
});
