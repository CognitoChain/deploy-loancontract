'use strict';
var Web3 = require('web3')
var solc = require('solc')
var AWS = require('aws-sdk')
const S3 = new AWS.S3()
var fs = require("fs")


AWS.config.setPromisesDependency(require('bluebird'));

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.deployContract = (event, context, callback) => {

  try{
    event.Records.forEach((record) => {
      console.log('Stream record: ', JSON.stringify(record, null, 2));
      if (record.eventName == 'INSERT') {
          const unmarshalleddata = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage);

            const loanID = JSON.stringify(unmarshalleddata.loanID.S);
            const loanAmount = unmarshalleddata.amount.N;
            console.log(loanID)
            console.log(loanAmount)
            deployContract(loanID,loanAmount)
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


async function deployContract(loanID,amount) {


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
        arguments: [amount,loanID]
    }).encodeABI()



    const contractOwner = '0xebd57657a9e8c064a58CF4BEC4c4Ad84De2A8632'
    const privateKey = '0xa51bb5601d61c924e0d6167ffa8d0acce6d599afa3f3b64563ab809276931aa3'

    const tx = {
        chainId: 15092020,
        nonce: await web3.utils.toHex(await web3.eth.getTransactionCount(contractOwner)),
        gas: web3.utils.toHex(7000000),
        from: contractOwner,
        data: hexdata
    }

    console.info(tx)

    console.info('Deploying Contract')

    const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey)
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction)

    console.info(receipt)

  const putContractAddress = {
    Item: {
      'key': {
        S: loanID
      },
      'contract': {
        S: receipt.contractAddress
      }
    },
    ReturnConsumedCapacity: 'TOTAL',
    TableName: 'cognitochain-api-dev'
  }
  await dynamoDb.putItem(putContractAddress).promise()

  context.done(null, 'contract deployed') // SUCCESS with message
}