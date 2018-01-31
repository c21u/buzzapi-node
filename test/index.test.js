const expect = require('chai').expect;
const nock = require('nock');

const BuzzApi = require('../index');
const response = require('./response');

const buzzapisync = new BuzzApi({'apiUser': '', 'apiPassword': '', 'sync': true});
const buzzapi = new BuzzApi({'apiUser': '', 'apiPassword': ''});

describe('Post tests', () => {

    it('Gets a resource in a single request when using sync', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.sync);
        return buzzapisync.post('test', 'test', {}).then(response => {
            expect(typeof response).to.equal('object');
            expect(response.success);
        });
    });

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
    });

    it('Handles errors on sync requests', () => {
        nock('https://api.gatech.edu').post('/apiv3/test/test', body => {return true;}).reply(200, response.syncError);
        return buzzapisync.post('test', 'test', {}).catch(err => {
            expect(typeof err.buzzApiBody).to.equal('object');
            expect(err.buzzApiErrorInfo.success).to.equal(false);
        });
    });
});
