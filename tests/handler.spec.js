const mocha = require('mocha');
const {assert} = require('chai');

const handler = require('../handler');

describe("The handler function", () => {
    it("returns a message", () => {
        handler.deployContract(undefined, undefined, function(error, response){
            assert(response)
        });
    });
});