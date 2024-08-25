/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {
  GetObjectCommand,
  GetObjectCommandInput,
  S3Client,
} from "@aws-sdk/client-s3";
//dynamoDB imports
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SES_REGION } from "env";


//ddb client same as labs.

const ddb = createDDbDocClient();
const s3 = new S3Client();

export const handler: SQSHandler = async (event) => {
  console.log("Event ", event);
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);
    const snsMessage = JSON.parse(recordBody.Message);

    console.log('Raw SNS message ', JSON.stringify(recordBody))
    if (recordBody.Records) {
      console.log("Record body ", JSON.stringify(snsMessage));
      for (const messageRecord of recordBody.Records) {
        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;
        // Object key may have spaces or unicode non-ASCII characters.
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
        // Infer the image type from the file suffix.
        const typeMatch = srcKey.match(/\.([^.]*)$/);
        if (!typeMatch) {
          console.log("Could not determine the image type.");
          throw new Error("Could not determine the image type. ");
        }
        // Check that the image type is supported
        const imageType = typeMatch[1].toLowerCase();
        if (imageType != "jpeg" && imageType != "png") {
          console.log(`Unsupported image type: ${imageType}`);
          throw new Error("Unsupported image type: ${imageType. ");
        }
        //gets image from bucket, then adds to database
        try {
          const params: GetObjectCommandInput = {
            Bucket: srcBucket,
            Key: srcKey,
          };

          await s3.send(new GetObjectCommand(params));

          await ddb.send(new PutItemCommand({
            TableName: "Images",
            Item: {
              "ImageName": { S: srcKey }, 
              'Bucket': { S: srcBucket },
            }
          }))
        }
        catch (error) {
          console.error("Error adding to dynamoDB.", error);
          throw error;
      }
      }
    }
  }
};

function createDDbDocClient() {
  const ddbClient = new DynamoDBClient({region: SES_REGION});
  const marshallOptions = {
      convertEmptyValues: true, removeUndefinedValues: true, convertClassInstanceToMap: true,
  };
  const unmarshallOptions = {
      wrapNumbers: false,
  };
  const translateConfig = {marshallOptions, unmarshallOptions};
  return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}