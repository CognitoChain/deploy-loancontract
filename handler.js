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

    var blockCounter = 0;

module.exports.deployContract = (event, context, callback) => {

    try {
        event.Records.forEach((record) => {
            console.log('Stream record: ', JSON.stringify(record, null, 2));
            // var record = JSON.parse(fs.readFileSync('./mocks/repayment-2.json', 'utf8'))
            const unmarshalledNewData = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage)
            const unmarshalledOldData = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.OldImage)
            if (record.eventName == 'INSERT') {
                console.log('deployContract')
                deployContract(unmarshalledNewData, blockCounter)
            } else if (record.eventName == 'MODIFY') {
                if (unmarshalledOldData.loanID === unmarshalledNewData.loanID && unmarshalledOldData.amount === unmarshalledNewData.amount) {
                    if(unmarshalledNewData.contractAddress === undefined){
                      if (unmarshalledOldData.contractAddress === undefined) {
                        console.log('Deploying New contract for Loan: ' + unmarshalledOldData.loanID)
                        deployContract(unmarshalledNewData, blockCounter)
                      } else {
                        console.log('update same contract address: ' + unmarshalledOldData.contractAddress)
                        updateContractAddress(unmarshalledOldData, unmarshalledOldData.contractAddress)
                      }
                    }
                    else{
                      const diff = dynamoStreamDiff(record).diffList
                      diff.forEach(element => {
                        console.log(element)
                        if(element.path.includes('repayments') &&  (element.diff === 'created')) {
                          console.log('Executing repayments transaction : ' + element.path.replace('repayments.',''),element.newVal.amount*1)
                          executeTransaction( unmarshalledNewData.loanID,unmarshalledNewData.contractAddress, element.path.replace('repayments.',''),element.newVal.amount*1)
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
    blockCounter++
    updateContractAddress(loanInfo, receipt.contractAddress)
}




async function executeTransaction(loanID, constractAddress, repaymentDate, repaymentAmount) {
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

const loanContract = new web3.eth.Contract( contractABI._jsonInterface, constractAddress)

const repayments = await loanContract.methods.getRepayments().call()
const RegisteredloanID = await loanContract.methods.loanID().call()

for (var i = 0; i < repayments.length; i++) {
  if (repayments[i].includes(repaymentDate)) {
    console.log(`WARNING: Repayment: ${repayments[i]} : already exists for the loan : ${loanID} at contract address: ${constractAddress}`)
    return 
  }
}
if (RegisteredloanID === loanID){
  const tx = {
      from: contractOwner,
      gas: web3.utils.toHex(7000000),
      gasPrice: Math.floor(parseInt(await web3.eth.getGasPrice()) * 1.05),
      value:'0x0',
      to: loanContract._address,
      data: loanContract.methods.makeRepayment(repaymentDate,repaymentAmount).encodeABI(),
      nonce: await web3.utils.toHex((await web3.eth.getTransactionCount(contractOwner)) + blockCounter)
    }
    const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey)
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction)
    blockCounter++
    console.log(receipt)
  } else{
    console.log(`ERROR: Specified loan id is : ${loanID} but recieved ${RegisteredloanID} from  contract address: ${constractAddress} `)
  }
  
}


module.exports.loanContractInfo = (event, context, callback) => {

console.log(JSON.stringify(event))

// access loan table and get contract address for the ID
// get details from blockchain and send it as response

}

function getRandomInt (min, max) {
  min = Math.ceil(min)
  max = Math.floor(max)
  return Math.floor(Math.random() * (max - min)) + min
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