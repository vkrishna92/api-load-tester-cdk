# Building a Scalable, Serverless API Load Testing Platform on AWS

## Introduction

Performance testing is critical for modern applications, but setting up scalable load testing infrastructure can be complex and costly. In this article, I'll share how I built a fully automated, serverless API load testing platform on AWS that combines Infrastructure as Code (IaC) with containerized testing tools to deliver enterprise-grade load testing capabilities.

The solution consists of two complementary projects:

- **ApiLoadTester**: A high-performance C# load testing engine
- **api-load-tester-cdk**: AWS infrastructure orchestration using CDK

Together, these projects enable distributed load testing at scale with minimal operational overhead and cost.

## The Challenge

Traditional load testing tools often face several challenges:

1. **Infrastructure complexity**: Setting up and managing load generators requires significant DevOps effort
2. **Scalability limitations**: Vertical scaling has limits; horizontal scaling requires coordination
3. **Cost inefficiency**: Keeping dedicated load testing infrastructure running 24/7 is expensive
4. **Results management**: Aggregating and storing test results from distributed sources is non-trivial
5. **Orchestration overhead**: Manually launching and coordinating multiple test instances is error-prone

## The Solution: A Serverless Architecture

I designed a fully serverless architecture that addresses these challenges using AWS managed services:

### Architecture Overview

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
│   ECS Fargate Tasks │
│  (ApiLoadTester)    │
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

### Key Components

