'use strict';
var Web3 = require('web3')
var solc = require('solc')
var AWS = require('aws-sdk')
const S3 = new AWS.S3()
var fs = require("fs")


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


    var web3 = new Web3(new Web3.providers.HttpProvider('https://block.cognitochain.io'))

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



    const contractOwner = '0xebd57657a9e8c064a58CF4BEC4c4Ad84De2A8632'
    const privateKey = '0xa51bb5601d61c924e0d6167ffa8d0acce6d599afa3f3b64563ab809276931aa3'

    const tx = {
        chainId: 15092020,
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


  var item = {
    loanID: loanInfo.loanID,
    amount: loanInfo.amount,
    shgID: loanInfo.shgID,
    disbursementDate: loanInfo.disbursementDate,
    demandGenerationData: loanInfo.demandGenerationData,
    memberID: loanInfo.memberID,
    contractAddress: receipt.contractAddress
  }

  const putContractAddress = {
    Item: item,
    ReturnConsumedCapacity: 'TOTAL',
    TableName: 'loan-info-dev'
  }
  
  const result = await dynamoDb.put(putContractAddress).promise()

  console.log(result);
}