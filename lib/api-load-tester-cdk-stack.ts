import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export class ApiLoadTesterCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table to store load test results
    const loadTestResultsTable = new dynamodb.Table(this, 'LoadTestResults', {
      tableName: 'LoadTestResults',
      partitionKey: {
        name: 'testId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.NUMBER,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false, // Enable for production if needed
      },
    });

    // SQS queue for load test jobs
    const loadTestQueue = new sqs.Queue(this, 'LoadTestQueue', {
      queueName: 'LoadTestQueue',
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'LoadTestDLQ', {
          queueName: 'LoadTestDLQ',
          retentionPeriod: cdk.Duration.days(14),
        }),
        maxReceiveCount: 3,
      },
    });

    // Lambda function to process load test jobs
    const loadTestProcessor = new lambda.Function(this, 'LoadTestProcessor', {
      functionName: 'LoadTestProcessor',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'load_test_handler.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: cdk.Duration.seconds(300),
      memorySize: 512,
      environment: {
        DYNAMODB_TABLE_NAME: loadTestResultsTable.tableName,
      },
    });

    // Add SQS as event source for Lambda
    loadTestProcessor.addEventSource(
      new lambdaEventSources.SqsEventSource(loadTestQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );

    // Grant Lambda permissions to read from SQS and write to DynamoDB
    loadTestQueue.grantConsumeMessages(loadTestProcessor);
    loadTestResultsTable.grantWriteData(loadTestProcessor);

    // Add repository in ECR
    const ecrRepository =  new ecr.Repository(this, 'LoadTestEcrRepository', {
      repositoryName: 'load-test-repository',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
    });
    
    // Use default VPC or create a new one
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVPC', {
      isDefault: true
    });
    
    // Create security group for ECS tasks
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'LoadTestEcsSecurityGroup', {
      vpc,
      securityGroupName: 'LoadTestEcsSecurityGroup',
      description: 'Security group for load test ECS tasks',
      allowAllOutbound: true,
    });
    
    // Add ECS Cluster
    const ecsCluster = new ecs.Cluster(this, 'LoadTestEcsCluster', {
      clusterName: 'LoadTestEcsCluster',
      vpc: vpc
    });

    // Create iam role for ecs task container
    const ecsTaskRole = new iam.Role(this, 'ecsLoadTestTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: 'ecsLoadTestTaskRole',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSQSFullAccess')
      ]
    });

    // create iam role for ecs task execution
    const ecsTaskExecutionRole = new iam.Role(this, 'ecsLoadTestTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: 'ecsLoadTestTaskExecutionRole',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ]
    });

    // Add a task definition 
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'LoadTestTaskDef', { 
      family: 'LoadTestTaskDef',
      cpu: 512,
      memoryLimitMiB: 1024,
      taskRole: ecsTaskRole,
      executionRole: ecsTaskExecutionRole,
      
    });
    // Add container to task definition
    const container = taskDefinition.addContainer('LoadTestContainer', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'LoadTestContainerLogs' }),
      environment:{
        SQS_QUEUE_URL: loadTestQueue.queueUrl,
      },
      cpu: 512,
      memoryLimitMiB: 1024,      
    });

    // lambda to trigger ecs fargate task
    const ecsTaskLauncher = new lambda.Function(this, 'EcsLoadTestLauncher', {
      functionName: 'EcsLoadTestLauncher',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'ecs_task_launcher.lambda_handler',      
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,      
      environment: {
        CLUSTER_NAME: ecsCluster.clusterName,
        TASK_DEFINITION_FAMILY: taskDefinition.family!,
        CONTAINER_NAME: container.containerName,
        SUBNETS: vpc.publicSubnets.map(subnet => subnet.subnetId).join(','),
        SECURITY_GROUP: ecsSecurityGroup.securityGroupId
      },      
    });
    // Grant Lambda permissions to run ECS tasks
    ecsTaskLauncher.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "ecs:RunTask"
      ],
      resources:[taskDefinition.taskDefinitionArn]
    }));
    
    // Grant Lambda permissions to pass IAM roles to ECS tasks
    ecsTaskLauncher.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "iam:PassRole"
      ],
      resources:[taskDefinition.taskRole.roleArn, taskDefinition.executionRole!.roleArn]
    }));
    // Stack outputs
    new cdk.CfnOutput(this, 'LoadTestResultsTableName', {
      value: loadTestResultsTable.tableName,
      description: 'Name of the DynamoDB table for load test results',
      exportName: 'LoadTestResultsTableName',
    });

    new cdk.CfnOutput(this, 'LoadTestResultsTableArn', {
      value: loadTestResultsTable.tableArn,
      description: 'ARN of the DynamoDB table for load test results',
      exportName: 'LoadTestResultsTableArn',
    });

    new cdk.CfnOutput(this, 'LoadTestQueueUrl', {
      value: loadTestQueue.queueUrl,
      description: 'URL of the SQS queue for load test jobs',
      exportName: 'LoadTestQueueUrl',
    });

    new cdk.CfnOutput(this, 'LoadTestQueueArn', {
      value: loadTestQueue.queueArn,
      description: 'ARN of the SQS queue for load test jobs',
      exportName: 'LoadTestQueueArn',
    });
  }
}
