'use strict';
var Web3 = require('web3')
var solc = require('solc')
var AWS = require('aws-sdk')
const S3 = new AWS.S3()



module.exports.deployContract = (event, context, callback) => {
  var result = deployContract(context)
  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        message: 'function executed successfully!',
        input: event,
      },
      null,
      2
    ),
  };

};


async function deployContract (context) {

  var params = {
    Bucket: 'loancontract',
    Key: 'Loan.sol'
  }

  const getContract = await S3.getObject(params).promise()
  const contract = getContract.Body.toString('utf-8')
  var input = {
    language: 'Solidity',
    sources: {
      'loan':{
        content: contract
      }
    },
    settings: {
      outputSelection: {
        "*": {
          "*": [ "abi", "evm.bytecode" ]
        }
      }
    }
  }

  var compiledCode = JSON.parse(solc.compile(JSON.stringify(input)));  

  var web3 = new Web3(new Web3.providers.HttpProvider('https://block.cognitochain.io'))

  var byteCode = compiledCode.contracts['loan'].loan.evm.bytecode.object

  const contractOwner = '0xebd57657a9e8c064a58CF4BEC4c4Ad84De2A8632'
  const privateKey = '0xa51bb5601d61c924e0d6167ffa8d0acce6d599afa3f3b64563ab809276931aa3'

  const tx = {
    chainId: 15092020,
    nonce: await web3.utils.toHex(await web3.eth.getTransactionCount(contractOwner)),
    gas: web3.utils.toHex(7000000),
    from: contractOwner,
    data: '0x' + byteCode
  }

  console.info(tx)
  
  console.info('Deploying Contract')

  const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey)
  const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction)

  console.info(receipt)

  context.done(null, 'contract deployed') // SUCCESS with message
}

