'use strict';

console.log('Loading function');

const aws = require('aws-sdk');
const sts = new aws.STS();

const isMissingEnvVariablees = () => {
  let messages = [];

  if (process.env.STS_ROLE_ARN === undefined)
    messages.push('Missing Environment Variable ::: STS_ROLE_ARN: ROLE ARN to be used with assume-role');
  if (process.env.STS_SESSION_NAME === undefined)
    messages.push('Missing Environment Variable ::: STS_SESSION_NAME: assume-role Role Session name');
  if (process.env.S3_DEST_BUCKET === undefined)
    messages.push('Missing Environment Variable ::: S3_DEST_BUCKET: bucket name in target account');
  if (process.env.S3_BUCKET_ACL === undefined)
    messages.push('Missing Environment Variable ::: S3_BUCKET_ACL: object ACL: private, public-read, public-read-write, authenticated-read, aws-exec-read, bucket-owner-read, bucket-owner-full-control and log-delivery-write');

  messages.forEach( e => console.log(e) );
  return (messages.length >= 1);
}

/**
 * Get object from S3 that triggered this lambda
 * @param event
 */
const getObject = event => new Promise((resolve, reject) => {
  console.log('getObject', event.Records[0].s3.object.key);

  // SET credentials to Lambda's role in order to fetch file from the right account
  aws.config.credentials = new aws.EnvironmentCredentials('AWS');

  const s3 = new aws.S3({apiVersion: '2006-03-01'});
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));
  const params = {
    Bucket: bucket,
    Key: key,
  };
  s3.getObject(params, (err, object) => err ? reject(err) : resolve({key, object}) );
});

/**
 * Assume Motomaker role to upload file to S3
 * @param key     object's name
 * @param object  object that triggered this event
 */
const assumeRole = ({key, object}) => new Promise((resolve, reject) => {
  console.log('assumeRole', process.env.STS_ROLE_ARN);

  const params = {
    RoleArn: process.env.STS_ROLE_ARN,
    RoleSessionName: process.env.STS_SESSION_NAME
  }
  sts.assumeRole(params, (err, role) => err ? reject(err) : resolve({key, object, role}) );
});

/**
 * Upload object to Motomaker's S3
 * @param key     object's name
 * @param object  object that triggered this lambda
 * @param role    assumeRole params
 */
const uploadObject = ({key, object, role}) => new Promise((resolve, reject) => {
  console.log('uploadObject to:', process.env.S3_DEST_BUCKET);

  //Set credentials to put file in the right account
  aws.config.credentials = sts.credentialsFrom(role);

  const motoMakerS3 = new aws.S3();
  const params = {
    Bucket: process.env.S3_DEST_BUCKET,
    Key: key,
    Body: object.Body,
    ACL: process.env.S3_BUCKET_ACL
  };
  motoMakerS3.putObject(params, err => err ? reject(err) : resolve(object));
});

/**
 * Lambda Handler - main entry point
 * @param event
 * @param context
 * @param callback
 */
exports.handler = (event, context, callback) => {
  console.log('Starting lambda');

  if(isMissingEnvVariablees()) {
    callback(new Error('Missing Environment Variables'));
    return;
  }


  getObject(event)
    .then(assumeRole)
    .then(uploadObject)
    .then(data => {
      console.log('Successfully uploaded package.');
      callback(null, data.ContentType);
    })
    .catch(err => {
      console.log('Error in workflow');
      console.log(err);
      callback(err);
    });
};