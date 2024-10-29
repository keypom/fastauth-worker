#!/bin/bash

# Accept environment as an argument
ENVIRONMENT=$1  # Accept 'dev' or 'prod' as an argument

# Debugging: Output the received argument
echo "Input ENVIRONMENT argument: '$ENVIRONMENT'"

if [ -z "$ENVIRONMENT" ]; then
  echo "Please specify an environment: 'dev' or 'prod'"
  exit 1
fi

# Normalize the environment variable to lowercase
ENVIRONMENT=$(echo "$ENVIRONMENT" | tr '[:upper:]' '[:lower:]')

# Debugging: Output normalized environment
echo "Normalized ENVIRONMENT: $ENVIRONMENT"

# Load environment variables from the appropriate file based on environment
if [ "$ENVIRONMENT" == "dev" ]; then
  ENV_FILE=".dev.vars"
  BASE_URL="https://airtable-worker-dev.keypom.workers.dev"
elif [ "$ENVIRONMENT" == "prod" ] || [ "$ENVIRONMENT" == "production" ]; then
  ENV_FILE=".prod.vars"
  BASE_URL="https://airtable-worker-production.keypom.workers.dev"
else
  echo "Invalid environment specified. Use 'dev' or 'prod'."
  exit 1
fi

# Debugging: Output which env file will be used
echo "Using environment variables from: $ENV_FILE"

# Check if the env file exists
if [ ! -f "$ENV_FILE" ]; then
  echo "Environment file $ENV_FILE not found!"
  exit 1
fi

# Load the current environment variables from the appropriate vars file
source "$ENV_FILE"

echo "Base URL being used: $BASE_URL"

# Function to delete a webhook
delete_webhook() {
  local WEBHOOK_ID=$1
  local WEBHOOK_TYPE=$2

  if [ -z "$WEBHOOK_ID" ]; then
    echo "No existing webhook ID for $WEBHOOK_TYPE. Skipping deletion."
    return
  fi

  echo "Deleting old webhook $WEBHOOK_TYPE with ID: $WEBHOOK_ID"

  # Delete the webhook
  RESPONSE=$(curl -s -X DELETE "https://api.airtable.com/v0/bases/$AIRTABLE_AGENDA_ALERTS_BASE_ID/webhooks/$WEBHOOK_ID" \
    -H "Authorization: Bearer $AIRTABLE_PERSONAL_ACCESS_TOKEN")

  # Check the response to ensure deletion was successful
  if [ -z "$RESPONSE" ]; then
    echo "Webhook $WEBHOOK_TYPE deleted successfully."
  else
    echo "Failed to delete webhook $WEBHOOK_TYPE. Response: $RESPONSE"
  fi
}

# Function to create a webhook and update the vars file
create_webhook() {
  local WEBHOOK_URL=$1
  local TABLE_NAME=$2
  local WEBHOOK_TYPE=$3

  echo "Creating new webhook for $WEBHOOK_TYPE..."

  # Get the table ID based on the table name
  TABLE_INFO=$(curl -s -X GET "https://api.airtable.com/v0/meta/bases/$AIRTABLE_AGENDA_ALERTS_BASE_ID/tables" \
    -H "Authorization: Bearer $AIRTABLE_PERSONAL_ACCESS_TOKEN")

  TABLE_ID=$(echo "$TABLE_INFO" | jq -r --arg TABLE_NAME "$TABLE_NAME" '.tables[] | select(.name==$TABLE_NAME) | .id')

  if [ -z "$TABLE_ID" ]; then
    echo "Failed to get table ID for table name $TABLE_NAME"
    exit 1
  fi

  echo "Found table ID for $TABLE_NAME: $TABLE_ID"

  # Create the new webhook
  CREATION_RESPONSE=$(curl -s -X POST "https://api.airtable.com/v0/bases/$AIRTABLE_AGENDA_ALERTS_BASE_ID/webhooks" \
    -H "Authorization: Bearer $AIRTABLE_PERSONAL_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    --data '{
      "notificationUrl": "'"$WEBHOOK_URL"'",
      "specification": {
        "options": {
          "filters": {
            "dataTypes": ["tableData"],
            "recordChangeScope": "'"$TABLE_ID"'"
          }
        }
      }
    }')

  # Extract the webhook ID and other details from the response
  WEBHOOK_ID=$(echo "$CREATION_RESPONSE" | jq -r '.id')
  MAC_SECRET=$(echo "$CREATION_RESPONSE" | jq -r '.macSecretBase64')
  EXPIRATION=$(echo "$CREATION_RESPONSE" | jq -r '.expirationTime')

  if [ "$WEBHOOK_ID" == "null" ] || [ -z "$WEBHOOK_ID" ]; then
    echo "Failed to create webhook for $WEBHOOK_TYPE. Response: $CREATION_RESPONSE"
    exit 1
  fi

  echo "$WEBHOOK_TYPE webhook created successfully. ID: $WEBHOOK_ID, Expiration: $EXPIRATION"

  # Update the vars file
  echo "Updating $ENV_FILE with new webhook details for $WEBHOOK_TYPE..."

  # Use temporary file for safer write
  tmp_file=$(mktemp)
  cp "$ENV_FILE" "$tmp_file"

  # Update the webhook details using sed
  sed -i'' -e "s|^${WEBHOOK_TYPE}_WEBHOOK_ID=.*|${WEBHOOK_TYPE}_WEBHOOK_ID='$WEBHOOK_ID'|" "$tmp_file"
  sed -i'' -e "s|^${WEBHOOK_TYPE}_MAC_SECRET_BASE64=.*|${WEBHOOK_TYPE}_MAC_SECRET_BASE64='$MAC_SECRET'|" "$tmp_file"
  sed -i'' -e "s|^${WEBHOOK_TYPE}_EXPIRATION=.*|${WEBHOOK_TYPE}_EXPIRATION='$EXPIRATION'|" "$tmp_file"

  # Replace the original vars file with the updated one
  mv "$tmp_file" "$ENV_FILE"

  echo "$WEBHOOK_TYPE webhook details updated in $ENV_FILE."
}

# Delete the old webhooks
delete_webhook "$AGENDA_WEBHOOK_ID" "AGENDA"
delete_webhook "$ALERTS_WEBHOOK_ID" "ALERTS"

# Create new webhooks and update the vars file
create_webhook "$BASE_URL/webhook/agenda" "$AGENDA_TABLE_NAME" "AGENDA"
create_webhook "$BASE_URL/webhook/alerts" "$ALERTS_TABLE_NAME" "ALERTS"

echo "Webhooks recreated and $ENV_FILE updated with new details."
