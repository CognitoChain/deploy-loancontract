const awsParamStore = require( 'aws-param-store' );

const region = { region: 'ap-south-1' };

module.exports ={
    database: 'postgres',
    host: awsParamStore.getParameterSync( 'DB_HOST',region).Value,
    port: awsParamStore.getParameterSync( 'DB_PORT',region).Value,
    user: awsParamStore.getParameterSync( 'DB_ADMIN_ID',region).Value,
    password: awsParamStore.getParameterSync( 'DB_ADMIN_PASSWORD',region).Value,
    max: 1,
    min: 0,
    idleTimeoutMillis: 120000,
    connectionTimeoutMillis: 10000
};
