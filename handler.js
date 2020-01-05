'use strict';
var Web3 = require('web3')
var solc = require('solc')
var AWS = require('aws-sdk')
const S3 = new AWS.S3()
var fs = require("fs")
const awsParamStore = require('aws-param-store');
const region = {
    region: 'ap-south-1'
};
const dbConfig = require('./config/db');


AWS.config.setPromisesDependency(require('bluebird'));

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.deployContract = (event, context, callback) => {

    var blockCounter = 0;
    try {
        event.Records.forEach((record) => {
            console.log('Stream record: ', JSON.stringify(record, null, 2));
            var record = JSON.parse(fs.readFileSync('./mocks/dynamo-modify-mock.json', 'utf8'))
            const unmarshalledNewData = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage)
            const unmarshalledOldData = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.OldImage)
            if (record.eventName == 'INSERT') {
                console.log('deployContract')
                deployContract(unmarshalledNewData, blockCounter)
                blockCounter++
            } else if (record.eventName == 'MODIFY') {
                if (unmarshalledOldData.loanID === unmarshalledNewData.loanID && unmarshalledOldData.amount === unmarshalledNewData.amount) {
                    console.log(unmarshalledOldData.contractAddress)
                    if(unmarshalledOldData.contractAddress === undefined){
                      if (unmarshalledOldData.contractAddress === undefined) {
                        console.log('Deploying New contract for Loan: ' + unmarshalledOldData.loanID)
                        deployContract(unmarshalledNewData, blockCounter)
                      } else {
                        console.log('update same contract address: ' + unmarshalledOldData.contractAddress)
                        updateContractAddress(unmarshalledOldData, unmarshalledOldData.contractAddress)
                      }
                    }
                } else {
                    console.warn(`Loan info updated :: Old Loan:${JSON.stringify(unmarshalledOldData)} , New Loan info : ${JSON.stringify(unmarshalledNewData)}  `)
                }
            }
        })
    } catch (e) {
        console.log(e)
    }
    return {
        statusCode: 200,
        body: JSON.stringify({
                message: 'function executed successfully!',
                input: event,
            },
            null,
            2
        ),
    };

};


async function deployContract(loanInfo, blockCounter) {

    const Blockchain_Provider = awsParamStore.getParameterSync('BLOCKCHAIN_RPC_PROVIDER', region).Value
    const Blockchain_ID = awsParamStore.getParameterSync('BLOCKCHAIN_ID', region).Value
    const contractOwner = awsParamStore.getParameterSync('BLOCKCHAIN_CONTRACT_OWNER', region).Value
    const privateKey = awsParamStore.getParameterSync('BLOCKCHAIN_CONTRACT_PK', region).Value


    var web3 = new Web3(new Web3.providers.HttpProvider(Blockchain_Provider))


    var input = {
        language: 'Solidity',
        sources: {
            'loan': {
                content: fs.readFileSync('./smart-contracts/Loan.sol', 'utf8')
            }
        },
        settings: {
            outputSelection: {
                "*": {
                    "*": ["abi", "evm.bytecode"]
                }
            }
        }
    }


    var compiledCode = JSON.parse(solc.compile(JSON.stringify(input)));

    var byteCode = compiledCode.contracts['loan'].loan.evm.bytecode.object

    var contract = new web3.eth.Contract(compiledCode.contracts['loan'].loan.abi);
    const hexdata = contract.deploy({
        data: '0x' + byteCode,
        arguments: [loanInfo.amount, loanInfo.loanID]
    }).encodeABI()

    const tx = {
        chainId: Blockchain_ID,
        nonce: await web3.utils.toHex((await web3.eth.getTransactionCount(contractOwner)) + blockCounter),
        gas: web3.utils.toHex(7000000),
        from: contractOwner,
        data: hexdata
    }

    console.info(tx)

    console.info('Deploying Contract')

    const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey)
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction)

    console.info(receipt)

    updateContractAddress(loanInfo, receipt.contractAddress)
}




async function updateContractAddress(loanInfo, constractAddress) {

    loanInfo.contractAddress = constractAddress

    const putContractAddress = {
        Item: loanInfo,
        ReturnConsumedCapacity: 'TOTAL',
        TableName: process.env.LOAN_TABLE
    }

    console.log(JSON.stringify(putContractAddress))

    const result = await dynamoDb.put(putContractAddress).promise()

    console.log(result);
}