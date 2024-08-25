import {SNSEvent, SNSHandler} from 'aws-lambda';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient, GetCommand, UpdateCommand} from "@aws-sdk/lib-dynamodb";

const ddb = createDDbDocClient();

export const handler: SNSHandler = async (event: SNSEvent) => {
    for (const record of event.Records) {
        const message = JSON.parse(record.Sns.Message);
        const attributes = record.Sns.MessageAttributes;

        if (attributes.comment_type && attributes.comment_type.Value === 'Caption') {
            const key = message.name
            const newDescription = message.description;

            const getItemParams = {
                TableName: 'ImageTable',
                Key: {ImageName: key},
            };
            try {
                const {Item} = await ddb.send(new GetCommand(getItemParams));
                if (Item) {
                    //updates using UpdateCommand with parameters set up in CLI
                    const params = {
                        TableName: 'ImageTable',
                        Key: {
                            ImageName: key
                        },
                        UpdateExpression: 'set Description = :description',
                        ExpressionAttributeValues: {
                            ':description': newDescription
                        },
                    };
                    try {
                        const result = await ddb.send(new UpdateCommand(params));
                    } catch (error) {
                        throw new Error("Error can't update image.");
                    }
                }
            } catch (error) {
                console.error("ERROR", error);
                throw new Error(`The image you're updating doesn't exist.`);
            }
        }
    }

};

function createDDbDocClient() {
    const ddbClient = new DynamoDBClient({region: process.env.REGION});
    const marshallOptions = {
        convertEmptyValues: true, removeUndefinedValues: true, convertClassInstanceToMap: true,
    };
    const unmarshallOptions = {
        wrapNumbers: false,
    };
    const translateConfig = {marshallOptions, unmarshallOptions};
    return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}