import json
import boto3
import os
import time
from datetime import datetime
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
table_name = os.environ['DYNAMODB_TABLE_NAME']
table = dynamodb.Table(table_name)

def lambda_handler(event, context):
    """
    Process SQS messages containing load test job requests.
    Store results in DynamoDB.
    """
    print(f"Received {len(event['Records'])} messages")
    
    for record in event['Records']:
        try:
            # Parse the message body
            message_body = json.loads(record['body'])
            print(f"Processing message: {message_body}")
            
            # Extract load test parameters
            test_id = message_body.get('testId', f"test-{int(time.time())}")
            timestamp = int(time.time())
            
            # Simulate load test execution (in a real scenario, this would run the actual test)
            # For now, we'll use sample data
            # Convert numeric values to Decimal for DynamoDB compatibility
            result = {
                'testId': test_id,
                'timestamp': timestamp,
                'totalDuration': Decimal(str(message_body.get('duration', 60))),
                'successfulRequests': int(message_body.get('successfulRequests', 0)),
                'failedRequests': int(message_body.get('failedRequests', 0)),
                'transactionsPerSecond': Decimal(str(message_body.get('tps', 0))),
                'testDate': datetime.utcnow().isoformat() + 'Z',
                'ttl': timestamp + (90 * 24 * 60 * 60),  # 90 days from now
                'targetUrl': message_body.get('targetUrl', ''),
                'status': 'completed'
            }
            
            # Store in DynamoDB
            table.put_item(Item=result)
            print(f"Successfully stored result for test: {test_id}")
            
        except Exception as e:
            print(f"Error processing message: {str(e)}")
            raise  # Re-raise to move message to DLQ after retries
    
    return {
        'statusCode': 200,
        'body': json.dumps('Successfully processed messages')
    }
