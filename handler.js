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
const dynamoStreamDiff = require('dynamo-stream-diff')


AWS.config.setPromisesDependency(require('bluebird'));

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const Blockchain_Provider = awsParamStore.getParameterSync('BLOCKCHAIN_RPC_PROVIDER', region).Value
const Blockchain_ID = awsParamStore.getParameterSync('BLOCKCHAIN_ID', region).Value
const contractOwner = awsParamStore.getParameterSync('BLOCKCHAIN_CONTRACT_OWNER', region).Value
const privateKey = awsParamStore.getParameterSync('BLOCKCHAIN_CONTRACT_PK', region).Value
const web3 = new Web3(new Web3.providers.HttpProvider(Blockchain_Provider))


module.exports.loanContractInfo = async (event, context, callback) => {

    console.log(JSON.stringify(event))
    //  event = JSON.parse(fs.readFileSync('./mocks/loan-info-id-event.json', 'utf8'));
    try {
        const results = await getItemFromLoanTable(event.queryStringParameters.loanID)
        console.log('Loan info for the query ' + event.queryStringParameters.loanID + ' ::' + JSON.stringify(results))
        var response = {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json"
            },
            "body": JSON.stringify(results),
            "isBase64Encoded": false
        };
        callback(null, response);
    } catch (err) {
        console.log('Error featching loan info for the query ' + event.queryStringParameters + ' :: error ' + err)
        var errResponse = {
            "statusCode": 404,
            "headers": {
                "Content-Type": "application/json"
            },
            "body": JSON.stringify({
                err: "Loan does not exists"
            }),
            "isBase64Encoded": false
        };
        callback(null, errResponse);
    }


}

