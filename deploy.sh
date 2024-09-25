#!/bin/bash

ENVIRONMENT=$1  # Accept 'dev' or 'production' as an argument

if [ -z "$ENVIRONMENT" ]; then
  echo "Please specify an environment: 'dev' or 'production'"
  exit 1
fi

# Load environment variables from the appropriate file
if [ "$ENVIRONMENT" == "dev" ]; then
  ENV_FILE=".env.dev"
elif [ "$ENVIRONMENT" == "production" ]; then
  ENV_FILE=".env.production"
else
  echo "Invalid environment specified. Use 'dev' or 'production'."
  exit 1
fi

# Check if the env file exists
if [ ! -f "$ENV_FILE" ]; then
  echo "Environment file $ENV_FILE not found!"
  exit 1
fi

# Export the variables from the env file
export $(grep -v '^#' $ENV_FILE | xargs)

# Set secrets using wrangler secret
set_secret() {
  SECRET_NAME=$1
  SECRET_VALUE=$2
  wrangler secret put $SECRET_NAME --env $ENVIRONMENT <<EOF
$SECRET_VALUE
EOF
}

echo "Setting secrets for environment: $ENVIRONMENT"

set_secret WORKER_NEAR_SK "$WORKER_NEAR_SK"
set_secret AIRTABLE_PERSONAL_ACCESS_TOKEN "$AIRTABLE_PERSONAL_ACCESS_TOKEN"
set_secret AGENDA_MAC_SECRET_BASE64 "$AGENDA_MAC_SECRET_BASE64"
set_secret ALERTS_MAC_SECRET_BASE64 "$ALERTS_MAC_SECRET_BASE64"
set_secret GOOGLE_CLIENT_ID "$GOOGLE_CLIENT_ID"
set_secret AUTHORIZED_ADMINS "$AUTHORIZED_ADMINS"
set_secret ADMIN_NEAR_SK "$ADMIN_NEAR_SK"

echo "Secrets set successfully."

# Deploy the worker
wrangler deploy --env $ENVIRONMENT