**1. ApiLoadTester (C# .NET 6)**

The load testing engine is a lightweight, high-performance console application with:

- **Virtual User Simulation**: Simulates concurrent users with independent behavior
- **Configurable Request Rates**: Precise rate limiting per virtual user
- **Real-Time Logging**: Immediate feedback on request success/failure
- **Comprehensive Metrics**: TPS, success rates, and detailed timing information
- **Containerization**: Runs as a Docker container for portability

**Key Features:**

```csharp
// Example usage
dotnet run --project ApiLoadTester \
  https://api.example.com/endpoint \
  10    // Virtual Users
  5     // Requests per second per VU
  60    // Duration in seconds
```

**2. Infrastructure as Code (AWS CDK)**

The CDK stack provisions and orchestrates all AWS resources:

- **Lambda Functions**:

  - ECS Task Launcher: Receives test parameters and spawns ECS tasks
  - Load Test Handler: Processes results from SQS and stores in DynamoDB

- **Amazon ECS Fargate**:

  - Runs containerized ApiLoadTester instances
  - Auto-scales based on test requirements
  - No server management required

- **Amazon SQS**:

  - Decouples test execution from result processing
  - Built-in retry logic with Dead Letter Queue
  - Handles bursts of test results

- **Amazon DynamoDB**:

  - Stores test results with automatic TTL (90 days)
  - Pay-per-request pricing
  - Highly available and performant

- **Amazon ECR**:
  - Hosts Docker container images
  - Automatic image vulnerability scanning

## Implementation Highlights

### 1. Distributed Load Generation

The architecture supports horizontal scaling by launching multiple ECS Fargate tasks:

```bash
aws lambda invoke \
  --function-name EcsLoadTestLauncher \
  --payload '{
    "taskCount": 5,
    "targetUrl": "https://api.example.com",
    "vus": 100,
    "rate": 10,
    "duration": 300
  }' \
  response.json
```

This example launches 5 ECS tasks, each simulating 100 virtual users at 10 requests/second for 5 minutes, generating a total of **5,000 requests/second** across the cluster.

### 2. Efficient Result Aggregation

Test results flow through SQS to Lambda for processing:

```python
# Lambda handler processes SQS messages
def lambda_handler(event, context):
    for record in event['Records']:
        test_result = json.loads(record['body'])

        # Store in DynamoDB
        table.put_item(Item={
            'testId': test_result['testId'],
            'timestamp': test_result['timestamp'],
            'status': test_result['status'],
            'responseTime': test_result['responseTime'],
            'ttl': int(time.time()) + (90 * 24 * 60 * 60)  # 90 days
        })
```

### 3. Precise Rate Control

The ApiLoadTester implements precise rate limiting using Task.Delay:

```csharp
private static async Task RunUser(int vuId, string apiUrl, int rate, TimeSpan duration)
{
    var delayBetweenRequests = TimeSpan.FromSeconds(1.0 / rate);
    var endTime = DateTime.UtcNow.Add(duration);

    while (DateTime.UtcNow < endTime)
    {
        try
        {
            var response = await httpClient.GetAsync(apiUrl);
            if (response.IsSuccessStatusCode)
            {
                successfulRequests.Add(DateTime.UtcNow);
            }
        }
        catch (Exception ex)
        {
            failedRequests.Add(DateTime.UtcNow);
        }

        await Task.Delay(delayBetweenRequests);
    }
}
```

## Benefits of This Architecture

### 1. **Cost Efficiency**

- **No idle resources**: Pay only for actual test execution time
- **Fargate pricing**: ~$0.04 per vCPU-hour, ~$0.004 per GB-hour
- **Lambda free tier**: 1M requests/month free
- **DynamoDB on-demand**: Pay only for actual read/write operations

**Example Cost**: A 5-minute test with 5 Fargate tasks (0.5 vCPU, 1GB RAM each):

- Fargate: ~$0.02
- Lambda: ~$0.0001
- SQS: ~$0.0004
- DynamoDB: ~$0.01
- **Total: ~$0.03 per test**

### 2. **Scalability**

- Launch 1 to 1000+ concurrent ECS tasks
- Generate millions of requests per second
- Auto-scaling without manual intervention
- No infrastructure limits

### 3. **Operational Simplicity**

- One-command deployment: `cdk deploy`
- No servers to patch or maintain
- Automatic failover and retry logic
- CloudWatch monitoring included

### 4. **Flexibility**

- Test any HTTP/HTTPS endpoint
- Customize test parameters per execution
- Modify container logic without infrastructure changes
- Support for multiple test scenarios

## Real-World Use Cases

### 1. **CI/CD Integration**

Integrate load tests into your deployment pipeline:

```yaml
# GitHub Actions example
- name: Run Load Test
  run: |
    aws lambda invoke \
      --function-name EcsLoadTestLauncher \
      --payload '{"taskCount": 3, "targetUrl": "${{ env.API_URL }}", "vus": 50, "rate": 5, "duration": 120}' \
      response.json
```

### 2. **Pre-Production Validation**

Validate performance before production deployment:

```bash
# Staging environment load test
./run-load-test.sh \
  --env staging \
  --users 500 \
  --duration 600 \
  --ramp-up 60
```

### 3. **Capacity Planning**

Determine infrastructure limits:

```bash
# Progressive load test
for users in 100 500 1000 2000; do
  run_test --users $users --duration 300
  analyze_results --threshold p95_latency
done
```

## Lessons Learned

### 1. **SQS as a Buffer is Critical**

Direct writes to DynamoDB from ECS tasks would require complex coordination and error handling. SQS provides:

- Automatic retries
- Dead letter queue for failed messages
- Decoupling of concerns
- Built-in throttling protection

### 2. **Fargate Over EC2**

While EC2 provides more control, Fargate offers:

- No cluster management
- Faster task startup times
- Built-in security updates
- Simpler networking

### 3. **Container Image Optimization**

Optimizing the Docker image reduced cold start times:

- Multi-stage builds: Reduced image size from 500MB to 150MB
- Layer caching: Faster rebuilds during development
- .NET trimming: Removed unused dependencies

### 4. **Result TTL is Essential**

Without TTL, DynamoDB costs would grow indefinitely. 90-day retention strikes a balance between:

- Historical analysis capability
- Cost containment
- Compliance requirements

## Getting Started

### Prerequisites

- AWS Account with appropriate permissions
- AWS CLI configured
- Docker installed
- Node.js 18+ and npm
- .NET 6 SDK

### Quick Start

**1. Clone the repositories:**

```bash
git clone https://github.com/vkrishna92/api-load-tester-cdk.git
git clone https://github.com/vkrishna92/ApiLoadTester.git
```

**2. Build and push the container:**

```bash
cd ApiLoadTester
docker build -t apiloadtester .

# Authenticate with ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Tag and push
docker tag apiloadtester:latest \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/load-test-repository:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/load-test-repository:latest
```

**3. Deploy the infrastructure:**

```bash
cd api-load-tester-cdk
npm install
cdk bootstrap
cdk deploy
```

**4. Run your first test:**

```bash
aws lambda invoke \
  --function-name EcsLoadTestLauncher \
  --payload '{
    "taskCount": 2,
    "targetUrl": "https://jsonplaceholder.typicode.com/posts",
    "vus": 50,
    "rate": 5,
    "duration": 60
  }' \
  response.json
```

**5. View results:**

```bash
aws dynamodb query \
  --table-name LoadTestResults \
  --key-condition-expression "testId = :id" \
  --expression-attribute-values '{":id":{"S":"test-001"}}'
```

## Conclusion

Building a serverless load testing platform on AWS demonstrates how modern cloud services can solve complex infrastructure challenges. The combination of:

- **Containerized testing tools** (ApiLoadTester)
- **Infrastructure as Code** (AWS CDK)
- **Serverless orchestration** (Lambda, Fargate, SQS)
- **Managed storage** (DynamoDB)

...creates a solution that is scalable, cost-effective, and operationally simple.

The entire platform can be deployed in minutes, costs pennies per test, and scales to millions of requests per second. Most importantly, it requires zero ongoing maintenance, allowing teams to focus on analyzing results rather than managing infrastructure.

## Resources

- **API Load Tester CDK**: [github.com/vkrishna92/api-load-tester-cdk](https://github.com/vkrishna92/api-load-tester-cdk)
- **ApiLoadTester**: [github.com/vkrishna92/ApiLoadTester](https://github.com/vkrishna92/ApiLoadTester)
- **AWS CDK Documentation**: [docs.aws.amazon.com/cdk](https://docs.aws.amazon.com/cdk)
- **AWS Fargate Pricing**: [aws.amazon.com/fargate/pricing](https://aws.amazon.com/fargate/pricing)

## About the Author

I'm a software engineer passionate about building scalable, cost-effective cloud solutions. This project emerged from the need for enterprise-grade load testing without enterprise-grade costs. Feel free to reach out with questions, suggestions, or contributions!

---

_Have you built similar load testing solutions? What challenges did you face? Share your experiences in the comments!_

#AWS #CloudArchitecture #LoadTesting #Serverless #DevOps #PerformanceTesting #InfrastructureAsCode #AWSCDK #DotNet #Microservices
