'use strict';
var Web3 = require('web3')
var solc = require('solc')
var AWS = require('aws-sdk')
const S3 = new AWS.S3()
const fs = require('fs');



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
  console.log(contract)
  console.log('Deploying Contract')
  // compilation, we read in the Solidity file and compile
  var compiledCode = solc.compile(contract)

  // connect to the blockchain

  var web3 = new Web3(new Web3.providers.HttpProvider('https://block.cognitochain.io'))

  console.log(compiledCode)

  // Get the Bytecode
  var byteCode = compiledCode.contracts[':loan'].bytecode

  const contractOwner = '0xebd57657a9e8c064a58CF4BEC4c4Ad84De2A8632'
  const privateKey = 'A51BB5601D61C924E0D6167FFA8D0ACCE6D599AFA3F3B64563AB809276931AA3'

  const tx = {
    chainId: 15092020,
    nonce: await web3.utils.toHex(await web3.eth.getTransactionCount(contractOwner)),
    gas: web3.utils.toHex(7000000),
    gasPrice: await web3.eth.getGasPrice(),
    from: contractOwner,
    data: await web3.utils.toHex(byteCode)
  }

  console.log(tx)

  const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey)
  const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction)

  console.log(receipt.contractAddress)

  context.done(null, 'contract deployed') // SUCCESS with message
}

