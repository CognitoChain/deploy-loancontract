'use strict';
var Web3 = require('web3')
var solc = require('solc')
var AWS = require('aws-sdk')
const S3 = new AWS.S3()
var fs = require("fs")
const awsParamStore = require( 'aws-param-store' );
const region = { region: 'ap-south-1' };


AWS.config.setPromisesDependency(require('bluebird'));

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.deployContract = (event, context, callback) => {

  var blockCounter = 0;
  try{
    event.Records.forEach((record) => {
      console.log('Stream record: ', JSON.stringify(record, null, 2));
      // var record = JSON.parse(fs.readFileSync('./mocks/dynamo-mock.json', 'utf8'))
      if (record.eventName == 'INSERT') {
          const unmarshalledData = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage)
          console.log(unmarshalledData.contractAddress)
          if(unmarshalledData.contractAddress === undefined){
            deployContract(unmarshalledData,blockCounter)
            blockCounter++
          }else{
            console.warn(`Contract already exists for the loan :${unmarshalledData.loanID} `)
          }
      }
   })
  }
  catch(e){
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


async function deployContract(loanInfo,blockCounter) {

    const Blockchain_Provider = awsParamStore.getParameterSync( 'BLOCKCHAIN_RPC_PROVIDER',region).Value
    const Blockchain_ID = awsParamStore.getParameterSync( 'BLOCKCHAIN_ID',region).Value
    const contractOwner = awsParamStore.getParameterSync( 'BLOCKCHAIN_CONTRACT_OWNER',region).Value
    const privateKey = awsParamStore.getParameterSync( 'BLOCKCHAIN_CONTRACT_PK',region).Value


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
        arguments: [loanInfo.amount,loanInfo.loanID]
    }).encodeABI()
    
    const tx = {
        chainId: Blockchain_ID,
        nonce: await web3.utils.toHex((await web3.eth.getTransactionCount(contractOwner))+blockCounter),
        gas: web3.utils.toHex(7000000),
        from: contractOwner,
        data: hexdata
    }

    console.info(tx)

    console.info('Deploying Contract')

    const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey)
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction)

    console.info(receipt)

  loanInfo.contractAddres = receipt.contractAddress

  const putContractAddress = {
    Item: loanInfo,
    ReturnConsumedCapacity: 'TOTAL',
    TableName: 'loan-info-dev'
  }
  
  const result = await dynamoDb.put(putContractAddress).promise()

  console.log(result);
}