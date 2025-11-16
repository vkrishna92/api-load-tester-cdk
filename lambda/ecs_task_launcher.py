import json
import boto3
import os
from typing import Dict, List, Any

ecs_client = boto3.client('ecs') 

# Environment variables from CDK
CLUSTER_NAME = os.environ['CLUSTER_NAME']
TASK_DEFINITION_FAMILY = os.environ['TASK_DEFINITION_FAMILY']
CONTAINER_NAME = os.environ['CONTAINER_NAME']
SUBNETS = os.environ['SUBNETS'].split(',')
SECURITY_GROUP = os.environ['SECURITY_GROUP']


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to launch ECS Fargate tasks for load testing.
    
    Expected event structure:
    {
        "taskCount": 1,  # Number of tasks to launch (default: 1)
        "targetUrl": "https://api.example.com",  # Target URL for load test
        "vus": 100,  # Number of virtual users
        "rate": 10,  # Request rate per second
        "duration": 300  # Duration of the test in seconds                    
    }
    """
    try:
        print(f"Received event: {json.dumps(event)}")
        
        # Extract parameters from event
        task_count = event.get('taskCount', 1)        
                
        
        # Prepare container overrides if provided
        overrides = {}        
        overrides = {
            'containerOverrides': [
                {
                    'name': CONTAINER_NAME,
                    'command': [
                        event.get('targetUrl', ''),
                        event.get('vus', 100),
                        event.get('rate', 10),
                        event.get('duration', 300)
                        ]
                }
                ]
            }
        
        print(f"Launching {task_count} task(s) in cluster: {CLUSTER_NAME}")
        print(f"Task definition: {TASK_DEFINITION_FAMILY}")
        print(f"Network configuration - Subnets: {SUBNETS}, Security Group: {SECURITY_GROUP}")
        
        # Launch ECS Fargate tasks
        response = ecs_client.run_task(
            cluster=CLUSTER_NAME,
            taskDefinition=TASK_DEFINITION_FAMILY,
            count=task_count,
            launchType='FARGATE',
            networkConfiguration={
                'awsvpcConfiguration': {
                    'subnets': SUBNETS,
                    'securityGroups': [SECURITY_GROUP],
                    'assignPublicIp': 'ENABLED'
                }
            },
            overrides=overrides
        )
        
        # Extract task information
        tasks = response.get('tasks', [])
        failures = response.get('failures', [])
        
        # Build response
        task_arns = [task['taskArn'] for task in tasks]
        
        result = {
            'statusCode': 200 if tasks else 500,
            'body': {
                'message': f'Successfully launched {len(tasks)} task(s)',
                'tasksLaunched': len(tasks),
                'taskArns': task_arns,
                'failures': failures,
                'clusterName': CLUSTER_NAME,
                'taskDefinition': TASK_DEFINITION_FAMILY
            }
        }
        
        # Log task ARNs
        for arn in task_arns:
            print(f"Launched task: {arn}")
        
        # Log failures if any
        if failures:
            print(f"Failed to launch {len(failures)} task(s): {json.dumps(failures)}")
        
        return result
        
    except ValueError as ve:
        error_message = f"Validation error: {str(ve)}"
        print(error_message)
        return {
            'statusCode': 400,
            'body': {
                'error': error_message
            }
        }
        
    except Exception as e:
        error_message = f"Error launching ECS tasks: {str(e)}"
        print(error_message)
        return {
            'statusCode': 500,
            'body': {
                'error': error_message
            }
        }
