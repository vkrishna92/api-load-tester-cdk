# API Load Tester CDK

A scalable, serverless API load testing infrastructure built with AWS CDK, leveraging Lambda, ECS Fargate, SQS, and DynamoDB.

## Overview

This project provides a fully automated infrastructure for conducting distributed API load tests on AWS. The workflow begins by invoking a Lambda function that launches ECS Fargate tasks to execute load tests. The ECS tasks run the actual load tests and push results to an SQS queue. A Lambda function then processes these results from the queue and stores them in DynamoDB for analysis and reporting.

## Architecture

The solution consists of the following AWS components:

### Core Components

- **Lambda Function (`EcsLoadTestLauncher`)**: Receives load test parameters and launches ECS Fargate tasks
- **ECR Repository (`load-test-repository`)**: Stores Docker container images containing load testing tools
- **ECS Fargate Cluster (`LoadTestEcsCluster`)**: Executes containerized load tests against target APIs
- **SQS Queue (`LoadTestQueue`)**: Receives test results from ECS tasks with dead-letter queue for failed messages
- **Lambda Function (`LoadTestProcessor`)**: Consumes SQS messages and persists results to DynamoDB
- **DynamoDB Table (`LoadTestResults`)**: Stores load test results with automatic TTL (90 days)

### Architecture Flow

The load testing workflow follows this sequence:

1. **ECS Task Launcher Lambda** is invoked with load test parameters (API URL, virtual users, rate, duration)
2. **ECS Fargate Task** is launched with the specified parameters to execute the load test
3. The ECS task performs the load test against the target API
4. **Test results** are pushed to the **SQS Queue** by the ECS task
5. **Load Test Handler Lambda** consumes messages from the SQS queue
6. Results are written to **DynamoDB** for storage and analysis

```
┌──────────────────┐
│  Invoke Lambda   │
│  with test params│
└────────┬─────────┘
         │
         ▼
┌─────────────────────┐
│  ECS Task Launcher  │
│      (Lambda)       │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   ECS Fargate Task  │
│  (Runs Load Test)   │
└────────┬────────────┘
         │
         │ Pushes results
         ▼
┌─────────────────────┐      ┌──────────────────────┐
│     SQS Queue       │─────▶│  Load Test Handler   │
│                     │      │      (Lambda)        │
└─────────────────────┘      └──────────┬───────────┘
                                        │
                                        │ Writes results
                                        ▼
                             ┌──────────────────────┐
                             │      DynamoDB        │
                             │  (Test Results)      │
                             └──────────────────────┘
```

## Prerequisites

- **Node.js** (v18 or later)
- **npm** (v8 or later)
- **AWS CLI** configured with appropriate credentials
- **AWS CDK** CLI (`npm install -g aws-cdk`)
- **Docker** (for building container images)
- **Python 3.12** (for Lambda functions)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd api-load-tester-cdk
```

2. Install dependencies:

```bash
npm install
```

3. Bootstrap AWS CDK (if not already done):

```bash
cdk bootstrap aws://ACCOUNT-NUMBER/REGION
```

## Deployment

1. Build the TypeScript project:

```bash
npm run build
```

2. Review the CloudFormation template:

```bash
cdk synth
```

3. Deploy the stack:

```bash
cdk deploy
```

4. Note the output values (table name, queue URL, etc.) for later use.

## Usage

### Running a Load Test

To execute a load test, invoke the ECS Task Launcher Lambda function with the following parameters:

Invoke the ECS launcher Lambda function:

```bash
aws lambda invoke \
  --function-name EcsLoadTestLauncher \
  --payload '{
    "taskCount": 2,
    "targetUrl": "https://api.example.com",
    "vus": 100,
    "rate": 10,
    "duration": 300
  }' \
  response.json
```

**Parameters:**

- `taskCount`: Number of ECS tasks to launch (default: 1)
- `targetUrl`: Target API endpoint
- `vus`: Number of virtual users
- `rate`: Requests per second
- `duration`: Test duration in seconds

### Building and Pushing Container Images

1. Build your load test container image
2. Authenticate with ECR:

```bash
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
```

3. Tag and push your image:

```bash
docker tag my-load-test:latest <account-id>.dkr.ecr.<region>.amazonaws.com/load-test-repository:latest
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/load-test-repository:latest
```

### Querying Results

Query DynamoDB for test results:

```bash
aws dynamodb query \
  --table-name LoadTestResults \
  --key-condition-expression "testId = :testId" \
  --expression-attribute-values '{":testId":{"S":"test-001"}}'