module.exports.deployContract = (event, context, callback) => {
    var blockCounter = 0;
    try {
        event.Records.forEach((record) => {
            console.log('Stream record: ', JSON.stringify(record, null, 2));
            // var record = JSON.parse(fs.readFileSync('./mocks/repayment-2.json', 'utf8'))
            const unmarshalledNewData = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage)
            const unmarshalledOldData = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.OldImage)
            if (record.eventName == 'INSERT') {
                console.log('deployContract')
                deployContract(unmarshalledNewData, blockCounter)
                blockCounter++
            } else if (record.eventName == 'MODIFY') {
                if (unmarshalledOldData.loanID === unmarshalledNewData.loanID && unmarshalledOldData.amount === unmarshalledNewData.amount) {
                    if (unmarshalledNewData.contractAddress === undefined) {
                        if (unmarshalledOldData.contractAddress === undefined) {
                            console.log('Deploying New contract for Loan: ' + unmarshalledOldData.loanID)
                            deployContract(unmarshalledNewData, blockCounter)
                            blockCounter++
                        } else {
                            console.log('update same contract address: ' + unmarshalledOldData.contractAddress)
                            updateContractAddress(unmarshalledOldData, unmarshalledOldData.contractAddress)
                            blockCounter++

                        }
                    } else {
                        const diff = dynamoStreamDiff(record).diffList
                        diff.forEach(element => {
                            console.log(element)
                            if (element.path.includes('repayments.') && (element.diff === 'created') && element.newVal && !(element.path.includes('transactionHash'))) {
                                const repaymentDate = element.path.replace('repayments.', '')
                                const repaymentAmount = element.newVal.amount * 1
                                console.log(`Executing repayments transaction with amount: ${repaymentAmount} and date : ${repaymentDate}`)
                                executeTransaction(unmarshalledNewData.loanID, unmarshalledNewData.contractAddress, repaymentDate, repaymentAmount, blockCounter)
                                blockCounter++
                            } else if (element.path.includes('transactionHash')) {
                                console.log(`Transaction hash already exists : ${element.newVal} for the repayment`)
                            }
                        });
                    }
                } else {
                    console.log(`Loan info updated :: Old Loan:${JSON.stringify(unmarshalledOldData)} , New Loan info : ${JSON.stringify(unmarshalledNewData)}  `)
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

    var input = {
        language: 'Solidity',
        sources: {
            'loan': {
                content: fs.readFileSync('./smart-contracts/Loan.sol', 'utf8')
            }
        },
        settings: {
            evmVersion: "byzantium",
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
        nonce: await web3.utils.toHex((await web3.eth.getTransactionCount(contractOwner)) + loanInfo.blockCounter),
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




async function executeTransaction(loanID, constractAddress, repaymentDate, repaymentAmount, blockCounter) {
    var input = {
        language: 'Solidity',
        sources: {
            'loan': {
                content: fs.readFileSync('./smart-contracts/Loan.sol', 'utf8')
            }
        },
        settings: {
            evmVersion: "byzantium",
            outputSelection: {
                "*": {
                    "*": ["abi", "evm.bytecode"]
                }
            }
        }
    }


    var compiledCode = JSON.parse(solc.compile(JSON.stringify(input)));

    var contractABI = new web3.eth.Contract(compiledCode.contracts['loan'].loan.abi);

    const loanContract = new web3.eth.Contract(contractABI._jsonInterface, constractAddress)

    const repayments = await loanContract.methods.getRepayments().call()
    const RegisteredloanID = await loanContract.methods.loanID().call()

    for (var i = 0; i < repayments.length; i++) {
        if (repayments[i].includes(repaymentDate)) {
            console.log(`WARNING: Repayment: ${repayments[i]} : already exists for the loan : ${loanID} at contract address: ${constractAddress}`)
            return
        }
    }
    if (RegisteredloanID === loanID) {
        const tx = {
            from: contractOwner,
            gas: web3.utils.toHex(7000000),
            gasPrice: Math.floor(parseInt(await web3.eth.getGasPrice()) * 1.05),
            value: '0x0',
            to: loanContract._address,
            data: loanContract.methods.makeRepayment(repaymentDate, repaymentAmount).encodeABI(),
            nonce: await web3.utils.toHex((await web3.eth.getTransactionCount(contractOwner)) + blockCounter)
        }
        const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey)
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction)
        console.log(receipt)
        updateRepaymentTransaction(RegisteredloanID, repaymentDate, repaymentAmount, receipt.transactionHash)
    } else {
        console.log(`ERROR: Specified loan id is : ${loanID} but recieved ${RegisteredloanID} from  contract address: ${constractAddress} `)
    }

}

function getRandomInt(min, max) {
    min = Math.ceil(min)
    max = Math.floor(max)
    return Math.floor(Math.random() * (max - min)) + min
}



async function updateContractAddress(loanInfo, constractAddress) {

    loanInfo.contractAddress = constractAddress

    const putContractAddress = {
        Item: loanInfo,
        ReturnValues: "ALL_OLD",
        TableName: process.env.LOAN_TABLE
    }

    console.log(JSON.stringify(putContractAddress))

    const result = await dynamoDb.put(putContractAddress).promise()

    console.log(result);
}

async function updateRepaymentTransaction(loanID, repaymentDate, repaymentAmount, transactionHash) {
    var repaymentTransaction = {
        TableName: process.env.LOAN_TABLE,
        Key: {
            "loanID": loanID
        },
        UpdateExpression: 'set #c.#date = :vals',
        ExpressionAttributeNames: {
            "#c": "repayments",
            "#date": repaymentDate
        },
        ExpressionAttributeValues: {
            ":vals": {
                amount: repaymentAmount,
                transactionHash: transactionHash
            }
        },
        ReturnValues: "UPDATED_NEW"
    }
    try {
        console.log(JSON.stringify(repaymentTransaction))
        const result = await dynamoDb.update(repaymentTransaction).promise()
        console.log(result);
    } catch (e) {
        console.log(e)
    }
}



async function getItemFromLoanTable(loanID) {


    const params = {
        TableName: process.env.LOAN_TABLE,
        Key: {
            "loanID": loanID
        }
    }

    return await dynamoDb.get(params).promise()

}