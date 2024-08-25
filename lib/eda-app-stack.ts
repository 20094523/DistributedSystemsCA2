import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from "constructs";
import { SES_REGION } from "../env";

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    //create table same as labs. images will be added using commands
    const imagesTable = new dynamodb.Table(this, "ImagesTable", {
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "ImageName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Images",
    });

    // Integration infrastructure
    const mailerQ = new sqs.Queue(this, "mailer-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });
    const rejectionQueue = new sqs.Queue(this, "rejection-queue", {
      queueName: "RejectionQueue",
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: rejectionQueue,
        maxReceiveCount: 1,
      }
    });


    // Lambda functions

    const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/mailer.ts`,
    });

    const rejectionMailerFn = new lambdanode.NodejsFunction(this, "rejection-mailer-function", {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
    });

    const processImageFn = new lambdanode.NodejsFunction(this, "process-image-function", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        TABLE_NAME: "Images",
        REGION: SES_REGION,
      }
    }
    );

    const processDeleteFn = new lambdanode.NodejsFunction(this, "process-delete-function",{
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processDelete.ts`,
      timeout: cdk.Duration.seconds(3),
      memorySize: 128,
    }
    );

    const processUpdateFn = new lambdanode.NodejsFunction(this, "process-update-function", {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/processUpdate.ts`,
  });




    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });

    const deleteAndUpdate = new sns.Topic(this, "DeleteAndUpdate", {
      displayName: "Topic for deleting and updating",
    });
    

    // Event triggers

    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );

    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3n.SnsDestination(deleteAndUpdate)
    );

    newImageTopic.addSubscription(new subs.SqsSubscription(imageProcessQueue));

    newImageTopic.addSubscription(new subs.SqsSubscription(mailerQ));

    newImageTopic.addSubscription(new subs.SqsSubscription(rejectionQueue));

    deleteAndUpdate.addSubscription(new subs.LambdaSubscription(processDeleteFn));

    deleteAndUpdate.addSubscription(new subs.LambdaSubscription(processUpdateFn));


    const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    });

    const newImageMailEventSource = new events.SqsEventSource(mailerQ,{
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    })

    const newImageEventRejectSource = new events.SqsEventSource(rejectionQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    });

    processImageFn.addEventSource(newImageEventSource);

    mailerFn.addEventSource(newImageMailEventSource);

    rejectionMailerFn.addEventSource(newImageEventRejectSource);

    // Permissions

    imagesBucket.grantRead(processImageFn);
    imagesTable.grantReadWriteData(processImageFn);
    imagesTable.grantReadWriteData(processDeleteFn);
    imagesTable.grantReadWriteData(processUpdateFn);

    mailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    rejectionMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    processImageFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["sqs:SendMessage"],
      resources: [rejectionQueue.queueArn]
    }));

    // Output

    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });

    new cdk.CfnOutput(this, "deleteAndUpdate", {
      value: deleteAndUpdate.topicArn,
    });

  }
}