```

## Project Structure

```
api-load-tester-cdk/
├── bin/
│   └── api-load-tester-cdk.ts       # CDK app entry point
├── lib/
│   └── api-load-tester-cdk-stack.ts # Main infrastructure stack
├── lambda/
│   ├── load_test_handler.py         # SQS message processor
│   └── ecs_task_launcher.py         # ECS task launcher
├── test/
│   └── api-load-tester-cdk.test.ts  # Unit tests
├── cdk.json                          # CDK configuration
├── package.json                      # Node.js dependencies
├── tsconfig.json                     # TypeScript configuration
└── README.md                         # This file
```

## Configuration

### DynamoDB Table

- **Partition Key**: `testId` (String)
- **Sort Key**: `timestamp` (Number)
- **TTL**: 90 days (configurable)
- **Billing Mode**: Pay-per-request

### SQS Queue

- **Visibility Timeout**: 300 seconds
- **Message Retention**: 4 days
- **Dead Letter Queue**: 14 days retention, 3 max receive count

### Lambda Functions

- **Runtime**: Python 3.12
- **LoadTestProcessor**: 512 MB memory, 300 seconds timeout
- **EcsLoadTestLauncher**: 256 MB memory, 60 seconds timeout

### ECS Task Definition

- **CPU**: 512 (0.5 vCPU)
- **Memory**: 1024 MB
- **Launch Type**: Fargate

## Development

### Building

```bash
npm run build
```

### Running Tests

```bash
npm run test
```

### Watching for Changes

```bash
npm run watch
```

### Comparing Deployed Stack

```bash
cdk diff
```

## Useful CDK Commands

- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for changes and compile
- `npm run test` - Perform Jest unit tests
- `cdk deploy` - Deploy this stack to your default AWS account/region
- `cdk diff` - Compare deployed stack with current state
- `cdk synth` - Emit the synthesized CloudFormation template
- `cdk destroy` - Remove the stack from your AWS account

## Security Considerations

### Production Recommendations

1. **DynamoDB**: Change `removalPolicy` to `RETAIN` to preserve data
2. **ECR**: Change `removalPolicy` to `RETAIN` to preserve images
3. **IAM Roles**: Review and restrict permissions following the principle of least privilege
4. **Encryption**: Enable point-in-time recovery for DynamoDB in production
5. **VPC**: Consider using private subnets for ECS tasks
6. **Secrets**: Use AWS Secrets Manager for sensitive configuration

### IAM Permissions

The stack creates the following IAM roles:

- **ECS Task Role**: DynamoDB and SQS full access (scope down for production)
- **ECS Task Execution Role**: ECR and CloudWatch Logs access
- **Lambda Execution Roles**: Automatic via CDK with minimal required permissions

## Monitoring and Logging

- **Lambda Logs**: Available in CloudWatch Logs
- **ECS Task Logs**: Stream prefix `LoadTestContainerLogs` in CloudWatch
- **SQS Metrics**: Monitor queue depth, message age, and DLQ messages
- **DynamoDB Metrics**: Track consumed capacity and throttling

## Troubleshooting

### Messages Going to DLQ

- Check Lambda function logs for errors
- Verify message format matches expected structure
- Ensure DynamoDB table permissions are correct

### ECS Tasks Failing to Launch

- Verify ECR repository has container image with `latest` tag
- Check VPC and security group configuration
- Review ECS task execution role permissions
- Check subnet availability and ENI limits

### Lambda Timeouts

- Increase timeout in stack definition if processing large batches
- Optimize Lambda code for better performance
- Consider reducing SQS batch size

## Cost Optimization

- **DynamoDB**: Pay-per-request pricing scales with usage
- **Lambda**: Only charged when processing messages
- **ECS Fargate**: Pay only for task runtime
- **SQS**: Minimal cost for message delivery
- **ECR**: Storage costs for container images

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test`
5. Submit a pull request

## License

This project is provided as-is for educational and testing purposes.

## Support

For issues and questions:

- Check CloudWatch Logs for error messages
- Review AWS service limits and quotas
- Ensure AWS credentials and permissions are properly configured

## Stack Outputs

After deployment, the following outputs are available:

- `LoadTestResultsTableName`: DynamoDB table name
- `LoadTestResultsTableArn`: DynamoDB table ARN
- `LoadTestQueueUrl`: SQS queue URL
- `LoadTestQueueArn`: SQS queue ARN

Access these values via:

```bash
aws cloudformation describe-stacks --stack-name ApiLoadTesterCdkStack --query 'Stacks[0].Outputs'
```

## Next Steps

1. Build and deploy your load test container image to ECR (must include logic to push results to SQS)
2. Invoke the ECS Task Launcher Lambda with your load test parameters (targetUrl, vus, rate, duration)
3. ECS Fargate tasks will execute the load test and push results to SQS
4. Load Test Handler Lambda automatically processes results from SQS and stores them in DynamoDB
5. Query DynamoDB to view and analyze test results
6. Monitor CloudWatch Logs and metrics for ECS tasks and Lambda functions
